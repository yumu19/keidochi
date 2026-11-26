import test from 'node:test';
import assert from 'node:assert/strict';
import { municipalities } from '../src/municipalities.js';
import { encodeSharedRecords, decodeSharedRecords, createRecordLink, readSharedLink } from '../src/shared-records.js';

test('link encoding round-trips all 179 municipality levels and omits notes and dates', () => {
  const records = Object.fromEntries(municipalities.map((city, index) => [city.id, {
    level: index % 6, note: '共有しないメモ PRIVATE', updatedAt: '2026-11-26T01:02:03.000Z',
  }]));
  const encoded = encodeSharedRecords(records);
  assert.ok(encoded.length < 100);
  assert.equal(encodeSharedRecords(Object.fromEntries(Object.entries(records).reverse())), encoded);
  const decoded = decodeSharedRecords(encoded);
  for (const city of municipalities) {
    assert.equal(decoded[city.id]?.level ?? 0, records[city.id].level, city.name);
    if (decoded[city.id]) assert.deepEqual(Object.keys(decoded[city.id]).sort(), ['level', 'note']);
    assert.ok(!decoded[city.id]?.note);
  }
  assert.ok(Object.isFrozen(decoded));
  const link = createRecordLink(records, 'https://example.com/keidochi/?private=test#workspace');
  assert.ok(link.length < 150);
  const url = new URL(link);
  assert.equal(url.origin + url.pathname, 'https://example.com/keidochi/');
  assert.equal(url.search, '');
  assert.ok(!link.includes('PRIVATE') && !link.includes('2026-11-26') && !link.includes('private'));
  assert.deepEqual(readSharedLink(link).records, decoded);
});

test('empty and complete maps retain exact municipality values', () => {
  assert.equal(Object.keys(decodeSharedRecords(encodeSharedRecords({}))).length, 0);
  for (const level of [1, 5]) {
    const records = Object.fromEntries(municipalities.map(city => [city.id, { level }]));
    const decoded = decodeSharedRecords(encodeSharedRecords(records));
    assert.equal(Object.keys(decoded).length, 179);
    assert.ok(Object.values(decoded).every(record => record.level === level));
  }
});

test('unsupported versions, invalid bits, truncated data and duplicate parameters fail closed', () => {
  const valid = encodeSharedRecords({});
  const fromBytes = bytes => 'v1.' + Buffer.from(bytes).toString('base64url');
  const invalidLevel = new Uint8Array(68); invalidLevel[0] = 0xe0;
  const invalidPadding = new Uint8Array(68); invalidPadding[67] = 1;
  for (const value of ['', 'v2.' + valid.slice(3), valid.slice(0, -1), valid + 'A', 'v1.' + '!'.repeat(91), fromBytes(invalidLevel), fromBytes(invalidPadding)]) {
    assert.throws(() => decodeSharedRecords(value));
    const result = readSharedLink(`https://example.com/#share=${encodeURIComponent(value)}`);
    assert.ok(result.error);
    assert.equal(Object.keys(result.records).length, 0);
  }
  assert.ok(readSharedLink(`https://example.com/#share=${valid}&share=${valid}`).error);
  assert.equal(readSharedLink('https://example.com/#workspace'), null);
  assert.equal(readSharedLink('https://example.com/'), null);
  assert.throws(() => encodeSharedRecords({ '01100': { level: 6 } }));
  assert.throws(() => createRecordLink({}, 'javascript:void(0)'));
});
