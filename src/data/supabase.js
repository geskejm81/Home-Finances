// Supabase over plain fetch: magic-link sign-in and the REST API. No client library.
// The publishable key is meant to be public; row-level security protects the data.

export const SUPABASE_URL = 'https://ctzndfvfehdgwppofiru.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_C7moKJpGnDK_XbZO0R1Oyw_vTXCKscN';
const SESSION_KEY = 'household.session';

let session = null;
const store = globalThis.localStorage;
try { session = JSON.parse(store?.getItem(SESSION_KEY)) || null; } catch (e) { session = null; }

function keep(s) {
  session = s;
  try { s ? store?.setItem(SESSION_KEY, JSON.stringify(s)) : store?.removeItem(SESSION_KEY); } catch (e) { /* private mode */ }
}
function fromTokens(p) {
  const exp = Number(p.expires_at) || Math.floor(Date.now() / 1000) + Number(p.expires_in || 3600);
  let email = p.user?.email;
  if (!email) { try { email = JSON.parse(atob(p.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email; } catch (e) { email = ''; } }
  return { access_token: p.access_token, refresh_token: p.refresh_token, expires_at: exp, email };
}

export const auth = {
  get session() { return session; },
  get email() { return session?.email || ''; },

  /** Email a sign-in link that returns to this page. */
  async sendLink(email, redirectTo) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, create_user: true }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).msg || `Couldn't send (${r.status})`);
  },

  /** After the email link: tokens (or an error) arrive in the URL hash. Returns 'signed-in', an error message, or null. */
  fromUrl(hash) {
    if (!hash || !/access_token=|error=/.test(hash)) return null;
    const p = Object.fromEntries(new URLSearchParams(hash.replace(/^#/, '')));
    if (p.error) return p.error_description?.replace(/\+/g, ' ') || p.error;
    keep(fromTokens(p));
    return 'signed-in';
  },

  async refresh() {
    if (!session?.refresh_token) throw new Error('signed out');
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!r.ok) { keep(null); throw new Error('Session expired'); }
    keep(fromTokens(await r.json()));
  },

  async signOut() {
    const s = session; keep(null);
    if (s) await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
  },
};

/** REST call with the signed-in user's token. path like 'transactions?select=*'. */
export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  if (!session) throw new Error('signed out');
  if (session.expires_at - 60 < Date.now() / 1000) await auth.refresh();
  const go = () => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let r = await go();
  if (r.status === 401) { await auth.refresh(); r = await go(); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `${method} ${path.split('?')[0]} failed (${r.status})`);
  return r.status === 204 ? null : r.json().catch(() => null);
}
