// One color per category, defined here and reused by the donut, badges, and fallback icons.
// The six chart hues go to the categories that matter most over the last 12 months
// (stable: color follows the category, not this month's rank). Others get a softer tint
// and fold into "Other" in charts.

import { catGroup, S } from './store.js';
import { month } from './model.js';
import { TODAY, ym, addYm } from './format.js';

export const SLOTS = 6;                       // --c1 … --c6 in styles.css
const SPEND = new Set(['fixed', 'variable']);

let cache = { key: '', top: {} };
/** Categories ranked by trailing-12-month spend, per scope ('all' | 'variable'). */
export function topCategories(scope = 'all') {
  const key = `${S.txns?.length}|${S.cats?.length}|${ym(TODAY)}`;
  if (cache.key !== key) cache = { key, top: {} };
  if (cache.top[scope]) return cache.top[scope];
  const G = catGroup(), tot = {};
  for (let i = 1; i <= 12; i++) for (const [c, v] of Object.entries(month(addYm(ym(TODAY), -i)).cats)) {
    if (scope === 'variable' ? G[c] === 'variable' : SPEND.has(G[c])) tot[c] = (tot[c] || 0) + v;
  }
  return (cache.top[scope] = Object.entries(tot).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c));
}

const hash = s => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/** CSS color for a category. Top categories get a chart hue; the rest a stable tint. */
export function catColor(c, scope = 'all') {
  if (!c) return 'var(--text3)';
  const i = topCategories(scope).indexOf(c);
  if (i >= 0 && i < SLOTS) return `var(--c${i + 1})`;
  return `var(--t${(hash(c) % 8) + 1})`;
}
/** Is this category one of the colored slices, or part of "Other"? */
export const inChart = (c, scope = 'all') => { const i = topCategories(scope).indexOf(c); return i >= 0 && i < SLOTS; };
