import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { STORAGE_KEY } from '../src/model.js';
import { createRecordLink, readSharedLink } from '../src/shared-records.js';

const base = 'https://example.com/keidochi/';
const record = (level, note = '') => ({ level, note, updatedAt: '2026-11-26T01:00:00.000Z' });
const own = { '01100': record(5, 'PRIVATE: 自分の札幌のメモ'), '01203': record(4, '小樽の思い出') };
const shared = { '01100': record(3, '共有しないメモ'), '01202': record(4) };
const link = createRecordLink(shared, base);
let instance = 0;

async function boot(url, ownRecords = own, raw) {
  const dom = new JSDOM(await readFile(new URL('../index.html', import.meta.url), 'utf8'), { url });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document });
  window.matchMedia = () => ({ matches: false });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  const originalSet = window.Storage.prototype.setItem;
  if (raw !== undefined) window.localStorage.setItem(STORAGE_KEY, raw);
  else if (ownRecords !== null) window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, records: ownRecords }));
  window.localStorage.setItem('another-app', 'DO NOT TOUCH');
  const original = window.localStorage.getItem(STORAGE_KEY);
  const writes = [];
  for (const method of ['setItem', 'removeItem', 'clear']) {
    const implementation = window.Storage.prototype[method];
    window.Storage.prototype[method] = function (...args) { writes.push([method, ...args]); return implementation.apply(this, args); };
  }
  const moduleUrl = new URL('../src/app.js', import.meta.url);
  moduleUrl.searchParams.set('sharedViewTest', ++instance);
  await import(moduleUrl.href);
  const $ = selector => window.document.querySelector(selector);
  const event = (selector, type) => $(selector).dispatchEvent(new window.Event(type, { bubbles: true }));
  const navigate = url => {
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  };
  const unchanged = () => {
    assert.equal(window.localStorage.getItem(STORAGE_KEY), original);
    assert.equal(window.localStorage.getItem('another-app'), 'DO NOT TOUCH');
    assert.equal(writes.length, 0, JSON.stringify(writes));
  };
  return { dom, window, $, event, navigate, unchanged, writes, originalSet };
}

test('shared view displays the linked levels and never writes storage through controls or lifecycle events', async () => {
  const f = await boot(link);
  const { $, window, event } = f;
  try {
    assert.equal($('#shared-view').hidden, false);
    assert.equal($('#total-score').textContent, '7');
    assert.equal($('#score-label').textContent, '共有された経道値');
    assert.equal($('input[value="3"]').checked, true);
    assert.ok([...document.querySelectorAll('input[name="experience"]')].every(input => input.disabled));
    assert.equal($('#travel-note').disabled, true);
    assert.equal($('#travel-note').value, '');
    assert.ok(!document.body.textContent.includes('PRIVATE'));
    $('.city-shape[data-city-id="01202"]').dispatchEvent(new window.Event('click'));
    assert.equal($('#record-title').textContent, '函館市');
    assert.equal($('input[value="4"]').checked, true);
    $('#travel-note').value = '変更しても保存されない'; event('#travel-note', 'input');
    assert.equal($('#travel-note').value, '');
    $('input[value="5"]').checked = true; event('input[value="5"]', 'change');
    assert.equal($('input[value="4"]').checked, true);
    event('#travel-note', 'blur');
    window.dispatchEvent(new window.Event('pagehide'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new window.Event('visibilitychange'));
    $('#local-status').click(); assert.equal($('#data-dialog').open, false);
    $('#reset-confirm-button').click();
    Object.defineProperty($('#import-data'), 'files', { configurable: true, value: [{ size: 2, text: async () => '{}' }] });
    event('#import-data', 'change'); $('#confirm-import').click(); $('#export-data').click();
    const originalUrl = window.location.href;
    $('nav a[href="#workspace"]').click(); $('.skip-link').click();
    assert.equal(window.location.href, originalUrl);
    f.unchanged();
  } finally { f.dom.window.close(); }
});

test('returning to own records restores original notes and only later user edits persist', async () => {
  const f = await boot(link);
  const { $, window, event } = f;
  try {
    $('#shared-exit').click();
    assert.equal($('#shared-view').hidden, true);
    assert.equal(window.location.hash, '');
    assert.equal($('#total-score').textContent, '9');
    assert.equal($('#travel-note').value, own['01100'].note);
    assert.equal($('#travel-note').disabled, false);
    f.unchanged();
    $('input[value="1"]').checked = true; event('input[value="1"]', 'change');
    assert.equal(f.writes.length, 1);
    const records = JSON.parse(window.localStorage.getItem(STORAGE_KEY)).records;
    assert.equal(records['01100'].level, 1);
    assert.equal(records['01100'].note, own['01100'].note);
    assert.deepEqual(records['01203'], own['01203']);
    assert.equal(records['01202'], undefined);
  } finally { f.dom.window.close(); }
});

test('same-page shared-link navigation cancels autosave and preserves an unsaved own note', async () => {
  const f = await boot(base);
  const { $, window, event } = f;
  try {
    $('#travel-note').value = '自分の未保存のメモ'; event('#travel-note', 'input');
    // A lifecycle event can run before the hashchange handler; the URL guard must still block writes.
    window.history.replaceState(null, '', link);
    window.dispatchEvent(new window.Event('pagehide'));
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal($('#travel-note').value, '');
    f.unchanged();
    $('#shared-exit').click();
    assert.equal($('#travel-note').value, '自分の未保存のメモ');
    f.unchanged();
    event('#travel-note', 'blur');
    assert.equal(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).records['01100'].note, '自分の未保存のメモ');
  } finally { f.dom.window.close(); }
});

