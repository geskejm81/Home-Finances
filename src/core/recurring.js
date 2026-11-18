// Recurring charges: same merchant, similar amount, at a regular cadence over more than 30 days.

import { S, label } from './store.js';
import { counts } from './model.js';
import { dObj, TODAY } from './format.js';

const CADENCES = [['weekly', 7, 2], ['every 2 weeks', 14, 3], ['monthly', 30.4, 5], ['quarterly', 91, 12], ['yearly', 365, 25]];
const median = a => { const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const iso = d => d.toISOString().slice(0, 10);

/** [{ name, cadence, amount, last, next, n, changed }] newest-first by next date. */
export function recurring({ since = 400 } = {}) {
  const from = iso(new Date(dObj(TODAY) - since * 864e5)), by = new Map();
  for (const t of S.txns) {
    if (!counts(t) || t.a <= 0 || t.d < from || t.d > TODAY) continue;
    const key = label(t).trim().toLowerCase(); if (!key) continue;
    (by.get(key) || by.set(key, []).get(key)).push(t);
  }
  const out = [];
  for (const list of by.values()) {
    if (list.length < 3) continue;
    list.sort((a, b) => a.d.localeCompare(b.d));
    const span = (dObj(list.at(-1).d) - dObj(list[0].d)) / 864e5; if (span <= 30) continue;
    const gaps = list.slice(1).map((t, i) => (dObj(t.d) - dObj(list[i].d)) / 864e5).filter(g => g > 0);
    if (gaps.length < 2) continue;
    const g = median(gaps), c = CADENCES.find(([, d, tol]) => Math.abs(g - d) <= tol); if (!c) continue;
    const regular = gaps.filter(x => Math.abs(x - c[1]) <= c[2] * 1.5).length / gaps.length; if (regular < 0.7) continue;
    const amts = list.map(t => t.a), med = median(amts.slice(-6));
    if (amts.slice(-6).some(a => Math.abs(a - med) / med > 0.25)) continue;      // amounts must be similar
    const last = list.at(-1), next = iso(new Date(dObj(last.d).getTime() + c[1] * 864e5));
    const prev = list.at(-2);
    out.push({ name: label(last), cadence: c[0], amount: last.a, last: last.d, next, n: list.length, cat: last.c,
      changed: Math.abs(last.a - prev.a) > 0.009 ? prev.a : null, t: last });
  }
  return out.sort((a, b) => a.next.localeCompare(b.next));
}
