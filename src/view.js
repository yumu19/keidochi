import { municipalities } from './municipalities.js';
import { LEVELS } from './model.js';
import { readSharedLink } from './shared-records.js';
import { createMapController } from './map-controller.js';
import { createCityList } from './city-list.js';
import { renderIcons, renderOverview, createLevelPresentation, bindDialogs } from './record-display.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const byId = new Map(municipalities.map(city => [city.id, city]));
let sharedView;
let records;
let selectedId = '01100';

function readLocation() {
  sharedView = readSharedLink(window.location.href) ?? {
    records: Object.freeze(Object.create(null)),
    error: new Error('記録付きの共有リンクを開いてください。'),
  };
  records = sharedView.records;
}

function renderDetail() {
  const city = byId.get(selectedId);
  const level = records[selectedId]?.level ?? 0;
  $('#record-title').textContent = city.name;
  $('#city-reading').textContent = city.reading;
  $('#city-region').textContent = city.bureau;
  $('#viewer-experience').textContent = LEVELS[level].label;
  $('#viewer-points').textContent = level;
  $('#viewer-description').textContent = LEVELS[level].description;
  const badge = $('#city-badge');
  badge.textContent = LEVELS[level].label;
  badge.style.background = `${LEVELS[level].color}${level ? '20' : ''}`;
  badge.style.borderColor = `${LEVELS[level].color}${level ? '80' : ''}`;
}

function selectCity(id, scroll = false) {
  selectedId = id;
  renderDetail();
  map.render();
  for (const item of $$('.city-list-item')) item.classList.toggle('active', item.dataset.cityId === id);
  $('#map-tooltip').hidden = true;
  if (scroll && window.matchMedia('(max-width:720px)').matches) {
    $('#record-card').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }
}

function render() {
  const invalid = !!sharedView.error;
  $('#shared-view').classList.toggle('invalid', invalid);
  $('#shared-view-title').textContent = invalid ? '共有リンクのデータを読み込めませんでした' : '共有された記録を表示しています';
  $('#shared-view-description').textContent = invalid
    ? '記録付きの共有リンクを確認してください。右上の「自分の記録を入力」から、自分の記録を編集する画面に移動できます。'
    : 'このページは閲覧専用です。右上の「自分の記録を入力」から、自分の記録を編集する画面に移動できます。';
  for (const section of $$('.overview, #workspace, #municipalities')) section.hidden = invalid;
  renderOverview(document, records);
  renderDetail();
  map.render();
  list.render();
}

readLocation();
renderIcons(document);
createLevelPresentation(document);
bindDialogs(document);
const map = createMapController({ document, getRecords: () => records, getSelectedId: () => selectedId, onSelect: selectCity, readOnly: true });
const list = createCityList({ document, getRecords: () => records, getSelectedId: () => selectedId, onSelect: selectCity, readOnly: true });
$('#help-open').addEventListener('click', () => $('#help-dialog').showModal());
$('#about-open').addEventListener('click', () => $('#about-dialog').showModal());
window.addEventListener('hashchange', () => {
  for (const dialog of $$('dialog[open]')) dialog.close();
  readLocation();
  render();
});
// In-page navigation must preserve the record stored in the URL fragment.
for (const link of $$('a[href^="#"]')) link.addEventListener('click', event => {
  const target = $(link.getAttribute('href'));
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ block: 'start' });
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
});
render();
