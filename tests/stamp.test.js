import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stamped } from '../scripts/stamp.mjs';

test('index.html fingerprints match the code (run node scripts/stamp.mjs)', () => {
  assert.equal(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), stamped().html);
});
