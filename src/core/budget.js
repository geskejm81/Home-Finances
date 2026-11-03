// Budgets: what a category usually costs, which way it is heading, what to plan for,
// and how actuals compare. Pure reads over state; no DOM.

import { S, catGroup } from './store.js';
import { agg, month, typical } from './model.js';
import { TODAY, ym, addYm } from './format.js';

const INVERSE = new Set(['income', 'savings']);       // for these, more is better
export const isInverse = group => INVERSE.has(group);

/** Latest locked revision for a year, or null. */
export function lockedBudget(year) {
  const revs = (S.budgets || []).filter(b => b.year === year).sort((a, b) => b.rev - a.rev);
  return revs[0] || null;
}
export const revisions = year => (S.budgets || []).filter(b => b.year === year).sort((a, b) => b.rev - a.rev);

/**
 * Monthly budget for a category or group in a given month.
 * Uses the year's locked budget; without one, falls back to typical spend (trailing 6 months).
 * Returns { amount, locked }.
 */
export function budgetFor(k, key, isGroup = false) {
  const b = lockedBudget(+k.slice(0, 4));
  if (!b) return { amount: typical(k, key, isGroup), locked: false };
  if (!isGroup) return { amount: +b.lines[key] || 0, locked: true };
  if (key === 'left') {
    const g = groupBudgets(b.lines);
    return { amount: g.income - g.savings - g.fixed - g.variable, locked: true };
  }
  return { amount: groupBudgets(b.lines)[key] || 0, locked: true };
}
export function groupBudgets(lines) {
  const G = catGroup(), out = { income: 0, savings: 0, fixed: 0, variable: 0 };
  for (const [c, v] of Object.entries(lines || {})) if (G[c]) out[G[c]] += +v || 0;
  out.left = out.income - out.savings - out.fixed - out.variable;
  return out;
}

/**
 * How an actual compares with its budget: 'g' | 'y' | 'r' | ''.
 * Spending: under 80% green, 80–100% yellow, over red. Income/savings/left: the reverse.
 */
export function status(actual, budget, inverse = false) {
  if (!budget) return inverse || !actual ? '' : 'r';
  const r = actual / budget;
  if (inverse) return r >= 1 ? 'g' : r >= 0.8 ? 'y' : 'r';
  return r < 0.8 ? 'g' : r <= 1 ? 'y' : 'r';
}

/** Last fully finished month. */
export const lastComplete = () => addYm(ym(TODAY), -1);

/** Monthly totals for a category from the first month with any data through the last complete month. */
export function series(cat) {
  const months = Object.keys(agg()).sort();
  if (!months.length) return [];
  const out = [], end = lastComplete();
  for (let k = months[0]; k <= end; k = addYm(k, 1)) out.push([k, month(k).cats[cat] || 0]);
  return out;
}

/** Average per month over a year's complete months that have data. */
export function runRate(cat, year) {
  const end = lastComplete(); let s = 0, n = 0;
  for (let i = 1; i <= 12; i++) {
    const k = `${year}-${String(i).padStart(2, '0')}`;
    if (k > end || !agg()[k]) continue;
    s += month(k).cats[cat] || 0; n++;
  }
  return n ? s / n : null;
}

const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const median = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };

/**
 * Direction over the last 12 complete months: 'up' | 'down' | 'flat' | 'spike' | 'none'.
 * 'spike' = one month far above the rest (a one-off). 'up'/'down' = least-squares slope over 15%/yr of the mean.
 */
export function trend(values) {
  const v = values.slice(-12);
  if (!v.length || v.every(x => !x)) return 'none';
  const sorted = [...v].sort((a, b) => b - a), med = median(v);
  if (sorted[0] > 3 * Math.max(med, 1) && sorted[0] > 2 * Math.max(sorted[1], 1)) return 'spike';
  const n = v.length, xm = (n - 1) / 2, ym_ = mean(v);
  let num = 0, den = 0;
  v.forEach((y, x) => { num += (x - xm) * (y - ym_); den += (x - xm) ** 2; });
  const yearly = den ? (num / den) * 12 : 0;
  const pct = ym_ ? yearly / ym_ : 0;
  return pct > 0.15 ? 'up' : pct < -0.15 ? 'down' : 'flat';
}

const roundTo = (x, down = false) => {
  const step = x >= 200 ? 10 : x >= 20 ? 5 : 1;
  return (down ? Math.floor : Math.ceil)(x / step - 1e-9) * step;
};

/**
 * Suggested monthly budget for `year`, from what has actually happened.
 *  fixed:    the higher of the last 3 months and last year's run rate (bills step up, rarely down)
 *  variable: one-off spike → median month; growing → last 6 months; otherwise last 12 months
 *  income:   last 3 months, rounded down; one-offs → median
 *  savings:  last 3 months
 */
export function suggestBudget(cat, year) {
  const g = catGroup()[cat];
  const v = series(cat).map(x => x[1]);
  if (!v.length) return 0;
  const last = n => mean(v.slice(-n)), t = trend(v), rr = runRate(cat, year - 1) ?? last(12);
  let x;
  if (g === 'fixed') x = Math.max(last(3), rr);
  else if (g === 'income') x = t === 'spike' ? median(v.slice(-12)) : last(3);
  else if (g === 'savings') x = last(3);
  else x = t === 'spike' ? median(v.slice(-12)) : t === 'up' ? last(6) : last(12);
  return Math.max(0, roundTo(x, g === 'income'));
}

/** The working lines shown in the Budget tab: draft value, else locked value, else suggestion. */
export function workingLines(year) {
  const draft = S.budgetDrafts?.[year]?.lines, locked = lockedBudget(year)?.lines;
  const out = {};
  for (const c of S.cats) {
    const d = draft?.[c.name], l = locked?.[c.name];
    out[c.name] = d != null ? +d : l != null ? +l : suggestBudget(c.name, year);
  }
  return out;
}
