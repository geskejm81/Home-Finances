// Database ⇄ app state. Load everything on sign-in; after each change, send only
// the rows that differ from what the database last confirmed.
// `api` is injected so tests can run without a network.

const TABLES = {
  categories: {
    key: r => r.name, keyCols: ['name'], conflict: 'household_id,name',
    fromState: S => S.cats.map((c, i) => ({ name: c.name, grp: c.group, sort: i })),
    toState: rows => rows.sort((a, b) => a.sort - b.sort).map(r => ({ name: r.name, group: r.grp })),
  },
  accounts: {
    key: r => r.id, keyCols: ['id'], conflict: 'household_id,id',
    fromState: S => S.accounts.map(a => ({ id: a.id, name: a.name })),
    toState: rows => rows.map(r => ({ id: r.id, name: r.name })),
  },
  rules: {
    key: r => r.match, keyCols: ['match'], conflict: 'household_id,match',
    fromState: S => S.rules.map((r, i) => ({ match: r.m, category: r.c || null, knauf: !!r.k, excluded: !!r.x, sort: i })),
    toState: rows => rows.sort((a, b) => a.sort - b.sort).map(r => clean({ m: r.match, c: r.category, k: r.knauf ? 1 : 0, x: r.excluded ? 1 : 0 })),
  },
  projects: {
    key: r => r.id, keyCols: ['id'], conflict: 'household_id,id',
    fromState: S => S.projects.map(p => ({ id: p.id, year: p.year, name: p.name, period: p.when || null, amount: p.a || 0, detail: p.detail || null })),
    toState: rows => rows.map(r => clean({ id: r.id, year: r.year, name: r.name, when: r.period || '', a: Number(r.amount), detail: r.detail })),
  },
  transactions: {
    key: r => String(r.id), keyCols: ['id'], conflict: 'id',
    fromState: S => S.txns.map(txToRow),
    toState: rows => rows.map(rowToTx),
  },
};

const clean = o => { for (const k in o) if (o[k] == null || o[k] === 0 && ['k', 'x'].includes(k)) delete o[k]; return o; };

export function txToRow(t) {
  return {
    id: t.id, date: t.d, merchant: t.m ?? null, raw: t.raw ?? null, amount: t.a, category: t.c ?? null, note: t.n ?? null,
    person: t.p ?? null, account: t.acct ?? null, source: t.src || 'manual', inbox: !!t.inbox, excluded: !!t.x,
    knauf: t.k ?? null, knauf_submitted: t.ks ?? null, knauf_reimbursed: t.kr ?? null, knauf_items: t.kids ?? null,
    return_of: t.ret ?? null, split: t.split ?? null, project: t.proj ?? null, external_id: t.ext ?? null,
  };
}
export function rowToTx(r) {
  const t = {
    id: Number(r.id), d: r.date, m: r.merchant, raw: r.raw, a: Number(r.amount), c: r.category, n: r.note, p: r.person,
    acct: r.account, src: r.source, inbox: r.inbox ? 1 : null, x: r.excluded ? 1 : null, k: r.knauf, ks: r.knauf_submitted,
    kr: r.knauf_reimbursed, kids: r.knauf_items?.map(Number), ret: r.return_of == null ? null : Number(r.return_of),
    split: r.split, proj: r.project, ext: r.external_id,
  };
  for (const k in t) if (t[k] == null) delete t[k];
  return t;
}

const STATE_KEY = { categories: 'cats', accounts: 'accounts', rules: 'rules', projects: 'projects', transactions: 'txns' };
const sameRow = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createSync(api, { onStatus = () => {} } = {}) {
  let household = null;
  let synced = {};           // table → Map(key → row as last confirmed by the database)
  let pending = null, running = false, again = false;

  async function selectAll(table) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const page = await api(`${table}?select=*&household_id=eq.${household}&order=${TABLES[table].keyCols[0]}`, { headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }

  /** Join (if invited) and load the household. Returns app state, or null if this account has no household. */
  async function load() {
    household = await api('rpc/join_household', { method: 'POST', body: {} });
    if (!household) return null;
    const [hh] = await api(`households?select=id,name,people&id=eq.${household}`);
    const state = { v: 1, household: { id: hh.id, name: hh.name }, people: hh.people || [] };
    for (const [table, def] of Object.entries(TABLES)) state[STATE_KEY[table]] = def.toState(await selectAll(table));
    // What the database holds, in the exact shape diff() produces.
    synced = Object.fromEntries(Object.entries(TABLES).map(([table, def]) => [table, new Map(def.fromState(state).map(r => [def.key(r), r]))]));
    return state;
  }

  /** What would be sent for this state: { table: { upserts, deletes } }. Pure; exported for tests. */
  function diff(S) {
    const out = {};
    for (const [table, def] of Object.entries(TABLES)) {
      const now = new Map(def.fromState(S).map(r => [def.key(r), r]));
      const before = synced[table] || new Map();
      const upserts = [...now].filter(([k, r]) => !before.has(k) || !sameRow(before.get(k), r)).map(([, r]) => r);
      const deletes = [...before.keys()].filter(k => !now.has(k));
      if (upserts.length || deletes.length) out[table] = { upserts, deletes };
    }
    return out;
  }

  async function pushNow(S) {
    const changes = diff(S);
    for (const [table, { upserts, deletes }] of Object.entries(changes)) {
      const def = TABLES[table];
      for (let i = 0; i < upserts.length; i += 500) {
        const batch = upserts.slice(i, i + 500).map(r => ({ household_id: household, ...r }));
        await api(`${table}?on_conflict=${def.conflict}`, { method: 'POST', body: batch, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
        for (const r of upserts.slice(i, i + 500)) (synced[table] ||= new Map()).set(def.key(r), r);
      }
      for (let i = 0; i < deletes.length; i += 200) {
        const keys = deletes.slice(i, i + 200);
        const list = keys.map(k => `"${String(k).replace(/"/g, '\\"')}"`).join(',');
        await api(`${table}?household_id=eq.${household}&${def.keyCols[0]}=in.(${encodeURIComponent(list)})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        for (const k of keys) synced[table].delete(k);
      }
    }
  }

  /** Debounced save. Changes made while a save runs are sent right after. */
  function push(getState, delay = 700) {
    clearTimeout(pending);
    pending = setTimeout(async () => {
      if (running) { again = true; return; }
      running = true; onStatus('saving');
      try { await pushNow(getState()); onStatus('saved'); }
      catch (e) { onStatus('error', e); }
      finally { running = false; if (again) { again = false; push(getState, 0); } }
    }, delay);
  }

  return { load, push, pushNow, diff, get household() { return household; }, _setSynced(state, hh) { household = hh; synced = Object.fromEntries(Object.entries(TABLES).map(([t, d]) => [t, new Map(d.fromState(state).map(r => [d.key(r), r]))])); } };
}
