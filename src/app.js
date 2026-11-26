import { createMapController } from './map-controller.js';
import { createCityList } from './city-list.js';
import { createShareController } from './share-controller.js';
import { createRecordLink } from './shared-records.js';
import { renderIcons, createToast, renderOverview, createLevelPresentation, bindDialogs } from './record-display.js';
import { municipalities } from './municipalities.js';
import { LEVELS, STORAGE_KEY, loadRecords, saveRecords, summarize, validatePayload } from './model.js';

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
let noteTimer;
let pendingImport = null;
const toast = createToast(document);
const renderStats = () => {
  renderOverview(document, records);
  $('#view-record').href = createRecordLink(records, window.location.href);
};
const renderMapState = () => mapController.render();
const renderList = () => cityList.render();

function updateStorageWarning() {
  const warning = $('#storage-warning');
  warning.hidden = !storageError;
  $('#local-status').classList.toggle('failed', !!storageError);
  $('#local-status').title = storageError ? '保存データを確認してください。クリックしてバックアップ・復元を開きます。' : '記録のバックアップ・復元を開く';
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
    $('#local-status').title = '保存に失敗しました。クリックしてバックアップ・復元を開きます。';
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
  window.clearTimeout(noteTimer);
  return saveSelected();
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
      window.clearTimeout(noteTimer);
      if (!saveSelected(index)) {
        for (const input of $$('input[name="experience"]')) input.checked = Number(input.value) === (records[selectedId]?.level ?? 0);
        $('#save-status span:last-child').textContent = '保存できませんでした。メモをコピーして保管してください';
      }
    });
    $('#experience-options').prepend(option);
  });
}

$('#travel-note').addEventListener('input', () => {
  $('#note-count').textContent = $('#travel-note').value.length;
  $('#save-status span:last-child').textContent = '保存中…';
  window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => {
    if (!flushNote()) $('#save-status span:last-child').textContent = '保存できませんでした。メモをコピーして保管してください';
  }, 450);
});
$('#travel-note').addEventListener('blur', () => { flushNote(); });
window.addEventListener('pagehide', () => { flushNote(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNote(); });

function openDialog(id) {
  if (!storageError && !flushNote()) return;
  $(`#${id}`).showModal();
}
$('#view-record').addEventListener('click', event => {
  if (!storageError && !flushNote()) event.preventDefault();
});
$('#help-open').addEventListener('click', () => openDialog('help-dialog'));
$('#about-open').addEventListener('click', () => openDialog('about-dialog'));
for (const button of $$('.data-open')) button.addEventListener('click', () => openDialog('data-dialog'));
$('#data-dialog').addEventListener('close', () => {
  pendingImport = null;
  $('#import-preview').hidden = true;
  $('#reset-confirm').hidden = true;
  $('#import-error').hidden = true;
  $('#import-data').value = '';
});

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
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  window.clearTimeout(noteTimer);
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
  window.clearTimeout(noteTimer);
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
createLevelPresentation(document);
renderIcons(document);
bindDialogs(document);
const mapController = createMapController({ document, getRecords: () => records, getSelectedId: () => selectedId, onSelect: selectCity });
const cityList = createCityList({ document, getRecords: () => records, getSelectedId: () => selectedId, onSelect: selectCity });
createShareController({ document, getRecords: () => records, fullViewBox: mapController.fullViewBox, toast, beforeShare: () => !!storageError || flushNote() });
renderStats();
renderEditor();
updateStorageWarning();
