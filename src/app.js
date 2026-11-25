import { municipalities } from './municipalities.js';
import { LEVELS, STORAGE_KEY, loadRecords, saveRecords, summarize, filterMunicipalities, shareUrl, validatePayload } from './model.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const byId = new Map(municipalities.map(city => [city.id, city]));
const validIds = new Set(byId.keys());
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const loaded = loadRecords(storage, validIds);
let records = loaded.records;
let storageError = loaded.error;
let selectedId = '01100';
let showAll = false;
let noteTimer;
let toastTimer;
let pendingImport = null;
let dragging = false;
let ignoreMapClick = false;
let zoom = 1;
const [mapLeft, mapTop, mapWidth, mapHeight] = $('#hokkaido-map').getAttribute('viewBox').split(/\s+/).map(Number);
const mapCenter = { x: mapLeft + mapWidth / 2, y: mapTop + mapHeight / 2 };
let center = { ...mapCenter };
const svgNS = 'http://www.w3.org/2000/svg';

const icons = {
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  flag: '<path d="M5 22V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
  moon: '<path d="M20.5 13A8.6 8.6 0 0 1 11 3.5 8.8 8.8 0 1 0 20.5 13Z"/><path d="M18 3v4m-2-2h4"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  cursor: '<path d="m4 3 6 17 3-7 7-3Z"/>',
};

