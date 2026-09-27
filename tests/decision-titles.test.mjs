import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyDisplayTitle } from '../scripts/decision-titles.mjs';
import { mergeDecisions } from '../scripts/import-decisions.mjs';

const records = JSON.parse(readFileSync(new URL('../dist/data/decisions.json', import.meta.url), 'utf8'));

test('every published decision has a readable title without claiming review', () => {
  for (const record of records) {
    const incoming = { ...record, title: 'Ham PDF başlangıcı…' };
    const titled = applyDisplayTitle(incoming);
    assert.equal(titled.title, record.title, record.id);
    assert.ok(titled.title.length <= 90, record.id);
    assert.ok(!titled.title.endsWith('…'), record.id);
    assert.equal(titled.reviewed, false);
  }
});
test('reimport keeps readable titles even though no record is reviewed', () => {
  const imported = records.map(record => ({ ...record, title: 'Ham PDF başlangıcı…' }));
  const merged = mergeDecisions(records, imported);
  assert.deepEqual(merged.map(x => x.title), records.map(x => x.title));
});
test('changed text or result cannot reuse a stale title', () => {
  const record = records[0];
  for (const change of [{ text: 'Yeni kaynak metni' }, { result: 'Ret' }]) {
    const changed = { ...record, ...change, title: 'Yeni otomatik başlık' };
    assert.equal(applyDisplayTitle(changed).title, changed.title);
  }
});
