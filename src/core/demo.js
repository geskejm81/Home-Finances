// Sample household used until the database is connected.
// Deterministic: the same date always produces the same data.
// Everything here is invented: merchants, people, amounts.

import { cleanName, addDays, iso } from './format.js';

const CATS = {
  income: ['Paycheck 15th', 'Paycheck 30th', 'Extra Income'],
  savings: ['529 Plan', 'Brokerage', 'Emergency Fund'],
  fixed: ['Mortgage', 'Electric', 'Gas Utility', 'Water', 'Sewer & Trash', 'Internet', 'Cell Phone', 'Streaming TV',
    'Music Streaming', 'Cloud Storage', 'Home Security', 'Auto Loan', 'Life Insurance'],
  variable: ['Groceries', 'Restaurants', 'Alcohol & Bars', 'Auto: Gas', 'Auto: Maintenance', 'Clothing', 'Home Supplies',
    'Home Furnishings', 'Home Repair', 'Kids Activities', 'Family Activities', 'Gifts', 'Medical', 'Personal Care',
    'Electronics', 'Apps & Media', 'Travel', 'Pets', 'Annual Fees'],
};

// [category, merchants, visits per month, low, high]
const SPEND = [
  ['Groceries', ['KROGER #932', 'COSTCO WHSE #0376', "TRADER JOE'S #551", 'ALDI 74018'], 9, 25, 210],
  ['Restaurants', ['CHIPOTLE 1840', 'PANERA BREAD #6021', 'STARBUCKS 22891', 'MAIN ST DINER'], 10, 6, 85],
  ['Alcohol & Bars', ['TAPROOM BREWING CO'], 1.5, 18, 70],
  ['Auto: Gas', ['SHELL OIL 5744', 'SPEEDWAY 0412', 'BP#9921'], 6, 35, 72],
  ['Auto: Maintenance', ['JIFFY LUBE #188', 'MISTER CAR WASH'], 0.8, 12, 140],
  ['Clothing', ['OLD NAVY #4410', 'TARGET 00012', 'GAP 1189', 'NIKE.COM'], 2.5, 20, 160],
  ['Home Supplies', ['TARGET 00012', 'AMAZON.COM*2K4L1', 'WALMART #1820'], 3, 12, 95],
  ['Home Furnishings', ['IKEA INDIANAPOLIS', 'WAYFAIR*8812'], 0.4, 60, 420],
  ['Home Repair', ['THE HOME DEPOT #2309', "LOWE'S #1114"], 1, 15, 260],
  ['Kids Activities', ['LESSONS STUDIO', 'YOUTH SOCCER LEAGUE', 'SWIM ACADEMY'], 3, 40, 180],
  ['Family Activities', ['AMC THEATRES 811', 'CITY ZOO', 'BOWLERO'], 1.5, 25, 120],
  ['Gifts', ['ETSY.COM', 'AMAZON.COM*7H2Q9'], 1.2, 20, 110],
  ['Medical', ['CVS/PHARMACY #6610', 'WALGREENS #1192'], 1.2, 8, 60],
  ['Personal Care', ['GREAT CLIPS #770', 'ULTA BEAUTY #331'], 1.5, 18, 75],
  ['Electronics', ['BEST BUY 00418'], 0.3, 25, 300],
  ['Apps & Media', ['APPLE.COM/BILL', 'GOOGLE *PLAY'], 2, 2, 15],
  ['Travel', ['DELTA AIR 0062', 'HAMPTON INN'], 0.25, 120, 600],
  ['Pets', ['CHEWY.COM', 'PETCO 1203'], 1.2, 20, 90],
];