for (const element of $$('[data-icon]')) {
  element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[element.dataset.icon] || ''}</svg>`;
}

function toast(message, isError = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', isError);
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, isError ? 6500 : 3200);
}

function updateStorageWarning() {
  const warning = $('#storage-warning');
  warning.hidden = !storageError;
  $('#local-status').classList.toggle('failed', !!storageError);
  $('#local-status').lastChild.textContent = storageError ? '保存を確認してください' : 'この端末に保存';
  if (storageError) {
    warning.replaceChildren(document.createTextNode('保存した記録を読み込めませんでした。既存データを保護するため記録を停止しています。保存機能が有効か確認し、バックアップを読み込むか、データ管理からリセットしてください。'));
    const button = document.createElement('button');
    button.textContent = 'データ管理を開く';
    button.addEventListener('click', () => openDialog('data-dialog'));
    warning.append(button);
  }
  for (const input of $$('input[name="experience"]')) input.disabled = !!storageError;
  $('#travel-note').disabled = !!storageError;
}

function commit(nextRecords, { recover = false } = {}) {
  if (storageError && !recover) {
    toast('保存できない状態です。データ管理を確認してください。', true);
    return false;
  }
  try {
    saveRecords(storage, nextRecords);
    records = nextRecords;
    storageError = null;
    updateStorageWarning();
    renderStats();
    renderMapState();
    renderList();
    return true;
  } catch {
    $('#local-status').classList.add('failed');
    $('#local-status').lastChild.textContent = '保存に失敗しました';
    toast('保存できませんでした。空き容量やブラウザーの保存設定を確認してください。', true);
    return false;
  }
}

function saveSelected(level = records[selectedId]?.level ?? 0, note = $('#travel-note').value) {
  const previous = records[selectedId];
  const nextNote = note.slice(0, 200);
  if ((previous?.level ?? 0) === level && (previous?.note ?? '') === nextNote) return true;
  const next = { ...records };
  if (level === 0 && nextNote === '') delete next[selectedId];
  else next[selectedId] = { level, note: nextNote, updatedAt: new Date().toISOString() };
  if (!commit(next)) return false;
  updateEditorBadge();
  $('#save-status span:last-child').textContent = 'このブラウザーに保存しました';
  return true;
}

function flushNote() {
  clearTimeout(noteTimer);
  return saveSelected();
}

function renderStats() {
  const summary = summarize(records);
  $('#total-score').textContent = summary.score;
  $('#touched-count').textContent = summary.touched;
  $('#visited-count').textContent = summary.visited;
  $('#stayed-count').textContent = summary.stayed;
  $('#coverage').replaceChildren(document.createTextNode(summary.percent), Object.assign(document.createElement('small'), { textContent: '%' }));
  $('#score-progress').style.width = `${summary.score / 895 * 100}%`;
  $('#coverage-progress').style.width = `${summary.touched / 179 * 100}%`;
  $('#score-message').textContent = `足あと ${summary.touched} / 179 市町村`;
  for (const item of $$('.legend-item')) {
    const level = Number(item.dataset.level);
    item.querySelector('small').textContent = summary.counts[level];
    item.title = `${LEVELS[level].label}：${summary.counts[level]}市町村`;
  }
}

function svgElement(name, attributes) {
  const element = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function createMap() {
  const fragment = document.createDocumentFragment();
  for (const city of municipalities) {
    const path = svgElement('path', { d: city.path, 'data-city-id': city.id, class: 'city-shape', tabindex: '0', role: 'button' });
    path.addEventListener('click', () => { if (!ignoreMapClick) selectCity(city.id, true); });
    path.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCity(city.id, true); }
    });
    path.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch' || dragging) return;
      const bounds = $('#map-canvas').getBoundingClientRect();
      const tooltip = $('#map-tooltip');
      tooltip.textContent = `${city.name} · ${LEVELS[records[city.id]?.level ?? 0].label}`;
      tooltip.hidden = false;
      tooltip.style.left = `${Math.max(65, Math.min(bounds.width - 65, event.clientX - bounds.left))}px`;
      tooltip.style.top = `${Math.max(48, event.clientY - bounds.top)}px`;
    });
    path.addEventListener('pointerleave', () => { $('#map-tooltip').hidden = true; });
    fragment.append(path);
  }
  $('#map-shapes').append(fragment);
  const labels = ['稚内市', '旭川市', '札幌市', '函館市', '帯広市', '釧路市', '根室市', '網走市'];
  for (const name of labels) {
    const city = municipalities.find(c => c.name === name);
    const [x, y] = city.point;
    $('#map-labels').append(svgElement('circle', { cx: x, cy: y, r: 2.5, class: 'map-label-dot' }));
    const label = svgElement('text', { x: x + 7, y: y + 4, class: 'map-city-label' });
    label.textContent = name.replace('市', '');
    $('#map-labels').append(label);
  }
  renderMapState();
}

function renderMapState() {
  for (const path of $$('.city-shape')) {
    const city = byId.get(path.dataset.cityId);
    const level = records[city.id]?.level ?? 0;
    path.style.fill = LEVELS[level].color;
    path.classList.toggle('selected', city.id === selectedId);
    path.setAttribute('aria-label', `${city.name}、${LEVELS[level].label}、${level}ポイント`);
    path.setAttribute('aria-pressed', String(city.id === selectedId));
  }
  // Draw the selected boundary last, so adjacent municipalities cannot cover it.
  const selected = $(`.city-shape[data-city-id="${selectedId}"]`);
  if (selected) $('#map-shapes').append(selected);
}

function updateEditorBadge() {
  const level = records[selectedId]?.level ?? 0;
  const badge = $('#city-badge');
  badge.textContent = `${LEVELS[level].label}${level ? ` · ${level} pt` : ''}`;
  badge.style.background = `${LEVELS[level].color}${level === 0 ? '' : '20'}`;
  badge.style.borderColor = `${LEVELS[level].color}${level === 0 ? '' : '80'}`;
}

function renderEditor() {
  const city = byId.get(selectedId);
  $('#record-title').textContent = city.name;
  $('#city-reading').textContent = city.reading;
  $('#city-region').textContent = city.bureau;
  const level = records[selectedId]?.level ?? 0;
  for (const input of $$('input[name="experience"]')) input.checked = Number(input.value) === level;
  $('#travel-note').value = records[selectedId]?.note ?? '';
  $('#note-count').textContent = $('#travel-note').value.length;
  $('#save-status span:last-child').textContent = records[selectedId] ? 'このブラウザーに保存済み' : '選んだ経験を自動で保存します';
  updateEditorBadge();
}

function selectCity(id, scroll = false) {
  if (id !== selectedId && !flushNote()) return;
  selectedId = id;
  renderEditor();
  renderMapState();
  for (const item of $$('.city-list-item')) item.classList.toggle('active', item.dataset.cityId === id);
  $('#map-tooltip').hidden = true;
  if (scroll && window.matchMedia('(max-width:720px)').matches) {
    $('#record-card').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }
}

function createLevelUI() {
  LEVELS.forEach((level, index) => {
    const option = document.createElement('label');
    option.className = 'experience-option';
    option.innerHTML = `<input type="radio" name="experience" value="${index}" aria-label="${level.label} ${index}ポイント：${level.description}"><span class="option-dot" style="background:${level.color}"></span><span class="option-copy"><strong>${level.label}</strong><small>${level.description}</small></span><span class="option-points">${index}<small>pt</small></span><span class="option-check" aria-hidden="true"></span>`;
    option.querySelector('input').addEventListener('change', () => {
      clearTimeout(noteTimer);
      if (!saveSelected(index)) {
        for (const input of $$('input[name="experience"]')) input.checked = Number(input.value) === (records[selectedId]?.level ?? 0);
        $('#save-status span:last-child').textContent = '保存できませんでした。メモをコピーして保管してください';
      }
    });
    $('#experience-options').append(option);
    const legend = document.createElement('div');
    legend.className = 'legend-item';
    legend.dataset.level = index;
    legend.innerHTML = `<span class="color-dot" style="--dot-color:${level.color}"></span>${level.label}<small>0</small>`;
    $('#map-legend').append(legend);
    const help = document.createElement('div');
    help.className = 'help-level';
    help.innerHTML = `<span class="color-dot" style="--dot-color:${level.color}"></span><strong>${level.label}</strong><span>${level.description}</span><small>${index} pt</small>`;
    $('#help-levels').append(help);
    const filterOption = document.createElement('option');
    filterOption.value = index;
    filterOption.textContent = `${level.label}（${index} pt）`;
    $('#level-filter').append(filterOption);
  });
  const regions = [...new Set(municipalities.map(city => city.region))].sort((a, b) => a.localeCompare(b, 'ja'));
  for (const region of regions) {
    const option = document.createElement('option');
    option.value = region;
    option.textContent = region;
    $('#region-filter').append(option);
  }
}

function renderList() {
  const filters = { query: $('#city-search').value, region: $('#region-filter').value, level: $('#level-filter').value };
  const filtered = filterMunicipalities(municipalities, records, filters);
  const hasFilter = !!(filters.query || filters.region || filters.level !== '');
  const visible = showAll || hasFilter ? filtered : filtered.slice(0, 12);
  const fragment = document.createDocumentFragment();
  for (const city of visible) {
    const level = records[city.id]?.level ?? 0;
    const item = document.createElement('button');
    item.className = `city-list-item${selectedId === city.id ? ' active' : ''}`;
    item.dataset.cityId = city.id;
    item.setAttribute('aria-label', `${city.name}、${LEVELS[level].label}。記録を編集`);
    item.innerHTML = `<span class="color-dot" style="--dot-color:${LEVELS[level].color}"></span><span class="list-city-name">${city.name}<small>${city.region}</small></span><span class="list-city-level">${LEVELS[level].label}</span><span class="city-chevron" aria-hidden="true">›</span>`;
    item.addEventListener('click', () => {
      selectCity(city.id);
      $('#record-card').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth', block: 'start' });
      $('#record-title').setAttribute('tabindex', '-1');
      $('#record-title').focus({ preventScroll: true });
    });
    fragment.append(item);
  }
  $('#city-grid').replaceChildren(fragment);
  $('#result-count').textContent = filtered.length;
  $('#empty-state').hidden = filtered.length > 0;
  $('#show-all').hidden = hasFilter || filtered.length <= 12;
  $('#show-all').innerHTML = showAll ? '表示を少なくする <span aria-hidden="true">↑</span>' : `すべての市町村を表示（179） <span aria-hidden="true">↓</span>`;
}

$('#city-search').addEventListener('input', renderList);
$('#region-filter').addEventListener('change', renderList);
$('#level-filter').addEventListener('change', renderList);
$('#clear-filters').addEventListener('click', () => {
  $('#city-search').value = '';
  $('#region-filter').value = '';
  $('#level-filter').value = '';
  showAll = false;
  renderList();
  $('#city-search').focus();
});
$('#show-all').addEventListener('click', () => {
  showAll = !showAll;
  renderList();
  if (!showAll) $('#municipalities').scrollIntoView({ block: 'start' });
});
$('#travel-note').addEventListener('input', () => {
  $('#note-count').textContent = $('#travel-note').value.length;
  $('#save-status span:last-child').textContent = '保存中…';
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    if (!flushNote()) $('#save-status span:last-child').textContent = '保存できませんでした。メモをコピーして保管してください';
  }, 450);
});
$('#travel-note').addEventListener('blur', () => { flushNote(); });
window.addEventListener('pagehide', () => { flushNote(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNote(); });

function renderViewbox() {
  const width = mapWidth / zoom, height = mapHeight / zoom;
  center.x = Math.max(mapLeft + width / 2, Math.min(mapLeft + mapWidth - width / 2, center.x));
  center.y = Math.max(mapTop + height / 2, Math.min(mapTop + mapHeight - height / 2, center.y));
  $('#hokkaido-map').setAttribute('viewBox', `${center.x - width / 2} ${center.y - height / 2} ${width} ${height}`);
  $('#hokkaido-map').classList.toggle('zoomed', zoom > 1);
  $('#zoom-out').disabled = zoom <= 1;
  $('#zoom-in').disabled = zoom >= 4;
  $('.map-hint span:last-child').textContent = zoom > 1 ? 'ドラッグで地図を移動' : 'まちを選んで記録';
  $('#map-tooltip').hidden = true;
}
$('#zoom-in').addEventListener('click', () => {
  if (zoom === 1) { const city = byId.get(selectedId); center = { x: city.point[0], y: city.point[1] }; }
  zoom = Math.min(4, zoom * 1.4); renderViewbox();
});
$('#zoom-out').addEventListener('click', () => { zoom = Math.max(1, zoom / 1.4); renderViewbox(); });
$('#zoom-reset').addEventListener('click', () => { zoom = 1; center = { ...mapCenter }; renderViewbox(); });
let pointerStart = null;
$('#hokkaido-map').addEventListener('pointerdown', event => {
  ignoreMapClick = false;
  if (zoom <= 1 || event.button !== 0) return;
  pointerStart = { x: event.clientX, y: event.clientY, center: { ...center } };
});
$('#hokkaido-map').addEventListener('pointermove', event => {
  if (!pointerStart) return;
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  if (!dragging && Math.hypot(dx, dy) < 5) return;
  dragging = true;
  ignoreMapClick = true;
  $('#hokkaido-map').classList.add('dragging');
  if (!$('#hokkaido-map').hasPointerCapture(event.pointerId)) $('#hokkaido-map').setPointerCapture(event.pointerId);
  const bounds = $('#hokkaido-map').getBoundingClientRect();
  const scale = Math.min(bounds.width / (mapWidth / zoom), bounds.height / (mapHeight / zoom));
  center.x = pointerStart.center.x - dx / scale;
  center.y = pointerStart.center.y - dy / scale;
  renderViewbox();
});
function endDrag(event) {
  pointerStart = null;
  dragging = false;
  $('#hokkaido-map').classList.remove('dragging');
  if ($('#hokkaido-map').hasPointerCapture(event.pointerId)) $('#hokkaido-map').releasePointerCapture(event.pointerId);
}
$('#hokkaido-map').addEventListener('pointerup', endDrag);
$('#hokkaido-map').addEventListener('pointercancel', endDrag);
$('#hokkaido-map').addEventListener('pointerleave', () => { if (!dragging) pointerStart = null; });

function openDialog(id) {
  if (!storageError && !flushNote()) return;
  $(`#${id}`).showModal();
}
$('#help-open').addEventListener('click', () => openDialog('help-dialog'));
$('#about-open').addEventListener('click', () => openDialog('about-dialog'));
for (const button of $$('.data-open')) button.addEventListener('click', () => openDialog('data-dialog'));
for (const button of $$('.close-dialog')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of $$('dialog')) {
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}
$('#data-dialog').addEventListener('close', () => {
  pendingImport = null;
  $('#import-preview').hidden = true;
  $('#reset-confirm').hidden = true;
  $('#import-error').hidden = true;
  $('#import-data').value = '';
});

