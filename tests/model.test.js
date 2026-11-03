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
  const dep = byName('Knauf Insulation'), s = suggest(dep);
  assert.equal(s.type, 'reimb');
  close(s.ids.reduce((a, id) => a + txById(id).a, 0), -dep.a);
});

test('subset match finds exact cents', () => {
  const items = [{ id: 1, a: 10.10 }, { id: 2, a: 5.05 }, { id: 3, a: 7.77 }, { id: 4, a: 2.23 }];
  assert.deepEqual(subsetMatch(items, 10).sort(), [3, 4]);
  assert.equal(subsetMatch(items, 999), null);
});

test('accepting everything: Knauf deposit clears submitted items and stays out of income', () => {
  fresh();
  const income = month(ym(TODAY)).income;
  const owed = knaufSummary().outstanding, dep = -byName('Knauf Insulation').a;
  run('tx.acceptAll');
  assert.equal(inbox().filter(t => suggest(t).type !== 'none').length, 0);
  assert.equal(knaufSummary().submitted.length, 0);
  close(knaufSummary().outstanding, owed - dep + 214.06 + 18.40);
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