// [category, merchant, day, amount or [low, high], {changes: [[monthsAgo, amount]]}]
const BILLS = [
  ['Mortgage', 'NEWHOME MORTGAGE', 1, 2150.00],
  ['Electric', 'CITY ELECTRIC', 3, [120, 260]],
  ['Gas Utility', 'METRO GAS', 6, [45, 190]],
  ['Water', 'CITY WATER', 7, [48, 95]],
  ['Sewer & Trash', 'CITY SEWER TRASH', 15, 68.11],
  ['Internet', 'FIBERNET', 5, 79.99],
  ['Cell Phone', 'WIRELESS CO', 1, 165.00, [[5, 181.00]]],
  ['Streaming TV', 'STREAMTV', 23, 94.99, [[2, 104.99]]],
  ['Music Streaming', 'MUSICBOX', 10, 19.99, [[7, 21.99]]],
  ['Cloud Storage', 'CLOUDSAFE', 1, 9.99],
  ['Home Security', 'HOMESECURE', 23, 32.99],
  ['Auto Loan', 'AUTO FINANCE', 23, 612.40],
  ['Life Insurance', 'LIFE MUTUAL', 14, 48.20],
];

const KNAUF = [['MARRIOTT', 180, 420], ['DELTA AIR 0062', 280, 640], ['UBER TRIP', 12, 48], ['COURTYARD', 160, 260],
  ['HERTZ RENT-A-CAR', 90, 240], ['GBT TRAVEL FEE', 5, 11]];

const PEOPLE = ['Alex', 'Sam', 'Riley', 'Jordan'];