function share() {
  if (!storageError && !flushNote()) return;
  const link = document.createElement('a');
  link.href = shareUrl(records, window.location.href);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.click();
}
$('#share-top').addEventListener('click', share);
$('#share-bottom').addEventListener('click', share);

$('#export-data').addEventListener('click', () => {
  if (storageError) { toast('既存データを正常に読み込めないため、書き出せません。', true); return; }
  if (!flushNote()) return;
  const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  link.href = url;
  link.download = `keidochi-backup-${date}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('バックアップを書き出しました');
});

$('#import-open').addEventListener('click', () => $('#import-data').click());
$('#import-data').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  $('#import-error').hidden = true;
  $('#import-preview').hidden = true;
  pendingImport = null;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('ファイルが大きすぎます。2 MB以下のバックアップを選んでください。');
    const payload = JSON.parse(await file.text());
    pendingImport = validatePayload(payload, validIds);
    const summary = summarize(pendingImport);
    $('#import-summary').textContent = `バックアップ：経道値 ${summary.score} pt ／ 足あと ${summary.touched}市町村 ／ メモ ${Object.values(pendingImport).filter(r => r.note).length}件。この内容で現在のすべての記録を置き換えます。`;
    $('#import-preview').hidden = false;
    $('#reset-confirm').hidden = true;
  } catch (error) {
    $('#import-error').textContent = error instanceof SyntaxError ? 'JSONファイルを読み込めませんでした。経道値から書き出したバックアップを選んでください。' : error.message;
    $('#import-error').hidden = false;
  }
  event.target.value = '';
});
$('#cancel-import').addEventListener('click', () => { pendingImport = null; $('#import-preview').hidden = true; });
$('#confirm-import').addEventListener('click', () => {
  if (!pendingImport) return;
  clearTimeout(noteTimer);
  if (commit(pendingImport, { recover: true })) {
    renderEditor();
    pendingImport = null;
    $('#data-dialog').close();
    toast('バックアップから記録を復元しました');
  }
});
$('#reset-open').addEventListener('click', () => { $('#reset-confirm').hidden = false; $('#import-preview').hidden = true; pendingImport = null; });
$('#reset-cancel').addEventListener('click', () => { $('#reset-confirm').hidden = true; });
$('#reset-confirm-button').addEventListener('click', () => {
  clearTimeout(noteTimer);
  if (commit(Object.create(null), { recover: true })) {
    renderEditor();
    $('#data-dialog').close();
    toast('すべての記録をリセットしました');
  }
});

// Keep other tabs in sync while preserving the current note draft.
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  const hasDraft = $('#travel-note').value !== (records[selectedId]?.note ?? '');
  const result = loadRecords(storage, validIds);
  records = result.records;
  storageError = result.error;
  renderStats(); renderMapState(); renderList(); updateStorageWarning();
  if (hasDraft) {
    for (const input of $$('input[name="experience"]')) input.checked = Number(input.value) === (records[selectedId]?.level ?? 0);
    updateEditorBadge();
    toast('別のタブの記録を反映しました。編集中のメモはそのままです。');
  } else renderEditor();
});

createLevelUI();
createMap();
renderStats();
renderEditor();
renderList();
renderViewbox();
updateStorageWarning();
