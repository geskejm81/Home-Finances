// Plaid ⇄ Household. Runs on Supabase; the Plaid keys and bank tokens never reach the browser.
//
// POST { action: 'link_token' [, item_id] }       → { link_token }        start or repair a bank connection
// POST { action: 'exchange', public_token, institution } → sync result     finish connecting a bank
// POST { action: 'sync' }                          → { added, matched, removed, banks }
//
// Sync takes posted transactions dated on/after households.bank_start. Each one is first
// matched to an unconfirmed spreadsheet row (see match.js); only the rest land in the Inbox.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { reconcile, MATCH_DAYS } from './match.js';

const PLAID_URL = 'https://production.plaid.com';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

class PlaidError extends Error { constructor(msg: string, public code?: string) { super(msg); } }

async function plaid(path: string, body: Record<string, unknown>) {
  const client_id = Deno.env.get('PLAID_CLIENT_ID'), secret = Deno.env.get('PLAID_SECRET');
  if (!client_id || !secret) throw new PlaidError('Plaid keys are not set in Supabase', 'NO_KEYS');
  const r = await fetch(PLAID_URL + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id, secret, ...body }),
  });
  const d = await r.json();
  if (!r.ok) throw new PlaidError(d.error_message || d.error_code || `Plaid ${path} failed`, d.error_code);
  return d;
}

let lastId = 0;
const newId = () => (lastId = Math.max(lastId + 1, Date.now() * 1000 + Math.floor(Math.random() * 1000)));

async function saveAccounts(db: SupabaseClient, hh: string, access_token: string, institution?: string) {
  const { accounts } = await plaid('/accounts/get', { access_token });
  const rows = accounts.map((a: any) => ({
    household_id: hh, id: a.account_id,
    name: [institution, a.name, a.mask ? `··${a.mask}` : ''].filter(Boolean).join(' '),
  }));
  // ignoreDuplicates keeps any nickname already given to an account
  if (rows.length) await db.from('accounts').upsert(rows, { onConflict: 'household_id,id', ignoreDuplicates: true });
}

