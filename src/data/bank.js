// Connecting banks with Plaid Link, and pulling new transactions.
// Plaid's script is loaded only when you tap Connect, so nothing else depends on it.

import { fn } from './supabase.js';

let linkScript = null;
function loadLink() {
  if (window.Plaid) return Promise.resolve();
  return linkScript ||= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
    s.onload = ok; s.onerror = () => { linkScript = null; fail(new Error("Couldn't load Plaid")); };
    document.head.appendChild(s);
  });
}

/** Open Plaid Link. With item_id it repairs that connection. Resolves with the sync result, or null if closed. */
export async function connectBank(item_id) {
  const [{ link_token }] = await Promise.all([fn('plaid', { action: 'link_token', item_id }), loadLink()]);
  return new Promise((resolve, reject) => {
    const handler = window.Plaid.create({
      token: link_token,
      onSuccess: async (public_token, meta) => {
        try { resolve(item_id ? await syncBanks() : await fn('plaid', { action: 'exchange', public_token, institution: meta?.institution?.name })); }
        catch (e) { reject(e); }
      },
      onExit: (err) => (err ? reject(new Error(err.display_message || err.error_message || 'Bank connection closed')) : resolve(null)),
    });
    handler.open();
  });
}

/** Ask the server to pull new transactions from every connected bank. */
export const syncBanks = () => fn('plaid', { action: 'sync' });
