// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, setState, seed, txById } from '../src/core/store.js';
import { run, undo, month, suggest, inbox, knaufSummary, netOf, subsetMatch } from '../src/core/model.js';
import { cleanName, TODAY, ym } from '../src/core/format.js';

const fresh = () => setState(seed());
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.005, `${a} ≠ ${b}`);
const byName = m => inbox().find(t => t.m === m);

test('sample data is internally consistent', () => {
  fresh();
  const cats = new Set(S.cats.map(c => c.name));
  for (const t of S.txns) if (t.c) assert.ok(cats.has(t.c), `unknown category ${t.c}`);
  assert.equal(new Set(S.txns.map(t => t.id)).size, S.txns.length, 'ids are unique');
  assert.equal(inbox().length, 10);
});

test('left = income − savings − fixed − variable, every month', () => {
  fresh();
  for (const t of S.txns) {
    const m = month(ym(t.d));
    close(m.left, m.income - m.savings - m.fixed - m.variable);
  }
});

test('bank names are cleaned', () => {
  assert.equal(cleanName('COSTCO WHSE #0376'), 'Costco');
  assert.equal(cleanName('AMAZON.COM*2K4L1'), 'Amazon');
  assert.equal(cleanName('PAYMENT THANK YOU TARGET CARD'), 'Target Card payment');
});

test('inbox suggestions', () => {
  fresh();
  assert.equal(suggest(byName('Aritzia')).type, 'return');
  assert.equal(suggest(byName('Courtyard Waco')).type, 'knauf');
  assert.equal(suggest(byName('Uber')).type, 'knauf');
  assert.deepEqual(suggest(byName('Kroger')), { type: 'cat', c: 'Groceries', label: 'Groceries' });
  assert.equal(suggest(byName('Target Card payment')).type, 'transfer');
  const dep = byName('Knauf Insulation Direct-Pay'), s = suggest(dep);
  assert.equal(s.type, 'reimb');
  close(s.ids.reduce((a, id) => a + txById(id).a, 0), -dep.a);
});

test('subset match finds exact cents', () => {
  const items = [{ id: 1, a: 10.10 }, { id: 2, a: 5.05 }, { id: 3, a: 7.77 }, { id: 4, a: 2.23 }];
  assert.deepEqual(subsetMatch(items, 10).sort(), [3, 4]);
  assert.equal(subsetMatch(items, 999), null);
});

test('accepting everything: Knauf deposit clears approved items and stays out of income', () => {
  fresh();
  const income = month(ym(TODAY)).income;
  const owed = knaufSummary().outstanding, dep = -byName('Knauf Insulation Direct-Pay').a;
  run('tx.acceptAll');
  assert.equal(inbox().filter(t => suggest(t).type !== 'none').length, 0);
  assert.equal(knaufSummary().approved.length, 0);
  close(knaufSummary().outstanding, owed - dep);                 // Courtyard and Uber wait for a tick
  assert.equal(knaufSummary().suggested.length, 2);
  close(month(ym(TODAY)).income, income);
});

test('return links to purchase and nets it', () => {
  fresh();
  const r = byName('Aritzia'), orig = txById(suggest(r).of);
  run('tx.accept', { id: r.id });
  close(netOf(orig), orig.a - 68.19);
  assert.equal(txById(r.id).c, orig.c);
});

test('split keeps the total; recategorizing learns a rule; undo restores', () => {
  fresh();
  const c = byName('Costco');
  run('tx.split', { id: c.id, parts: [{ c: 'Groceries', a: 250 }, { c: 'Home Supplies', a: 62.55 }] });
  close(txById(c.id).split.reduce((s, p) => s + p.a, 0), 312.55);
  const a = byName('Amazon');
  run('tx.setCategory', { id: a.id, c: 'Gifts' });
  assert.equal(S.rules[0].m, 'amazon');
  assert.equal(suggest({ id: -1, m: 'Amazon', raw: 'AMAZON.COM*ZZ1', a: 10 }).c, 'Gifts');
  assert.ok(undo());
  assert.ok(txById(a.id).inbox);
});

import { reconcile } from '../supabase/functions/plaid/match.js';

test('November reconciliation: amount, direction, and a few days', () => {
  const sheet = [
    { id: 1, date: '2026-11-01', amount: 1884.16, inflow: false },   // mortgage entered in the sheet
    { id: 2, date: '2026-11-15', amount: 6742.00, inflow: true },    // pay
    { id: 3, date: '2026-11-05', amount: 82.90, inflow: false },
    { id: 4, date: '2026-11-20', amount: 82.90, inflow: false },     // same amount, later
  ];
  const bank = [
    { external_id: 'a', date: '2026-11-02', amount: 1884.16 },       // posts a day late → match 1
    { external_id: 'b', date: '2026-11-14', amount: -6742.00 },      // inflow → match 2
    { external_id: 'c', date: '2026-11-06', amount: 82.90 },         // → 3, not 4
    { external_id: 'd', date: '2026-11-06', amount: 82.90 },         // 4 is 14 days away → Inbox
    { external_id: 'e', date: '2026-11-03', amount: 143.18 },        // not in sheet → Inbox
    { external_id: 'f', date: '2026-11-15', amount: 6742.00 },       // right amount, wrong direction → Inbox
  ];
  const { matches, unmatched } = reconcile(bank, sheet);
  assert.deepEqual(matches.sort((x, y) => x.id - y.id), [{ external_id: 'a', id: 1 }, { external_id: 'b', id: 2 }, { external_id: 'c', id: 3 }]);
  assert.deepEqual(unmatched.sort(), ['d', 'e', 'f']);
});

