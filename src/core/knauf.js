// Knauf reimbursement logic: which charges a deposit or report covers, variance, lag, ages.
// Pure reads over state; no DOM.

import { S, txById } from './store.js';
import { TODAY, dObj } from './format.js';

const cents = n => Math.round(Math.abs(+n || 0) * 100);
const days = (a, b) => Math.round((dObj(b) - dObj(a)) / 864e5);
export const age = t => days(t.d, TODAY);

/** Charges a deposit could pay: open and approved, oldest first. */
export const payable = () => S.txns.filter(t => t.k === 'open' || t.k === 'approved').sort((a, b) => a.d.localeCompare(b.d) || a.id - b.id);

/** Spec helper: pre-select open charges oldest first until the next one would push the sum over the deposit. */
export function preselect(depositAmount, list = payable()) {
  const target = cents(depositAmount), ids = []; let sum = 0;
  for (const t of list) { const c = cents(t.a); if (sum + c > target) break; sum += c; ids.push(t.id); }
  return ids;
}

/** Deposit − matched charges (positive = reports included meals, mileage, etc. not on the cards). */
export function variance(deposit, ids) {
  const matched = ids.reduce((s, id) => s + (txById(id)?.a || 0), 0);
  return Math.round((Math.abs(deposit.a) - matched) * 100) / 100;
}

/** Average days from charge date to the deposit that paid it, across matched charges. */
export function lag() {
  const pairs = S.txns.filter(t => t.kdep).map(t => { const d = txById(t.kdep); return d ? days(t.d, d.d) : null; }).filter(x => x != null);
  return pairs.length ? Math.round(pairs.reduce((s, x) => s + x, 0) / pairs.length) : null;
}

/** Approved reports no deposit has paid yet, oldest first. */
export const unpaidReports = () => (S.reports || []).filter(r => !r.dep).sort((a, b) => String(a.approved || '').localeCompare(String(b.approved || '')));

/** The report a deposit most likely pays: exact total first, otherwise the closest, oldest first. */
export function reportForDeposit(deposit) {
  const list = unpaidReports(); if (!list.length) return null;
  const exact = list.find(r => cents(r.total) === cents(deposit.a));
  if (exact) return { report: exact, exact: true };
  const best = [...list].sort((a, b) => Math.abs(cents(a.total) - cents(deposit.a)) - Math.abs(cents(b.total) - cents(deposit.a)))[0];
  return { report: best, exact: false };
}

const words = s => new Set(String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length > 2));
const overlap = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n; };

export const MATCH_DAYS = 5;

/**
 * Pair report lines with card charges: amount to the cent, then date (charges post a few days
 * after purchase), then merchant words. Knauf charges (suggested/open/approved, not on another
 * report) are preferred; any other charge is a fallback. One charge per line. When two charges
 * tie (identical fares), the line is left for you to pick.
 * Returns [{ line, pick: txId|null, options: [txId], ambiguous }].
 */
export function matchLines(lines, reportId = null) {
  const used = new Set();
  const free = t => t.a > 0 && t.k !== 'deposit' && t.k !== 'reimbursed' && (!t.krep || t.krep === reportId);
  const tier = t => (t.k === 'suggested' || t.k === 'open' || t.k === 'approved') ? 0 : 1;
  return lines.map(line => {
    const opts = S.txns.filter(t => free(t) && cents(t.a) === cents(line.a) && (!line.d || Math.abs(days(line.d, t.d)) <= MATCH_DAYS))
      .map(t => ({ t, score: [tier(t), line.d ? Math.abs(days(line.d, t.d)) : 0, -overlap(line.m, t.m || t.n || t.raw)] }))
      .sort((x, y) => x.score[0] - y.score[0] || x.score[1] - y.score[1] || x.score[2] - y.score[2]);
    const avail = opts.filter(o => !used.has(o.t.id));
    const top = avail[0];
    const tied = top && avail.slice(1).some(o => o.score[0] === top.score[0] && o.score[1] === top.score[1] && o.score[2] === top.score[2]);
    const pick = top && !tied ? top.t.id : null;
    if (pick) used.add(pick);
    return { line, pick, options: opts.map(o => o.t.id), ambiguous: !!tied };
  });
}

/** Open Knauf charges inside the report's dates that weren't on it — for the next report. */
export function leftovers(lines, pickedIds) {
  const ds = lines.map(l => l.d).filter(Boolean).sort();
  if (!ds.length) return [];
  const picked = new Set(pickedIds);
  return S.txns.filter(t => (t.k === 'open' || t.k === 'suggested') && t.d >= ds[0] && t.d <= ds.at(-1) && !picked.has(t.id));
}
