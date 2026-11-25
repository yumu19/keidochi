import test from 'node:test';
import assert from 'node:assert/strict';
import { municipalities } from '../src/municipalities.js';
import { LEVELS, STORAGE_KEY, validatePayload, loadRecords, saveRecords, summarize, filterMunicipalities, shareUrl } from '../src/model.js';

const validIds = new Set(municipalities.map(city => city.id));
const at = '2026-11-25T06:00:00.000Z';
const record = (level, note = '') => ({ level, note, updatedAt: at });

test('official dataset covers 179 unique municipalities and 14 bureaus', () => {
  assert.equal(municipalities.length, 179);
  assert.equal(validIds.size, 179);
  assert.equal(new Set(municipalities.map(c => c.region)).size, 14);
  assert.equal(new Set(municipalities.map(c => c.bureau)).size, 14);
  assert.equal(municipalities.find(c => c.name === '札幌市').id, '01100');
  assert.equal(municipalities.filter(c => c.region === '石狩').length, 8);
  assert.equal(municipalities.filter(c => c.region === '上川').length, 23);
  assert.equal(municipalities.filter(c => c.region === '後志').length, 20);
  for (const city of municipalities) {
    assert.match(city.id, /^01\d{3}$/);
    assert.ok(city.reading && city.name && city.region && city.bureau);
    assert.match(city.path, /^M[\d.]+,[\d.]+L/);
    assert.ok(city.point[0] > 0 && city.point[0] < 860);
    assert.ok(city.point[1] > 0 && city.point[1] < 560);
    assert.ok(!city.path.includes('NaN'));
  }
});

test('score and thresholds distinguish passing through, visiting, and staying', () => {
  const ids = [...validIds];
  const records = Object.fromEntries(LEVELS.map((_, level) => [ids[level], record(level)]));
  const result = summarize(records);
  assert.equal(result.score, 15);
  assert.equal(result.touched, 5);
  assert.equal(result.visited, 3);
  assert.equal(result.stayed, 2);
  assert.equal(result.counts[0], 174);
  assert.equal(result.counts.reduce((a, b) => a + b), 179);
  assert.equal(summarize({}).score, 0);
  assert.equal(summarize({}).counts[0], 179);
  assert.equal(summarize(Object.fromEntries([...validIds].map(id => [id, record(5)]))).score, 895);
});

test('records round-trip through local storage, including Japanese notes and level 0 notes', () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
  assert.deepEqual(Object.keys(loadRecords(storage, validIds).records), []);
  const records = { '01100': record(4, '雪まつりとスープカレー。\nまた行きたい！'), '01202': record(0, '次に行きたいまち') };
  saveRecords(storage, records);
  assert.ok(memory.has(STORAGE_KEY));
  const loaded = loadRecords(storage, validIds);
  assert.equal(loaded.error, null);
  assert.deepEqual({ ...loaded.records }, records);
  assert.equal(summarize(loaded.records).touched, 1);
});

test('unreadable or corrupt storage is detected without modifying the original data', () => {
  const raw = '{broken';
  let writes = 0;
  const storage = { getItem: () => raw, setItem: () => { writes++; } };
  const loaded = loadRecords(storage, validIds);
  assert.ok(loaded.error);
  assert.equal(writes, 0);
  assert.ok(loadRecords(null, validIds).error);
  assert.ok(loadRecords({ getItem() { throw new Error('denied'); } }, validIds).error);
  assert.throws(() => saveRecords({ setItem() { throw new Error('quota'); } }, {}), /quota/);
});

test('invalid imports are rejected before replacing records', () => {
  const invalid = [null, [], {}, { version: 2, records: {} }, { version: 1, records: [] },
    { version: 1, records: { '99999': record(1) } },
    ...[-1, 6, 1.5, '4', null].map(level => ({ version: 1, records: { '01100': record(level) } })),
    { version: 1, records: { '01100': record(3, 'x'.repeat(201)) } },
    { version: 1, records: { '01100': { level: 3, note: '', updatedAt: 'invalid' } } },
    { version: 1, records: { '01100': { level: 3, updatedAt: at } } },
    JSON.parse('{"version":1,"records":{"__proto__":{"level":5,"note":"","updatedAt":"2026-11-25"}}}'),
  ];
  for (const input of invalid) assert.throws(() => validatePayload(input, validIds));
  assert.equal(Object.getPrototypeOf(validatePayload({ version: 1, records: {} }, validIds)), null);
  assert.equal(validatePayload({ version: 1, records: { '01100': record(5, '<script>alert(1)</script>') } }, validIds)['01100'].note, '<script>alert(1)</script>');
});

test('search handles kanji, hiragana, katakana, half-width text and combined filters', () => {
  for (const query of ['札幌', 'さっぽろ', 'サッポロ', 'ｻｯﾎﾟﾛ', '  札幌  ']) {
    assert.equal(filterMunicipalities(municipalities, {}, { query })[0].name, '札幌市');
  }
  const shibetsu = filterMunicipalities(municipalities, {}, { query: 'しべつ' }).map(city => city.name);
  assert.ok(shibetsu.includes('士別市') && shibetsu.includes('標津町'));
  const records = { '01100': record(4) };
  assert.equal(filterMunicipalities(municipalities, records, { region: '石狩', level: '4' }).length, 1);
  assert.equal(filterMunicipalities(municipalities, records, { region: '石狩', level: '0' }).length, 7);
  assert.equal(filterMunicipalities(municipalities, records, { region: '石狩', query: '函館' }).length, 0);
  assert.equal(filterMunicipalities(municipalities, records, { query: '存在しない町' }).length, 0);
});

test('X share contains aggregate results, excludes notes and omits local preview URLs', () => {
  const records = { '01100': record(4, 'private travel note') };
  const url = new URL(shareUrl(records, 'https://example.com/keidochi/?secret=test#map'));
  assert.equal(url.origin, 'https://twitter.com');
  assert.equal(url.pathname, '/intent/tweet');
  assert.match(url.searchParams.get('text'), /4 \/ 895/);
  assert.match(url.searchParams.get('text'), /1 \/ 179/);
  assert.match(url.searchParams.get('text'), /あと178のまちが、あなたを待っています。/);
  assert.equal(url.searchParams.get('hashtags'), '経道値');
  assert.equal(url.searchParams.get('url'), 'https://example.com/keidochi/');
  assert.ok(!url.href.includes('private'));
  assert.ok(!new URL(shareUrl(records, 'http://localhost:4173/')).searchParams.has('url'));
  const completedRecords = Object.fromEntries([...validIds].map(id => [id, record(1)]));
  const completedText = new URL(shareUrl(completedRecords, 'https://example.com/keidochi/')).searchParams.get('text');
  assert.match(completedText, /北海道を踏破しました！$/);
  assert.doesNotMatch(completedText, /あと0のまち/);
});
