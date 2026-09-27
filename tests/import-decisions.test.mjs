import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDecisions, mergeDecisions, makeTitle, dateFromFilename, parseVotes } from '../scripts/import-decisions.mjs';

const record = (id, extra = {}) => ({ id, date: id.slice(0,10), decisionNo: id.split('-').at(-1), source: 'https://demoapi.karsiyaka.bel.tr/a.pdf', reviewed: false, ...extra });

test('parser can run after module initialization and extracts Turkish fields', () => {
  const [d] = parseDecisions('1- (MALİ HİZMETLER MÜDÜRLÜĞÜ) Ücret tarifesi güncellendi. OY BİRLİĞİ İLE KABUL EDİLDİ KARAR NO:12', 'https://demoapi.karsiyaka.bel.tr/a.pdf', '2026-09-07');
  assert.equal(d.id, '2026-09-07-12');
  assert.equal(d.department, 'Mali Hizmetler');
  assert.equal(d.votes.type, 'unanimous');
});
test('updating a year preserves previous years and reviewed summaries when PDF URL changes', () => {
  const older = record('2025-01-01-1');
  const curated = record('2026-01-01-1', { reviewed: true, title: 'Kontrol edilmiş özet' });
  const result = mergeDecisions([older, curated], [record(curated.id, { source: 'https://demoapi.karsiyaka.bel.tr/new.pdf', title: 'Otomatik başlık' })]);
  assert.equal(result.length, 2);
  assert.equal(result[0].title, curated.title);
  assert.equal(result[0].source, 'https://demoapi.karsiyaka.bel.tr/new.pdf');
  assert.deepEqual(result[1], older);
});
test('partial parse and duplicate IDs cannot overwrite the archive', () => {
  assert.throws(() => mergeDecisions([record('2026-01-01-1'), record('2026-01-01-2')], [record('2026-01-01-1')]), /Karar kaybı/);
  assert.throws(() => mergeDecisions([], [record('2026-01-01-1'), record('2026-01-01-1')]), /Tekrarlanan/);
});
test('titles do not end at article numbers or abbreviations', () => {
  assert.equal(makeTitle('2464 sayılı Kanunun 97. maddesi gereğince tarife belirlendi.'), '2464 sayılı Kanunun 97. maddesi gereğince tarife belirlendi.');
  assert.equal(makeTitle('Kent A.Ş. için işlem yapıldı.'), 'Kent A.Ş. için işlem yapıldı.');
});
test('invalid PDF dates fail rather than publishing invalid records', () => {
  assert.equal(dateFromFilename('https://example.org/07.09.2026-test.pdf'), '2026-09-07');
  assert.throws(() => dateFromFilename('https://example.org/test.pdf'));
  assert.throws(() => dateFromFilename('https://example.org/31.02.2026-test.pdf'));
});
test('Turkish and numeric dissent counts are parsed', () => {
  assert.equal(parseVotes('Dört meclis üyesi ret oyu verdi.', 'OY ÇOKLUĞU İLE KABUL EDİLDİ').against, 4);
  assert.equal(parseVotes('3 üye ret oyu verdi.', 'OY ÇOKLUĞU İLE KABUL EDİLDİ').against, 3);
});

test('title cleanup preserves commission names containing commas', () => {
  const title = makeTitle('01.04.2026 tarihli ve 48 sayılı meclis kararıyla "Deprem, Afet ve Kentsel Dönüşüm Komisyonu" üyeliği hakkında önerge.');
  assert.match(title, /Deprem, Afet/);
  assert.ok(!title.startsWith(','));
});
