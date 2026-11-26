import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { LEVELS, STORAGE_KEY, loadRecords } from '../src/model.js';
import { municipalities } from '../src/municipalities.js';

const record = (level, note = '') => ({ level, note, updatedAt: '2026-11-26T01:00:00.000Z' });
const own = { '01100': record(5, '札幌のメモ'), '01202': record(3, '函館のメモ') };
const cssColor = hex => `rgb(${hex.slice(1).match(/../g).map(value => parseInt(value, 16)).join(', ')})`;
let instance = 0;

async function boot(records = own) {
  const dom = new JSDOM(await readFile(new URL('../index.html', import.meta.url), 'utf8'), { url: 'https://example.com/keidochi/' });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document });
  window.matchMedia = () => ({ matches: true });
  const scrolls = [];
  window.HTMLElement.prototype.scrollIntoView = function () { scrolls.push(this.id); };
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, records }));
  const originalSet = window.Storage.prototype.setItem;
  let writes = 0;
  window.Storage.prototype.setItem = function (...args) { writes++; return originalSet.apply(this, args); };
  const module = new URL('../src/app.js', import.meta.url);
  module.searchParams.set('quickTest', ++instance);
  await import(module.href);
  const $ = selector => document.querySelector(selector);
  const fire = (selector, name) => $(selector).dispatchEvent(new window.Event(name, { bubbles: true }));
  const paint = id => fire(`.city-shape[data-city-id="${id}"]`, 'click');
  const choose = level => { const selector = `input[name="quick-experience"][value="quick-${level}"]`; $(selector).checked = true; fire(selector, 'change'); };
  const stored = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY)).records;
  return { dom, window, $, fire, paint, choose, stored, scrolls, writes: () => writes };
}

test('quick mode paints successive cities without scrolling, preserves notes and persists each click', async () => {
  const f = await boot();
  const { $, paint, choose, stored } = f;
  try {
    $('#quick-toggle').click();
    choose(1);
    assert.equal(f.writes(), 0, 'choosing a brush must not change the selected city');
    for (const id of ['01100', '01202', '01203']) {
      paint(id);
      assert.equal(stored()[id].level, 1);
      assert.equal($(`.city-shape[data-city-id="${id}"]`).style.fill, cssColor(LEVELS[1].color));
    }
    assert.equal(stored()['01100'].note, '札幌のメモ');
    assert.equal(stored()['01202'].note, '函館のメモ');
    assert.equal($('#total-score').textContent, '3');
    assert.equal($('#touched-count').textContent, '3');
    assert.equal(f.writes(), 3);
    assert.deepEqual(f.scrolls, [], 'mobile quick input must keep the map in view');
    const reload = loadRecords(f.window.localStorage, new Set(municipalities.map(city => city.id)));
    assert.equal(reload.error, null);
    assert.deepEqual({ ...reload.records }, stored());
    paint('01203');
    assert.equal(f.writes(), 3, 'repeated clicks must not toggle or rewrite a record');
  } finally { f.dom.window.close(); }
});

test('each brush level is independent of the city editor and undo restores exact records', async () => {
  const f = await boot();
  const { $, choose, paint, stored } = f;
  try {
    $('#quick-toggle').click();
    choose(4); paint('01100');
    choose(2); paint('01202');
    choose(0); paint('01203');
    assert.equal(stored()['01203'], undefined);
    choose(5); paint('01203');
    assert.equal(stored()['01203'].level, 5);
    $('#quick-undo').click();
    assert.equal(stored()['01203'], undefined);
    $('#quick-undo').click();
    assert.deepEqual(stored()['01202'], own['01202']);
    $('#quick-undo').click();
    assert.deepEqual(stored(), own);
    assert.equal($('#quick-undo').disabled, true);
    choose(0); paint('01100');
    assert.equal(stored()['01100'].level, 0);
    assert.equal(stored()['01100'].note, own['01100'].note);
    $('#quick-undo').click();
    assert.deepEqual(stored(), own);
    choose(3); paint('01203');
    assert.equal(stored()['01203'].level, 3);
  } finally { f.dom.window.close(); }
});

test('leaving quick mode restores normal map selection and list clicks never paint', async () => {
  const f = await boot();
  const { $, paint, stored } = f;
  try {
    $('#quick-toggle').click();
    $('#city-search').value = '函館'; f.fire('#city-search', 'input');
    $('.city-list-item[data-city-id="01202"]').click();
    assert.deepEqual(stored(), own);
    assert.equal($('#record-title').textContent, '函館市');
    $('#quick-toggle').click();
    paint('01203');
    assert.deepEqual(stored(), own);
    assert.equal($('#record-title').textContent, '小樽市');
    assert.equal($('#quick-controls').hidden, true);
    assert.match($('.map-hint').textContent, /まちを選んで記録/);
  } finally { f.dom.window.close(); }
});

