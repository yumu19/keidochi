import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { STORAGE_KEY } from '../src/model.js';
import { createRecordLink, encodeSharedRecords, viewPageUrl } from '../src/shared-records.js';

const base = 'https://example.com/keidochi/';
const record = (level, note = '') => ({ level, note, updatedAt: '2026-11-26T01:00:00.000Z' });
const own = { '01100': record(5, 'PRIVATE: 自分の札幌のメモ'), '01203': record(4, '小樽の思い出') };
const shared = { '01100': record(3, '共有しないメモ'), '01202': record(4) };
const link = createRecordLink(shared, base);
let instance = 0;

async function boot(url = link, raw = JSON.stringify({ version: 1, records: own })) {
  const dom = new JSDOM(await readFile(new URL('../view.html', import.meta.url), 'utf8'), { url });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document });
  window.matchMedia = () => ({ matches: false });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  const storage = window.localStorage;
  storage.setItem(STORAGE_KEY, raw);
  storage.setItem('another-app', 'DO NOT TOUCH');
  let storageAccesses = 0;
  Object.defineProperty(window, 'localStorage', { get() { storageAccesses++; throw new Error('Viewer must never access storage'); } });
  const moduleUrl = new URL('../src/view.js', import.meta.url);
  moduleUrl.searchParams.set('viewTest', ++instance);
  await import(moduleUrl.href);
  const $ = selector => window.document.querySelector(selector);
  const event = (selector, type) => $(selector).dispatchEvent(new window.Event(type, { bubbles: true }));
  const navigate = url => {
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  };
  const unchanged = () => {
    assert.equal(storageAccesses, 0, 'viewer must not read or write localStorage');
    assert.equal(storage.getItem(STORAGE_KEY), raw);
    assert.equal(storage.getItem('another-app'), 'DO NOT TOUCH');
  };
  return { dom, window, $, event, navigate, unchanged };
}

