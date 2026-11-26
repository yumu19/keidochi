import { municipalities } from './municipalities.js';
import { LEVELS, filterMunicipalities } from './model.js';

export function createCityList({ document, getRecords, getSelectedId, onSelect, readOnly = false }) {
  const window = document.defaultView;
  const $ = selector => document.querySelector(selector);
  let showAll = false;
  function renderList() {
    const filters = { query: $('#city-search').value, region: $('#region-filter').value, level: $('#level-filter').value };
    const filtered = filterMunicipalities(municipalities, getRecords(), filters);
    const hasFilter = !!(filters.query || filters.region || filters.level !== '');
    const visible = showAll || hasFilter ? filtered : filtered.slice(0, 12);
    const fragment = document.createDocumentFragment();
    for (const city of visible) {
      const level = getRecords()[city.id]?.level ?? 0;
      const item = document.createElement('button');
      item.className = `city-list-item${getSelectedId() === city.id ? ' active' : ''}`;
      item.dataset.cityId = city.id;
      item.setAttribute('aria-label', `${city.name}、${LEVELS[level].label}。${readOnly ? '共有された経験を確認' : '記録を編集'}`);
      item.innerHTML = `<span class="color-dot" style="--dot-color:${LEVELS[level].color}"></span><span class="list-city-name">${city.name}<small>${city.region}</small></span><span class="list-city-level">${LEVELS[level].label}</span><span class="city-chevron" aria-hidden="true">›</span>`;
      item.addEventListener('click', () => {
        onSelect(city.id);
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

  renderList();

  return { render: renderList };
}