import { trend, status, budgetFor, workingLines, lockedBudget } from '../src/core/budget.js';

test('budget status colors: spending vs income', () => {
  assert.equal(status(70, 100), 'g'); assert.equal(status(85, 100), 'y'); assert.equal(status(101, 100), 'r');
  assert.equal(status(100, 100, true), 'g'); assert.equal(status(85, 100, true), 'y'); assert.equal(status(50, 100, true), 'r');
});

test('trend: growing, flat, one-off spike', () => {
  assert.equal(trend([100,105,110,118,125,130,140,150,155,165,170,180]), 'up');
  assert.equal(trend([100,98,103,101,99,100,102,97,100,101,99,100]), 'flat');
  assert.equal(trend([50,55,48,52,50,900,51,49,53,50,52,48]), 'spike');
});

test('budget: draft → lock → revise needs a reason; locked budget drives budgetFor', () => {
  fresh();
  const y = +TODAY.slice(0, 4);
  const lines = workingLines(y);
  assert.ok(lines.Groceries > 0, 'suggestion for groceries');
  assert.ok(lines.Mortgage >= 2150, 'fixed bills suggest at least the current amount');
  run('budget.lock', { year: y, lines });
  assert.equal(lockedBudget(y).rev, 1);
  assert.equal(budgetFor(ym(TODAY), 'Groceries').amount, lines.Groceries);
  assert.throws(() => run('budget.set', { year: y, c: 'Groceries', a: 1 }));
  run('budget.revise', { year: y });
  run('budget.set', { year: y, c: 'Groceries', a: lines.Groceries + 100 });
  assert.throws(() => run('budget.lock', { year: y, lines: workingLines(y), reason: ' ' }));
  run('budget.lock', { year: y, lines: workingLines(y), reason: 'More people at home' });
  assert.equal(lockedBudget(y).rev, 2);
  assert.equal(budgetFor(ym(TODAY), 'Groceries').amount, lines.Groceries + 100);
  assert.equal(S.budgets.length, 2, 'the first revision is kept');
});

import { readFileSync } from 'node:fs';
import { isKnaufDeposit } from '../src/core/knauf-rules.js';

test('Knauf deposits are DIRECT-PAY only; payroll stays income', () => {
  assert.ok(isKnaufDeposit('KNAUF INSULATION DIRECT-PAY PPD ID: 1234'));
  assert.ok(isKnaufDeposit('Knauf Insulation Direct Pay'));
  assert.equal(isKnaufDeposit('KNAUF INSULATION PAYROLL PPD ID: 1234'), false);
  assert.equal(isKnaufDeposit('KNAUF INSULATION EXP REIMB'), false);
  fresh();
  const pay = { id: -1, m: 'Knauf Insulation', raw: 'KNAUF INSULATION PAYROLL', a: -6742, inbox: 1 };
  assert.notEqual(suggest(pay).type, 'reimb');
});

test('the Plaid function uses the same Knauf rules file', () => {
  assert.equal(readFileSync('supabase/functions/plaid/knauf-rules.js', 'utf8'), readFileSync('src/core/knauf-rules.js', 'utf8'));
});

import { readXlsx, readCsv, rowsToReport } from '../src/data/report-file.js';
import { preselect, matchLines, leftovers, reportForDeposit } from '../src/core/knauf.js';

test('reads an approved report export (.xlsx): header block, columns, totals row skipped', async () => {
  const rows = await readXlsx(readFileSync('tests/fixtures/report-sample.xlsx'));
  const r = rowsToReport(rows, 'report-sample.xlsx');
  assert.equal(r.ref, 'R-1001');
  assert.equal(r.approved, '2026-11-10');
  assert.equal(r.lines.length, 4);
  assert.deepEqual(r.lines[0], { d: '2026-10-26', m: 'United Airlines', a: 379.43, type: 'Airfare' });
  close(r.total, 859.98);
});

test('reads a .csv export with quoted fields and $ amounts', () => {
  const r = rowsToReport(readCsv(readFileSync('tests/fixtures/report-sample.csv', 'utf8')), 'x.csv');
  assert.equal(r.ref, 'R-2002');
  assert.deepEqual(r.lines.map(l => [l.d, l.m, l.a]), [['2026-10-28', 'Courtyard, Waco', 246.38], ['2026-10-28', 'Hertz', 1237.66]]);
});

test('deposit helper: oldest first until the next would go over', () => {
  const list = [{ id: 1, a: 100 }, { id: 2, a: 50 }, { id: 3, a: 80 }];
  assert.deepEqual(preselect(-170, list), [1, 2]);
  assert.deepEqual(preselect(-230, list), [1, 2, 3]);
});

