export const STORAGE_KEY = 'keidochi.records.v1';
export const LEVELS = [
  { label: '未踏', description: 'まだ行ったことがない', color: '#adc4d1' },
  { label: '通過', description: '車や電車で通った', color: '#5da7e5' },
  { label: '接地', description: '乗り換え・休憩で降りた', color: '#f2cf4a' },
  { label: '訪問', description: 'まちを歩いた・観光した', color: '#40ae7b' },
  { label: '宿泊', description: 'そのまちに泊まった', color: '#ed8843' },
  { label: '居住', description: '住んだことがある', color: '#a875cf' },
];

export function validatePayload(payload, validIds) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.version !== 1 ||
    !payload.records || typeof payload.records !== 'object' || Array.isArray(payload.records)) {
    throw new Error('経道値のバックアップ形式ではありません。');
  }
  const result = Object.create(null);
  for (const [id, record] of Object.entries(payload.records)) {
    if (!validIds.has(id) || !record || typeof record !== 'object' || Array.isArray(record) ||
      !Number.isInteger(record.level) || record.level < 0 || record.level > 5 ||
      typeof record.note !== 'string' || record.note.length > 200 ||
      typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))) {
      throw new Error('記録の内容が不正です。市町村・経験レベル・メモを確認してください。');
    }
    result[id] = { level: record.level, note: record.note, updatedAt: record.updatedAt };
  }
  return result;
}

export function loadRecords(storage, validIds) {
  try {
    if (!storage) throw new Error('ブラウザーの保存機能を利用できません。');
    const raw = storage.getItem(STORAGE_KEY);
    return { records: raw === null ? Object.create(null) : validatePayload(JSON.parse(raw), validIds), error: null };
  } catch (error) {
    return { records: Object.create(null), error };
  }
}

export function saveRecords(storage, records) {
  if (!storage) throw new Error('ブラウザーの保存機能を利用できません。');
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, records }));
}

export function summarize(records, total = 179) {
  const counts = Array(6).fill(0);
  let score = 0;
  for (const record of Object.values(records)) {
    counts[record.level]++;
    score += record.level;
  }
  counts[0] += total - Object.keys(records).length;
  const touched = total - counts[0];
  const visited = counts[3] + counts[4] + counts[5];
  const stayed = counts[4] + counts[5];
  return { score, counts, touched, visited, stayed, percent: total ? Math.round(touched / total * 100) : 0 };
}

export function normalizeSearch(value) {
  return value.normalize('NFKC').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).trim().toLowerCase();
}

export function filterMunicipalities(municipalities, records, { query = '', region = '', level = '' } = {}) {
  const term = normalizeSearch(query);
  return municipalities.filter(city => (!term || normalizeSearch(`${city.name} ${city.reading} ${city.region}`).includes(term)) &&
    (!region || city.region === region) && (level === '' || (records[city.id]?.level ?? 0) === Number(level)));
}

export function shareUrl(records, pageUrl) {
  const { score, touched } = summarize(records);
  const url = new URL('https://twitter.com/intent/tweet');
  url.searchParams.set('text', `私の経道値は ${score} / 895 pt！\n北海道 ${touched} / 179 市町村に足あとを残しました。\nあと${179 - touched}のまちが、あなたを待っています。`);
  url.searchParams.set('hashtags', '経道値');
  const page = new URL(pageUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(page.hostname) && /^https?:$/.test(page.protocol)) {
    page.search = ''; page.hash = '';
    url.searchParams.set('url', page.href);
  }
  return url.href;
}
