import { municipalities } from './municipalities.js';

// v1: 179 municipalities in municipal-code order, three bits per experience level.
// Notes and timestamps are never included. A new municipality set needs a new version.
const ids = Object.freeze(municipalities.map(city => city.id).sort());
const byteLength = Math.ceil(ids.length * 3 / 8);
const toBase64Url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function encodeSharedRecords(records) {
  if (ids.length !== 179) throw new Error('共有リンクの形式を更新する必要があります。');
  const bytes = new Uint8Array(byteLength);
  ids.forEach((id, index) => {
    const level = records[id]?.level ?? 0;
    if (!Number.isInteger(level) || level < 0 || level > 5) throw new Error('経験レベルが不正です。');
    for (let bit = 0; bit < 3; bit++) {
      const position = index * 3 + bit;
      bytes[Math.floor(position / 8)] |= ((level >> (2 - bit)) & 1) << (7 - position % 8);
    }
  });
  return `v1.${toBase64Url(bytes)}`;
}

export function decodeSharedRecords(value) {
  const length = Math.ceil(byteLength * 8 / 6);
  if (ids.length !== 179 || typeof value !== 'string' || !new RegExp(`^v1\\.[A-Za-z0-9_-]{${length}}$`).test(value)) {
    throw new Error('共有リンクの形式が不正です。');
  }
  const encoded = value.slice(3);
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const unusedBits = byteLength * 8 - ids.length * 3;
  if (bytes.length !== byteLength || toBase64Url(bytes) !== encoded || (bytes.at(-1) & ((1 << unusedBits) - 1)) !== 0) {
    throw new Error('共有リンクのデータが不正です。');
  }
  const records = Object.create(null);
  ids.forEach((id, index) => {
    let level = 0;
    for (let bit = 0; bit < 3; bit++) {
      const position = index * 3 + bit;
      level = (level << 1) | ((bytes[Math.floor(position / 8)] >> (7 - position % 8)) & 1);
    }
    if (level > 5) throw new Error('共有リンクの経験レベルが不正です。');
    if (level > 0) records[id] = Object.freeze({ level, note: '' });
  });
  return Object.freeze(records);
}

export function createRecordLink(records, pageUrl) {
  const page = new URL(pageUrl);
  if (!['http:', 'https:'].includes(page.protocol)) throw new Error('HTTPまたはHTTPSのページから共有してください。');
  page.search = '';
  page.hash = new URLSearchParams({ share: encodeSharedRecords(records) }).toString();
  return page.href;
}

// Invalid links remain in read-only mode, so they cannot affect the viewer's records.
export function readSharedLink(pageUrl) {
  const params = new URLSearchParams(new URL(pageUrl).hash.slice(1));
  if (!params.has('share')) return null;
  try {
    if (params.getAll('share').length !== 1) throw new Error('共有リンクの指定が重複しています。');
    return { records: decodeSharedRecords(params.get('share')), error: null };
  } catch (error) {
    return { records: Object.freeze(Object.create(null)), error };
  }
}