test('report lines match charges by cents and date; identical fares are left to pick; save + pay', () => {
  fresh();
  const charges = S.txns.filter(t => t.k === 'approved' || t.k === 'open').slice(0, 2);
  const twin = { ...charges[0], id: 999001, k: 'open' };            // identical fare, same day
  S.txns.push(twin);
  const lines = [
    { d: charges[0].d, m: charges[0].m, a: charges[0].a, type: 'Airfare' },
    { d: charges[1].d, m: charges[1].m, a: charges[1].a, type: 'Hotel' },
    { d: charges[1].d, m: 'Mileage', a: 12.34, type: 'Mileage' },
  ];
  const m = matchLines(lines);
  assert.equal(m[0].ambiguous, true, 'two identical charges → you pick');
  assert.equal(m[0].pick, null);
  assert.equal(m[1].pick, charges[1].id);
  assert.equal(m[2].pick, null);
  assert.ok(leftovers(lines, [charges[1].id]).every(t => t.id !== charges[1].id));
  // you pick the first fare; the report is saved and its charges become approved
  const total = lines.reduce((s, l) => s + l.a, 0);
  const id = run('report.save', { report: { ref: 'R-9', approved: '2026-11-10', total, lines: lines.map((l, i) => ({ ...l, tx: [charges[0].id, charges[1].id, null][i] })) } });
  assert.equal(txById(charges[0].id).k, 'approved');
  assert.equal(txById(charges[0].id).krep, id);
  // re-upload with the same ref updates instead of duplicating
  run('report.save', { report: { ref: 'R-9', approved: '2026-11-10', total, lines: lines.map((l, i) => ({ ...l, tx: [charges[0].id, null, null][i] })) } });
  assert.equal(S.reports.filter(r => r.ref === 'R-9').length, 1);
  assert.equal(txById(charges[1].id).k, 'open', 'released by the re-upload');
  // a deposit for the report total pays it
  const dep = { id: 999002, d: '2026-11-15', m: 'Knauf Insulation Direct-Pay', a: -Math.round(total * 100) / 100, src: 'bank', inbox: 1 };
  S.txns.push(dep);
  const hit = reportForDeposit(dep);
  assert.equal(hit.report.id, id); assert.equal(hit.exact, true);
  run('report.pay', { reportId: id, deposit: dep.id });
  assert.equal(txById(charges[0].id).k, 'reimbursed');
  assert.equal(txById(charges[0].id).kdep, dep.id);
  run('knauf.unmatch', { id: charges[0].id });
  assert.equal(txById(charges[0].id).k, 'approved', 'detached charge returns to its report status');
});

test('suggested Knauf: confirm and dismiss', () => {
  fresh();
  run('tx.acceptAll');
  const s = knaufSummary().suggested.map(t => t.id);
  run('knauf.confirm', { ids: [s[0]] });
  assert.equal(txById(s[0]).k, 'open');
  run('knauf.dismiss', { ids: [s[1]] });
  assert.equal(txById(s[1]).k, undefined);
  assert.ok(txById(s[1]).inbox);
});

import { recurring } from '../src/core/recurring.js';

test('recurring: monthly bills are found; one-offs are not', () => {
  fresh();
  const r = recurring();
  const names = r.map(x => x.name);
  assert.ok(names.includes('Streamtv'), 'monthly subscription');
  const st = r.find(x => x.name === 'Streamtv');
  assert.equal(st.cadence, 'monthly');
  assert.ok(!names.includes('Annual Membership'), 'yearly with one occurrence is not recurring');
});

test('Inbox: choices stay until Approve; split parts carry people', () => {
  fresh();
  const c = byName('Costco'), [p1, p2] = S.people;
  run('tx.setCategory', { id: c.id, c: 'Groceries' });
  assert.ok(txById(c.id).inbox, 'category alone does not approve');
  run('tx.split', { id: c.id, parts: [{ c: 'Groceries', a: 250, p: p1 }, { c: 'Home Supplies', a: 62.55, p: p2 }] });
  run('tx.setProject', { id: c.id, proj: S.projects[0]?.id });
  assert.ok(txById(c.id).inbox, 'split and project do not approve');
  assert.deepEqual(txById(c.id).split.map(s => s.p), [p1, p2]);
  const n = inbox().length;
  assert.equal(run('tx.acceptAll') >= 0 && !!txById(c.id).inbox, true, 'Accept all leaves decided rows alone');
  assert.ok(run('tx.approve', { id: c.id }));
  assert.ok(!txById(c.id).inbox);
  assert.ok(inbox().length < n);
  // a row with nothing chosen and no suggestion cannot be approved
  const blank = { id: 424242, d: TODAY, m: 'Zzyzx Unknown', a: 5, src: 'bank', inbox: 1 };
  S.txns.push(blank);
  assert.equal(run('tx.approve', { id: blank.id }), false);
  assert.ok(txById(blank.id).inbox);
});