test('quick input flushes pending notes and discards undo history after ordinary edits or another tab update', async () => {
  const f = await boot();
  const { $, paint, fire, stored, window } = f;
  try {
    $('#travel-note').value = '保存前のメモ'; fire('#travel-note', 'input');
    $('#quick-toggle').click();
    assert.equal(stored()['01100'].note, '保存前のメモ');
    paint('01202');
    assert.equal($('#quick-undo').disabled, false);
    $('#travel-note').value = '高速入力後のメモ'; fire('#travel-note', 'input'); fire('#travel-note', 'blur');
    assert.equal($('#quick-undo').disabled, true);
    assert.equal(stored()['01202'].note, '高速入力後のメモ');
    paint('01203');
    assert.equal($('#quick-undo').disabled, false);
    const incoming = stored(); incoming['01203'] = record(5, '別タブ');
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, records: incoming }));
    window.dispatchEvent(new window.StorageEvent('storage', { key: STORAGE_KEY }));
    assert.equal($('#quick-undo').disabled, true);
    $('#quick-undo').click();
    assert.deepEqual(stored()['01203'], incoming['01203']);
  } finally { f.dom.window.close(); }
});

test('failed quick writes or undo keep stored records, selection and retryable history intact', async () => {
  const f = await boot();
  const { $, paint, stored, window } = f;
  try {
    $('#quick-toggle').click();
    paint('01202');
    const saved = stored();
    const workingSet = window.Storage.prototype.setItem;
    window.Storage.prototype.setItem = () => { throw new Error('quota'); };
    paint('01203');
    assert.deepEqual(stored(), saved);
    assert.equal($('#record-title').textContent, '函館市');
    assert.equal($('.city-shape[data-city-id="01203"]').style.fill, cssColor(LEVELS[0].color));
    $('#quick-undo').click();
    assert.deepEqual(stored(), saved);
    assert.equal($('#quick-undo').disabled, false);
    window.Storage.prototype.setItem = workingSet;
    $('#quick-undo').click();
    assert.deepEqual(stored(), own);
    assert.equal($('#quick-undo').disabled, true);
    $('#quick-toggle').click();
    $('#travel-note').value = '失敗しても残る下書き';
    f.fire('#travel-note', 'input');
    window.Storage.prototype.setItem = () => { throw new Error('quota'); };
    $('#quick-toggle').click();
    assert.equal($('#quick-toggle').getAttribute('aria-checked'), 'false');
    assert.equal($('#travel-note').value, '失敗しても残る下書き');
    assert.deepEqual(stored(), own);
  } finally { f.dom.window.close(); }
});

test('keyboard map selection paints but dragging a zoomed map does not paint', async () => {
  const f = await boot();
  const { $, window, stored } = f;
  try {
    $('#quick-toggle').click();
    $('.city-shape[data-city-id="01203"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(stored()['01203'].level, 1);
    const before = stored();
    $('#zoom-in').click();
    assert.match($('.map-hint').textContent, /通過/);
    const map = $('#hokkaido-map');
    map.getBoundingClientRect = () => ({ width: 800, height: 600 });
    map.hasPointerCapture = () => false;
    map.setPointerCapture = () => {};
    map.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: 100, clientY: 100, button: 0 }));
    map.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 120, clientY: 100 }));
    map.dispatchEvent(new window.MouseEvent('pointerup', { clientX: 120, clientY: 100 }));
    f.paint('01202');
    assert.deepEqual(stored(), before);
  } finally { f.dom.window.close(); }
});

test('corrupt storage disables quick input until explicit recovery', async () => {
  const f = await boot();
  try {
    f.window.localStorage.setItem(STORAGE_KEY, '{broken');
    f.window.dispatchEvent(new f.window.StorageEvent('storage', { key: STORAGE_KEY }));
    assert.equal(f.$('#quick-toggle').disabled, true);
    f.$('#quick-toggle').click();
    assert.equal(f.$('#quick-toggle').getAttribute('aria-checked'), 'false');
    f.paint('01203');
    assert.equal(f.window.localStorage.getItem(STORAGE_KEY), '{broken');
    f.$('.data-open').click(); f.$('#reset-open').click(); f.$('#reset-confirm-button').click();
    assert.equal(f.$('#quick-toggle').disabled, false);
    f.$('#quick-toggle').click(); f.paint('01203');
    assert.equal(f.stored()['01203'].level, 1);
  } finally { f.dom.window.close(); }
});
