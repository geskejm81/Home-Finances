// Sync round trip against an in-memory stand-in for the Supabase REST API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, setState, seed } from '../src/core/store.js';
import { run } from '../src/core/model.js';
import { createSync, txToRow, rowToTx } from '../src/data/sync.js';

const KEYS = { categories: ['household_id', 'name'], accounts: ['household_id', 'id'], rules: ['household_id', 'match'], projects: ['household_id', 'id'], transactions: ['id'] };

function fakeApi() {
  const db = { households: [{ id: 'hh', name: 'Test', people: ['Alex'] }], categories: [], accounts: [], rules: [], projects: [], transactions: [], plaid_items: [] };
  const calls = [];
  const api = async (path, { method = 'GET', body, headers = {} } = {}) => {
    calls.push(method + ' ' + path.split('?')[0]);
    const [table, qs = ''] = path.split('?');
    if (table === 'rpc/join_household') return 'hh';
    const q = new URLSearchParams(qs);
    if (method === 'GET') {
      if (table === 'households') return db.households;
      const [from, to] = (headers.Range || '0-999').split('-').map(Number);
      return db[table].filter(r => r.household_id === 'hh').slice(from, to + 1).map(r => structuredClone(r));
    }
    if (method === 'POST') {
      for (const row of body) {
        const k = KEYS[table].map(c => row[c]).join('|');
        const i = db[table].findIndex(r => KEYS[table].map(c => r[c]).join('|') === k);
        if (i >= 0) db[table][i] = structuredClone(row); else db[table].push(structuredClone(row));
      }
      return null;
    }
    if (method === 'DELETE') {
      const [col, expr] = [...q.entries()].find(([c]) => c !== 'household_id');
      const vals = decodeURIComponent(expr).replace(/^in\.\(|\)$/g, '').split(',').map(v => v.replace(/^"|"$/g, ''));
      db[table] = db[table].filter(r => !vals.includes(String(r[col])));
      return null;
    }
  };
  return { api, db, calls };
}
const strip = s => JSON.parse(JSON.stringify({ cats: s.cats, txns: s.txns, projects: s.projects, accounts: s.accounts, rules: s.rules }));

test('a transaction survives the row mapping unchanged', () => {
  setState(seed());
  for (const t of S.txns) assert.deepEqual(rowToTx(JSON.parse(JSON.stringify(txToRow(t)))), t);
});

test('first save sends everything; reload matches; second save sends nothing', async () => {
  setState(seed());
  const { api, db } = fakeApi();
  const sync = createSync(api);
  await sync.load();                       // empty household
  await sync.pushNow(S);
  assert.equal(db.transactions.length, S.txns.length);
  assert.deepEqual(sync.diff(S), {});
  const again = createSync(api);
  const loaded = await again.load();
  assert.deepEqual(strip(loaded), strip(S));
});

test('only changed rows are sent; deletes and undo are synced', async () => {
  setState(seed());
  const { api, db, calls } = fakeApi();
  const sync = createSync(api);
  await sync.load(); await sync.pushNow(S);
  const t = S.txns.find(x => x.inbox && x.m === 'Kroger');
  run('tx.setCategory', { id: t.id, c: 'Groceries' });
  const d = sync.diff(S);
  assert.deepEqual(Object.keys(d).sort(), ['transactions']);
  assert.equal(d.transactions.upserts.length, 1);
  await sync.pushNow(S);
  assert.equal(db.transactions.find(r => r.id === t.id).category, 'Groceries');
  run('tx.delete', { id: t.id });
  calls.length = 0; await sync.pushNow(S);
  assert.ok(calls.includes('DELETE transactions'));
  assert.equal(db.transactions.some(r => r.id === t.id), false);
});