function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function demoState(today) {
  const r = rng(20261103);
  const pick = a => a[Math.floor(r() * a.length)];
  const amt = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 100) / 100;
  const txns = []; let id = 1;
  const push = t => { txns.push({ id: id++, ...t }); return txns[txns.length - 1]; };
  const bank = (d, raw, a, c, extra = {}) => push({ d, m: cleanName(raw), raw, a, c, acct: 'visa', src: 'bank', ...extra });

  const end = new Date(today + 'T12:00:00');
  const start = new Date(end.getFullYear(), end.getMonth() - 16, 1, 12);
  const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();

  for (let m = new Date(start); m <= end; m = new Date(m.getFullYear(), m.getMonth() + 1, 1, 12)) {
    const y = m.getFullYear(), mo = m.getMonth(), dim = new Date(y, mo + 1, 0).getDate();
    const ago = monthsBetween(m, end);
    const day = d => iso(new Date(y, mo, Math.min(d, dim), 12));
    const sched = d => (day(d) > today ? { s: 1 } : {});
    const lastMonth = ago === 0;
    // pay, savings, bills (scheduled for the rest of the current month)
    const pay = ago <= 1 ? 6480.00 : 6215.50;
    push({ d: day(15), m: 'Payroll', a: pay, c: 'Paycheck 15th', acct: 'chk', src: 'bank', ...sched(15) });
    push({ d: day(30), m: 'Payroll', a: pay, c: 'Paycheck 30th', acct: 'chk', src: 'bank', ...sched(30) });
    if (r() < 0.25 && !lastMonth) push({ d: day(9 + Math.floor(r() * 15)), m: 'Marketplace Sale', a: amt(20, 260), c: 'Extra Income', acct: 'chk', src: 'bank' });
    push({ d: day(15), m: '529 Plan', a: 300, c: '529 Plan', acct: 'chk', src: 'bank', ...sched(15) });
    push({ d: day(1), m: 'Brokerage', a: ago % 3 === 0 ? 1000 : 500, c: 'Brokerage', acct: 'chk', src: 'bank', ...sched(1) });
    for (const [c, raw, d, base, changes = []] of BILLS) {
      let a = Array.isArray(base) ? amt(...base) : base;
      for (const [since, v] of changes) if (ago <= since) a = v;
      push({ d: day(d), m: cleanName(raw), raw, a, c, acct: 'chk', src: 'bank', ...sched(d) });
    }
    if (mo === 0) push({ d: day(12), m: 'Annual Membership', a: 99, c: 'Annual Fees', acct: 'visa', src: 'bank', ...sched(12) });
    // everyday spending
    for (const [c, merchants, per, lo, hi] of SPEND) {
      const n = Math.floor(per + r());
      for (let i = 0; i < n; i++) {
        const d = day(1 + Math.floor(r() * dim));
        if (d > today) continue;
        const raw = pick(merchants);
        const t = bank(d, raw, amt(lo, hi), c);
        if (c === 'Kids Activities') t.p = pick(PEOPLE.slice(2));
        if (r() < 0.04) {
          const rd = iso(addDays(new Date(d + 'T12:00:00'), 3 + Math.floor(r() * 9)));
          if (rd <= today) bank(rd, raw, -Math.round(t.a * (r() < 0.5 ? 1 : 0.5) * 100) / 100, c, { ret: t.id });
        }
      }
    }
    // work travel paid personally (Knauf)
    if (ago <= 5) {
      const trips = 1 + Math.floor(r() * 2);
      for (let i = 0; i < trips; i++) {
        const d0 = 3 + Math.floor(r() * (dim - 6));
        for (const [raw, lo, hi] of KNAUF) {
          if (r() < 0.25) continue;
          const d = day(d0 + Math.floor(r() * 3)); if (d > today) continue;
          push({ d, m: cleanName(raw), raw, a: amt(lo, hi), k: ago >= 2 ? 'reimbursed' : ago === 1 ? 'submitted' : 'open', acct: 'amex', src: 'bank' });
        }
      }
    }
  }
  // drop returns dated in the future
  for (let i = txns.length - 1; i >= 0; i--) if (txns[i].d > today && !txns[i].s) txns.splice(i, 1);

  // a purchase a week ago to be returned from the inbox
  const wk = iso(addDays(end, -9));
  bank(wk, 'ARITZIA', 136.38, 'Clothing');

  // the bank feed waiting for review (Plaid sign: + out, − in)
  const submitted = txns.filter(t => t.k === 'submitted').reduce((s, t) => s + t.a, 0);
  const d0 = today, d1 = iso(addDays(end, -1)), d2 = iso(addDays(end, -2));
  const feed = [
    [d0, 'ARITZIA', -68.19, 'visa'],
    [d0, 'KNAUF INSULATION EXP REIMB', -Math.round(submitted * 100) / 100, 'chk'],
    [d0, 'COURTYARD WACO', 214.06, 'amex'],
    [d1, 'KROGER #932', 143.18, 'visa'],
    [d1, 'AMAZON.COM*9QX21', 86.42, 'visa'],
    [d1, 'UBER TRIP', 18.40, 'amex'],
    [d1, 'PAYMENT THANK YOU TARGET CARD', 642.10, 'chk'],
    [d2, 'SHELL OIL 5744', 58.20, 'visa'],
    [d2, 'COSTCO WHSE #0376', 312.55, 'visa'],
    [d2, 'STARBUCKS 22891', 7.45, 'visa'],
  ];
  for (const [d, raw, a, acct] of feed) if (a !== 0) push({ d, m: cleanName(raw), raw, a, acct, src: 'bank', inbox: 1 });

  const y = end.getFullYear();
  return {
    v: 1,
    nextId: id,
    demo: true,
    cats: Object.entries(CATS).flatMap(([group, names]) => names.map(name => ({ name, group }))),
    people: PEOPLE,
    txns: txns.sort((a, b) => a.d.localeCompare(b.d) || a.id - b.id),
    projects: [
      { id: 'p1', year: y - 1, when: 'May', name: 'Exterior Painting', a: 6400 },
      { id: 'p2', year: y - 1, when: 'Aug', name: 'New Couch', a: 2850 },
      { id: 'p3', year: y, when: 'Mar', name: 'Spring Break', a: 4200 },
      { id: 'p4', year: y, when: 'Jul', name: 'Patio', a: 3100 },
    ],
    accounts: [{ id: 'chk', name: 'Checking' }, { id: 'visa', name: 'Visa' }, { id: 'amex', name: 'Amex' }],
    rules: [
      { m: 'kroger', c: 'Groceries' }, { m: 'shell', c: 'Auto: Gas' }, { m: 'starbucks', c: 'Restaurants' },
      { m: 'costco', c: 'Groceries' }, { m: 'payment thank you target card', x: 1 },
    ],
  };
}
