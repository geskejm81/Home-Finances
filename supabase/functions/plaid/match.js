// November reconciliation: pair each bank transaction with a spreadsheet row
// (same amount to the cent, same direction, posted within a few days).
// Plain JS so the app's tests can run it; the Plaid function imports it.

export const MATCH_DAYS = 4;

const dayDiff = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 864e5);
const cents = n => Math.round(Math.abs(n) * 100);

/**
 * bank:   [{ external_id, date, amount }]            Plaid sign: + money out, − money in
 * sheet:  [{ id, date, amount, inflow }]              unmatched spreadsheet rows
 * Returns { matches: [{ external_id, id }], unmatched: [external_id] }.
 * Each sheet row is used at most once; closest date wins.
 */
export function reconcile(bank, sheet) {
  const free = new Set(sheet.map(s => s.id));
  const matches = [], unmatched = [];
  const ordered = [...bank].sort((a, b) => a.date.localeCompare(b.date));
  for (const b of ordered) {
    const inflow = b.amount < 0;
    let best = null;
    for (const s of sheet) {
      if (!free.has(s.id) || s.inflow !== inflow || cents(s.amount) !== cents(b.amount)) continue;
      const d = dayDiff(s.date, b.date);
      if (d > MATCH_DAYS) continue;
      if (!best || d < best.d) best = { s, d };
    }
    if (best) { free.delete(best.s.id); matches.push({ external_id: b.external_id, id: best.s.id }); }
    else unmatched.push(b.external_id);
  }
  return { matches, unmatched };
}