// Exercise the real viewer controller while making even storage reads throw.
test('viewer has only read-only details and never accesses storage through controls or lifecycle events', async () => {
  const f = await boot();
  const { $, window, event } = f;
  try {
    assert.equal(document.querySelectorAll('.city-shape').length, 179);
    assert.equal($('#total-score').textContent, '7');
    assert.equal($('#viewer-experience').textContent, '訪問');
    assert.equal($('#viewer-points').textContent, '3');
    for (const selector of ['input[name="experience"]', 'textarea', '#experience-options', '#data-dialog', '.data-open', '#local-status', '#save-status', '#import-data', '#reset-confirm-button', '#share-top', '#share-bottom', '#share-dialog', '.share-button']) {
      assert.equal($(selector), null, selector + ' must not exist in the viewer');
    }
    assert.ok(!document.body.textContent.includes('PRIVATE'));
    assert.equal($('#edit-link').href, base);
    assert.equal($('#edit-link').textContent.includes('自分の記録を入力'), true);
    assert.equal($('.viewer-mode').textContent, '閲覧専用');
    event('.city-shape[data-city-id="01202"]', 'click');
    assert.equal($('#record-title').textContent, '函館市');
    assert.equal($('#viewer-experience').textContent, '宿泊');
    assert.equal($('#viewer-points').textContent, '4');
    $('.city-shape[data-city-id="01100"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal($('#record-title').textContent, '札幌市');
    const fullMap = $('#hokkaido-map').getAttribute('viewBox');
    $('#zoom-in').click(); assert.notEqual($('#hokkaido-map').getAttribute('viewBox'), fullMap);
    $('#zoom-reset').click(); assert.equal($('#hokkaido-map').getAttribute('viewBox'), fullMap);
    $('#help-open').click(); assert.equal($('#help-dialog').open, true);
    $('#help-dialog .close-dialog').click();
    $('#about-open').click(); assert.equal($('#about-dialog').open, true);
    $('#about-dialog .close-dialog').click();
    window.dispatchEvent(new window.Event('pagehide'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new window.Event('visibilitychange'));
    window.dispatchEvent(new window.StorageEvent('storage', { key: STORAGE_KEY, newValue: '{}' }));
    assert.equal($('#total-score').textContent, '7');
    f.unchanged();
  } finally { f.dom.window.close(); }
});

test('viewer search, filters and in-page navigation preserve the linked record', async () => {
  const f = await boot();
  const { $, event, window } = f;
  try {
    const originalUrl = window.location.href;
    $('nav a[href="#workspace"]').click(); $('.skip-link').click();
    assert.equal(window.location.href, originalUrl);
    $('#city-search').value = '函館'; event('#city-search', 'input');
    assert.equal($('#result-count').textContent, '1');
    $('.city-list-item').click();
    assert.equal($('#record-title').textContent, '函館市');
    assert.equal($('#viewer-experience').textContent, '宿泊');
    $('#city-search').value = ''; event('#city-search', 'input');
    $('#level-filter').value = '4'; event('#level-filter', 'change');
    assert.equal($('#result-count').textContent, '1');
    assert.equal($('.city-list-item').dataset.cityId, '01202');
    $('#clear-filters').click(); $('#show-all').click();
    assert.equal(document.querySelectorAll('.city-list-item').length, 179);
    assert.equal(window.location.href, originalUrl);
    f.unchanged();
  } finally { f.dom.window.close(); }
});

test('viewer changes records with the URL and never falls back to personal records', async () => {
  const f = await boot();
  const { $, navigate } = f;
  try {
    navigate(createRecordLink({ '01203': record(2) }, base));
    assert.equal($('#total-score').textContent, '2');
    assert.equal($('#viewer-experience').textContent, '未踏');
    navigate(createRecordLink({}, base));
    assert.equal($('#total-score').textContent, '0');
    assert.equal($('#workspace').hidden, false);
    navigate(new URL('view.html#share=invalid', base));
    assert.equal($('#workspace').hidden, true);
    assert.equal($('.overview').hidden, true);
    assert.equal($('#edit-link').href, base);
    assert.equal($('#shared-view').classList.contains('invalid'), true);
    navigate(new URL('view.html', base));
    assert.equal($('#workspace').hidden, true);
    assert.equal($('#total-score').textContent, '0');
    assert.equal($('#edit-link').href, base);
    navigate(link);
    assert.equal($('#workspace').hidden, false);
    assert.equal($('#total-score').textContent, '7');
    f.unchanged();
  } finally { f.dom.window.close(); }
});

test('corrupt or unavailable personal storage cannot affect viewer results', async () => {
  const f = await boot(link, '{broken-personal-data');
  try {
    assert.equal(f.$('#total-score').textContent, '7');
    assert.equal(f.$('#shared-view').classList.contains('invalid'), false);
    f.unchanged();
  } finally { f.dom.window.close(); }
});

test('legacy shared URLs redirect before the editor loads or accesses storage', async () => {
  for (const hash of [`#share=${encodeSharedRecords(shared)}`, '#share=bad', '#share=']) {
    let redirected;
    let storageAccesses = 0;
    const fakeWindow = { location: { href: base + hash, replace: value => { redirected = value; } } };
    Object.defineProperty(fakeWindow, 'localStorage', { get() { storageAccesses++; throw new Error('must not access'); } });
    const classes = new Set();
    globalThis.window = fakeWindow;
    globalThis.document = { documentElement: { classList: { add: value => classes.add(value) } } };
    const moduleUrl = new URL('../src/main.js', import.meta.url);
    moduleUrl.searchParams.set('legacyTest', ++instance);
    await import(moduleUrl.href);
    assert.equal(redirected, base + 'view.html' + hash);
    assert.equal(storageAccesses, 0);
    assert.ok(classes.has('redirecting-to-viewer'));
    assert.equal(viewPageUrl(redirected), redirected);
  }
});
