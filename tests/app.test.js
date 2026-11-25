import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { STORAGE_KEY } from '../src/model.js';

test('application interactions and persistent records', async t => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'https://example.com/keidochi/' });
  const { window } = dom;
  Object.assign(globalThis, { window, document: window.document });
  window.matchMedia = () => ({ matches: false });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  let clickedAnchor = null;
  window.HTMLAnchorElement.prototype.click = function () { clickedAnchor = this; };
  let imageFailure = false;
  let objectUrlCount = 0;
  window.URL.createObjectURL = () => `blob:keidochi-test-${++objectUrlCount}`;
  window.URL.revokeObjectURL = () => {};
  window.Image = class {
    set src(value) { queueMicrotask(() => imageFailure ? this.onerror() : this.onload()); }
  };
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  window.HTMLCanvasElement.prototype.toBlob = function (callback, type) { callback(new window.Blob(['test-png'], { type })); };
  const waitForImage = () => new Promise(resolve => setImmediate(resolve));
  const $ = selector => window.document.querySelector(selector);
  const fire = (selector, type) => $(selector).dispatchEvent(new window.Event(type, { bubbles: true }));
  const selectLevel = level => { $(`input[name="experience"][value="${level}"]`).checked = true; fire(`input[name="experience"][value="${level}"]`, 'change'); };
  const setSearch = value => { $('#city-search').value = value; fire('#city-search', 'input'); };
  const stored = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY));
  const importFile = async content => {
    Object.defineProperty($('#import-data'), 'files', { configurable: true, value: [{ size: content.length, text: async () => content }] });
    fire('#import-data', 'change');
    await new Promise(resolve => setImmediate(resolve));
  };
  await import('../src/app.js');

  await t.test('starts empty with all 179 map boundaries and an editable Sapporo', () => {
    assert.equal(window.document.querySelectorAll('.city-shape').length, 179);
    assert.equal($('#record-title').textContent, '札幌市');
    assert.equal($('#city-region').textContent, '石狩振興局');
    assert.equal($('#total-score').textContent, '0');
    assert.equal($('#touched-count').textContent, '0');
    assert.equal($('#result-count').textContent, '179');
    assert.equal($('#storage-warning').hidden, true);
    assert.equal($('input[value="0"]').checked, true);
    assert.equal(window.document.querySelectorAll('.city-list-item').length, 12);
  });

  await t.test('experience selection updates storage, map, legend and statistics', () => {
    selectLevel(4);
    assert.equal(stored().records['01100'].level, 4);
    assert.equal($('#total-score').textContent, '4');
    assert.equal($('#touched-count').textContent, '1');
    assert.equal($('#visited-count').textContent, '1');
    assert.equal($('#stayed-count').textContent, '1');
    assert.match($('.city-shape[data-city-id="01100"]').getAttribute('aria-label'), /宿泊/);
    assert.equal($('.legend-item[data-level="4"] small').textContent, '1');
    assert.match($('#city-badge').textContent, /宿泊/);
  });

  await t.test('note is saved before moving to another municipality; notes remain plain text', () => {
    $('#travel-note').value = '<script>alert(1)</script> スープカレー！';
    fire('#travel-note', 'input');
    fire('.city-shape[data-city-id="01202"]', 'click');
    assert.equal(stored().records['01100'].note, '<script>alert(1)</script> スープカレー！');
    assert.equal($('#record-title').textContent, '函館市');
    assert.equal($('#travel-note').value, '');
    selectLevel(3);
    assert.equal($('#total-score').textContent, '7');
    $('.city-shape[data-city-id="01100"]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal($('#travel-note').value, '<script>alert(1)</script> スープカレー！');
    assert.equal($('input[value="4"]').checked, true);
    assert.equal(window.document.querySelectorAll('script').length, 1);
  });

  await t.test('list search, empty state, region and level filters work together', () => {
    setSearch('ハコダテ');
    assert.equal($('#result-count').textContent, '1');
    assert.equal($('.list-city-name').firstChild.textContent, '函館市');
    $('.city-list-item').click();
    assert.equal($('#record-title').textContent, '函館市');
    setSearch('存在しない');
    assert.equal($('#empty-state').hidden, false);
    $('#clear-filters').click();
    assert.equal($('#empty-state').hidden, true);
    $('#region-filter').value = '石狩'; fire('#region-filter', 'change');
    $('#level-filter').value = '4'; fire('#level-filter', 'change');
    assert.equal($('#result-count').textContent, '1');
    assert.equal($('.list-city-name').firstChild.textContent, '札幌市');
    $('#clear-filters').click();
    $('#show-all').click();
    assert.equal(window.document.querySelectorAll('.city-list-item').length, 179);
    $('#show-all').click();
    assert.equal(window.document.querySelectorAll('.city-list-item').length, 12);
  });

  await t.test('zoom controls change the map view and restore the original view', () => {
    const originalViewBox = $('#hokkaido-map').getAttribute('viewBox');
    assert.equal($('#zoom-out').disabled, true);
    $('#zoom-in').click();
    assert.notEqual($('#hokkaido-map').getAttribute('viewBox'), originalViewBox);
    assert.equal($('#zoom-out').disabled, false);
    $('#zoom-reset').click();
    assert.equal($('#hokkaido-map').getAttribute('viewBox'), originalViewBox);
  });

  await t.test('X share previews a recorded map and retains a text intent fallback', async () => {
    $('#share-top').click();
    assert.equal($('#share-dialog').open, true);
    await waitForImage();
    assert.equal($('#share-preview').hidden, false);
    assert.equal($('#share-download').disabled, false);
    assert.equal($('#share-native').hidden, true);
    assert.match($('#share-instructions').textContent, /自動添付されません/);
    $('#share-download').click();
    assert.match(clickedAnchor.href, /^blob:/);
    assert.match(clickedAnchor.download, /^keidochi-\d{4}-\d{2}-\d{2}\.png$/);
    $('#share-x').click();
    const url = new URL(clickedAnchor.href);
    assert.equal(url.hostname, 'twitter.com');
    assert.match(url.searchParams.get('text'), /7 \/ 895/);
    assert.match(url.searchParams.get('text'), /2 \/ 179/);
    assert.equal(url.searchParams.get('url'), 'https://example.com/keidochi/');
    assert.ok(!url.href.includes('script'));
    assert.equal(clickedAnchor.target, '_blank');
    assert.match(clickedAnchor.rel, /noopener/);
    $('#share-dialog').close();
    assert.equal($('#share-preview').hasAttribute('src'), false);
  });

  await t.test('native sharing passes the prepared PNG and results directly from a click', async () => {
    let shared;
    window.navigator.canShare = data => data.files[0].type === 'image/png';
    window.navigator.share = async data => { shared = data; };
    $('#share-top').click();
    await waitForImage();
    assert.equal($('#share-native').hidden, false);
    $('#share-native').click();
    assert.equal(shared.files.length, 1);
    assert.equal(shared.files[0].type, 'image/png');
    assert.match(shared.text, /7 \/ 895/);
    assert.match(shared.text, /#経道値 #北海道/);
    assert.ok(!shared.text.includes('スープカレー'));
    await waitForImage();
    assert.equal($('#share-dialog').open, false);
    delete window.navigator.canShare;
    delete window.navigator.share;
  });

  await t.test('cancelled native sharing keeps the preview; failures offer manual attachment', async () => {
    window.navigator.canShare = () => true;
    window.navigator.share = async () => { throw new window.DOMException('cancelled', 'AbortError'); };
    $('#share-top').click();
    await waitForImage();
    $('#share-native').click();
    await waitForImage();
    assert.equal($('#share-dialog').open, true);
    assert.equal($('#share-error').hidden, true);
    assert.equal($('#share-native').disabled, false);
    window.navigator.share = async () => { throw new window.DOMException('not allowed', 'NotAllowedError'); };
    $('#share-native').click();
    await waitForImage();
    assert.equal($('#share-error').hidden, false);
    assert.equal($('#share-download').disabled, false);
    $('#share-dialog').close();
    delete window.navigator.canShare;
    delete window.navigator.share;
  });

  await t.test('image generation failure can be retried without losing text sharing', async () => {
    imageFailure = true;
    $('#share-bottom').click();
    await waitForImage();
    assert.equal($('#share-error').hidden, false);
    assert.equal($('#share-retry').hidden, false);
    assert.equal($('#share-download').disabled, true);
    $('#share-x').click();
    assert.equal(new URL(clickedAnchor.href).hostname, 'twitter.com');
    imageFailure = false;
    $('#share-retry').click();
    await waitForImage();
    assert.equal($('#share-error').hidden, true);
    assert.equal($('#share-preview').hidden, false);
    $('#share-dialog').close();
  });

  await t.test('note edits are automatically persisted without changing municipality', async () => {
    $('#travel-note').value = '朝市の思い出';
    fire('#travel-note', 'input');
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(stored().records['01202'].note, '朝市の思い出');
    assert.match($('#save-status').textContent, /保存しました/);
  });

  await t.test('export downloads a JSON backup with a portable filename', () => {
    $('.data-open').click();
    $('#export-data').click();
    assert.match(clickedAnchor.href, /^blob:/);
    assert.match(clickedAnchor.download, /^keidochi-backup-\d{4}-\d{2}-\d{2}\.json$/);
    $('#data-dialog').close();
  });

  await t.test('invalid backup leaves existing data untouched; valid import requires confirmation', async () => {
    $('.data-open').click();
    const original = window.localStorage.getItem(STORAGE_KEY);
    await importFile('{broken');
    assert.equal($('#import-error').hidden, false);
    assert.equal(window.localStorage.getItem(STORAGE_KEY), original);
    await importFile(JSON.stringify({ version: 1, records: { '01202': { level: 5, note: '函館の思い出', updatedAt: new Date().toISOString() } } }));
    assert.equal($('#import-preview').hidden, false);
    assert.equal(window.localStorage.getItem(STORAGE_KEY), original);
    $('#confirm-import').click();
    assert.equal($('#total-score').textContent, '5');
    assert.equal(stored().records['01100'], undefined);
    assert.equal(stored().records['01202'].note, '函館の思い出');
    assert.equal($('#travel-note').value, '函館の思い出');
    assert.equal($('#data-dialog').open, false);
  });

  await t.test('failed persistence retains old record and the note draft', () => {
    const original = window.Storage.prototype.setItem;
    window.Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
    $('#travel-note').value = '保存失敗時に失われないメモ';
    selectLevel(4);
    assert.equal(stored().records['01202'].level, 5);
    assert.equal($('input[value="5"]').checked, true);
    assert.equal($('#travel-note').value, '保存失敗時に失われないメモ');
    assert.equal($('#toast').classList.contains('error'), true);
    window.Storage.prototype.setItem = original;
    fire('#travel-note', 'blur');
    assert.equal(stored().records['01202'].note, '保存失敗時に失われないメモ');
  });

  await t.test('another tab update is reflected without losing an edited note or other records', () => {
    $('#travel-note').value = '編集中のメモ';
    fire('#travel-note', 'input');
    const incoming = stored();
    incoming.records['01100'] = { level: 2, note: '', updatedAt: new Date().toISOString() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(incoming));
    window.dispatchEvent(new window.StorageEvent('storage', { key: STORAGE_KEY }));
    assert.equal($('#travel-note').value, '編集中のメモ');
    fire('#travel-note', 'blur');
    assert.equal(stored().records['01100'].level, 2);
    assert.equal(stored().records['01202'].note, '編集中のメモ');
  });

  await t.test('reset requires explicit confirmation and clears notes and aggregate results', () => {
    $('.data-open').click();
    $('#reset-open').click();
    assert.equal($('#reset-confirm').hidden, false);
    assert.ok(Object.keys(stored().records).length > 0);
    $('#reset-cancel').click();
    assert.ok(Object.keys(stored().records).length > 0);
    $('#reset-open').click();
    $('#reset-confirm-button').click();
    assert.deepEqual(stored().records, {});
    assert.equal($('#total-score').textContent, '0');
    assert.equal($('#travel-note').value, '');
    assert.equal($('#stayed-count').textContent, '0');
  });

  await t.test('corrupt stored data is protected and recording resumes after explicit reset', () => {
    const corrupt = '{invalid-data';
    window.localStorage.setItem(STORAGE_KEY, corrupt);
    window.dispatchEvent(new window.StorageEvent('storage', { key: STORAGE_KEY }));
    assert.equal($('#storage-warning').hidden, false);
    assert.equal($('input[name="experience"]').disabled, true);
    assert.equal($('#travel-note').disabled, true);
    assert.equal(window.localStorage.getItem(STORAGE_KEY), corrupt);
    $('.data-open').click();
    $('#reset-open').click();
    $('#reset-confirm-button').click();
    assert.equal($('#storage-warning').hidden, true);
    assert.equal($('#travel-note').disabled, false);
    selectLevel(1);
    assert.equal(stored().records['01202'].level, 1);
  });

  // Let the app's toast timeout finish against its live document; no external resources are loaded.
});
