import { municipalities } from './municipalities.js';
import { LEVELS, summarize, progressMessage } from './model.js';

export function renderIcons(document) {
  const $$ = selector => [...document.querySelectorAll(selector)];
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
}

export function createToast(document) {
  const window = document.defaultView;
  const $ = selector => document.querySelector(selector);
  let toastTimer;
  function toast(message, isError = false) {
    window.clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').classList.toggle('error', isError);
    $('#toast').hidden = false;
    toastTimer = window.setTimeout(() => { $('#toast').hidden = true; }, isError ? 6500 : 3200);
  }

  return toast;
}
export function renderOverview(document, records) {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const summary = summarize(records);
  $('#total-score').textContent = summary.score;
  $('#touched-count').textContent = summary.touched;
  $('#visited-count').textContent = summary.visited;
  $('#stayed-count').textContent = summary.stayed;
  $('#coverage').replaceChildren(document.createTextNode(summary.percent), Object.assign(document.createElement('small'), { textContent: '%' }));
  $('#score-progress').style.width = `${summary.score / 895 * 100}%`;
  $('#coverage-progress').style.width = `${summary.touched / 179 * 100}%`;
  const scoreMessage = $('#score-message');
  if (scoreMessage) scoreMessage.textContent = progressMessage(summary.touched);
  for (const item of $$('.legend-item')) {
    const level = Number(item.dataset.level);
    item.querySelector('small').textContent = summary.counts[level];
    item.title = `${LEVELS[level].label}：${summary.counts[level]}市町村`;
  }
}

export function createLevelPresentation(document) {
  const $ = selector => document.querySelector(selector);
  LEVELS.forEach((level, index) => {
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

export function bindDialogs(document) {
  const $$ = selector => [...document.querySelectorAll(selector)];
  for (const button of $$('.close-dialog')) button.addEventListener('click', () => button.closest('dialog').close());
  for (const dialog of $$('dialog')) {
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
  }
}