test('other-tab updates do not replace the shared view and are loaded when returning to own records', async () => {
  const f = await boot(link);
  const { $, window } = f;
  try {
    const updatedOwn = { '01100': record(2, '別タブで更新した自分のメモ') };
    f.originalSet.call(window.localStorage, STORAGE_KEY, JSON.stringify({ version: 1, records: updatedOwn }));
    window.dispatchEvent(new window.StorageEvent('storage', { key: STORAGE_KEY }));
    assert.equal($('#total-score').textContent, '7');
    assert.equal($('#travel-note').value, '');
    $('#shared-exit').click();
    assert.equal($('#total-score').textContent, '2');
    assert.equal($('#travel-note').value, updatedOwn['01100'].note);
    assert.equal(f.writes.length, 0);
  } finally { f.dom.window.close(); }
});

test('switching between shared links and back does not create or overwrite records', async () => {
  const f = await boot(link, null);
  try {
    const next = createRecordLink({ '01202': record(5) }, base);
    f.navigate(next);
    assert.equal(f.$('#total-score').textContent, '5');
    f.navigate(link);
    assert.equal(f.$('#total-score').textContent, '7');
    f.$('#shared-exit').click();
    assert.equal(f.$('#total-score').textContent, '0');
    f.unchanged();
  } finally { f.dom.window.close(); }
});

test('malformed links cannot write, edit, or overwrite private records', async () => {
  const f = await boot(base + '#share=v99.invalid');
  try {
    assert.match(f.$('#shared-view-title').textContent, /読み込めません/);
    assert.equal(f.$('#travel-note').disabled, true);
    assert.equal(f.$('#share-top').disabled, true);
    f.$('#reset-confirm-button').click();
    f.unchanged();
    f.$('#shared-exit').click();
    assert.equal(f.$('#travel-note').value, own['01100'].note);
    assert.equal(f.$('#share-top').disabled, false);
    f.unchanged();
  } finally { f.dom.window.close(); }
});

test('shared links remain viewable even when own storage is corrupt, without replacing it', async () => {
  const f = await boot(link, null, '{corrupt-own-records');
  try {
    assert.equal(f.$('#total-score').textContent, '7');
    assert.equal(f.$('#storage-warning').hidden, true);
    f.unchanged();
    f.$('#shared-exit').click();
    assert.equal(f.$('#storage-warning').hidden, false);
    assert.equal(f.$('#travel-note').disabled, true);
    f.unchanged();
  } finally { f.dom.window.close(); }
});

test('copyable links contain displayed records, with a manual-copy fallback', async () => {
  const f = await boot(base);
  try {
    let copied = null;
    Object.defineProperty(f.window.navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text; } } });
    f.$('#share-top').click();
    f.$('#share-copy-link').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(readSharedLink(copied).records['01100'].level, 5);
    assert.equal(readSharedLink(copied).records['01100'].note, '');
    assert.ok(!copied.includes('PRIVATE'));
    f.unchanged();
    Object.defineProperty(f.window.navigator, 'clipboard', { configurable: true, value: undefined });
    f.$('#share-copy-link').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.$('#share-link-field').hidden, false);
    assert.equal(f.$('#share-link-url').value, copied);
    assert.equal(f.window.document.activeElement, f.$('#share-link-url'));
    f.unchanged();
  } finally { f.dom.window.close(); }
});