async function syncItem(db: SupabaseClient, hh: string, item_id: string, start: string) {
  const { data: tok } = await db.from('plaid_tokens').select('access_token,cursor').eq('item_id', item_id).single();
  if (!tok) throw new Error('Missing bank token');
  let cursor = tok.cursor || undefined, has_more = true;
  const added: any[] = [], modified: any[] = [], removed: any[] = [];
  while (has_more) {
    const d = await plaid('/transactions/sync', { access_token: tok.access_token, cursor, count: 500 });
    added.push(...d.added); modified.push(...d.modified); removed.push(...d.removed);
    cursor = d.next_cursor; has_more = d.has_more;
  }

  const posted = added.filter(t => !t.pending && t.date >= start);
  let inserted = 0, matched = 0;
  if (posted.length) {
    // skip anything already stored (re-sync after a reset)
    const ids = posted.map(t => t.transaction_id);
    const { data: known } = await db.from('transactions').select('external_id').eq('household_id', hh).in('external_id', ids);
    const seen = new Set((known || []).map(r => r.external_id));
    const fresh = posted.filter(t => !seen.has(t.transaction_id));

    // unconfirmed spreadsheet rows near the bank window
    const from = new Date(Date.parse(start) - MATCH_DAYS * 864e5).toISOString().slice(0, 10);
    const [{ data: sheet }, { data: cats }] = await Promise.all([
      db.from('transactions').select('id,date,amount,category,knauf').eq('household_id', hh).eq('source', 'sheet')
        .is('external_id', null).gte('date', from),
      db.from('categories').select('name,grp').eq('household_id', hh),
    ]);
    const grp = new Map((cats || []).map(c => [c.name, c.grp]));
    const candidates = (sheet || []).map(s => ({
      id: s.id, date: s.date, amount: Number(s.amount),
      inflow: grp.get(s.category) === 'income' || s.knauf === 'deposit' || Number(s.amount) < 0,
    }));
    const byId = new Map(fresh.map(t => [t.transaction_id, t]));
    const { matches, unmatched } = reconcile(
      fresh.map(t => ({ external_id: t.transaction_id, date: t.date, amount: t.amount })), candidates);

    for (const m of matches) {
      const t = byId.get(m.external_id);
      await db.from('transactions').update({
        external_id: t.transaction_id, merchant: t.merchant_name || t.name, raw: t.name, account: t.account_id,
      }).eq('id', m.id).eq('household_id', hh);
    }
    matched = matches.length;

    const rows = unmatched.map(x => byId.get(x)).map(t => ({
      id: newId(), household_id: hh, date: t.date, merchant: t.merchant_name || t.name, raw: t.name,
      amount: t.amount, account: t.account_id, source: 'bank', inbox: true, external_id: t.transaction_id,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('transactions').insert(rows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }
    inserted = rows.length;
  }

  // Corrections from the bank only touch rows nobody has reviewed yet.
  for (const t of modified.filter(t => !t.pending)) {
    await db.from('transactions').update({ date: t.date, amount: t.amount, raw: t.name })
      .eq('household_id', hh).eq('external_id', t.transaction_id).eq('inbox', true);
  }
  const gone = removed.map(r => r.transaction_id);
  if (gone.length) {
    await db.from('transactions').delete().eq('household_id', hh).in('external_id', gone).eq('inbox', true);
    await db.from('transactions').update({ external_id: null }).eq('household_id', hh).in('external_id', gone);
  }

  await db.from('plaid_tokens').update({ cursor }).eq('item_id', item_id);
  await db.from('plaid_items').update({ status: 'ok', last_error: null, last_synced_at: new Date().toISOString() }).eq('item_id', item_id);
  return { added: inserted, matched, removed: gone.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
    const { data: { user } } = await db.auth.getUser(jwt);
    if (!user) return json({ error: 'Signed out' }, 401);
    const { data: mem } = await db.from('members').select('household_id').eq('user_id', user.id).limit(1);
    const hh = mem?.[0]?.household_id;
    if (!hh) return json({ error: 'No household' }, 403);
    const { data: house } = await db.from('households').select('bank_start').eq('id', hh).single();
    const start = house!.bank_start as string;

    const { action, ...args } = await req.json();

    if (action === 'link_token') {
      const body: Record<string, unknown> = { user: { client_user_id: user.id }, client_name: 'Household', language: 'en', country_codes: ['US'] };
      if (args.item_id) {
        const { data: tok } = await db.from('plaid_tokens').select('access_token').eq('item_id', args.item_id).single();
        body.access_token = tok?.access_token;                       // update mode: repair a connection
      } else {
        body.products = ['transactions'];
        body.transactions = { days_requested: 60 };
      }
      const d = await plaid('/link/token/create', body);
      return json({ link_token: d.link_token });
    }

    if (action === 'exchange') {
      const d = await plaid('/item/public_token/exchange', { public_token: args.public_token });
      const { error } = await db.from('plaid_items').upsert({ item_id: d.item_id, household_id: hh, institution: args.institution || null, status: 'ok' });
      if (error) throw new Error(error.message);
      await db.from('plaid_tokens').upsert({ item_id: d.item_id, access_token: d.access_token });
      await saveAccounts(db, hh, d.access_token, args.institution);
      const r = await syncItem(db, hh, d.item_id, start).catch(e => ({ added: 0, matched: 0, removed: 0, pending: e.code === 'PRODUCT_NOT_READY' }));
      return json({ item_id: d.item_id, ...r });
    }

    if (action === 'sync') {
      const { data: items } = await db.from('plaid_items').select('item_id,institution').eq('household_id', hh);
      const total = { added: 0, matched: 0, removed: 0, banks: [] as unknown[] };
      for (const it of items || []) {
        try {
          const r = await syncItem(db, hh, it.item_id, start);
          total.added += r.added; total.matched += r.matched; total.removed += r.removed;
          total.banks.push({ institution: it.institution, status: 'ok' });
        } catch (e) {
          const code = (e as PlaidError).code;
          const status = code === 'ITEM_LOGIN_REQUIRED' || code === 'PENDING_EXPIRATION' ? 'relink' : 'error';
          await db.from('plaid_items').update({ status, last_error: (e as Error).message }).eq('item_id', it.item_id);
          total.banks.push({ institution: it.institution, status, error: (e as Error).message });
        }
      }
      return json(total);
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message, code: (e as PlaidError).code }, 500);
  }
});
