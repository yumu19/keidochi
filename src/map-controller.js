import { municipalities } from './municipalities.js';
import { populations } from './population.js';
import { LEVELS } from './model.js';

export function createMapController({ document, getRecords, getSelectedId, onSelect, readOnly = false }) {
  const window = document.defaultView;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const byId = new Map(municipalities.map(city => [city.id, city]));
  let dragging = false;
  let ignoreMapClick = false;
  let zoom = 1;
  const [mapLeft, mapTop, mapWidth, mapHeight] = $('#hokkaido-map').getAttribute('viewBox').split(/\s+/).map(Number);
  const mapCenter = { x: mapLeft + mapWidth / 2, y: mapTop + mapHeight / 2 };
  let center = { ...mapCenter };
  const svgNS = 'http://www.w3.org/2000/svg';

  function svgElement(name, attributes) {
    const element = document.createElementNS(svgNS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

  function createMap() {
    const fragment = document.createDocumentFragment();
    for (const city of municipalities) {
      const path = svgElement('path', { d: city.path, 'data-city-id': city.id, class: 'city-shape', tabindex: '0', role: 'button' });
      path.addEventListener('click', () => { if (!ignoreMapClick) onSelect(city.id, true); });
      path.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(city.id, true); }
      });
      path.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch' || dragging) return;
        const bounds = $('#map-canvas').getBoundingClientRect();
        const tooltip = $('#map-tooltip');
        tooltip.textContent = `${city.name} · ${LEVELS[getRecords()[city.id]?.level ?? 0].label}`;
        tooltip.hidden = false;
        const tooltipMargin = tooltip.offsetWidth / 2 + 8;
        tooltip.style.left = `${Math.max(tooltipMargin, Math.min(bounds.width - tooltipMargin, event.clientX - bounds.left))}px`;
        tooltip.style.top = `${Math.max(48, event.clientY - bounds.top)}px`;
      });
      path.addEventListener('pointerleave', () => { $('#map-tooltip').hidden = true; });
      fragment.append(path);
    }
    $('#map-shapes').append(fragment);
    const landmarks = new Set([
      '稚内市', '名寄市', '留萌市', '紋別市',
      '網走市', '根室市', '富良野市', '室蘭市',
      '岩見沢市', '倶知安町', '江差町', '浦河町',
    ]);
    const hiddenLabels = new Set(['江別市']);
    const labels = municipalities.filter(city => !hiddenLabels.has(city.name) &&
      ((city.name.endsWith('市') && populations[city.name] >= 100000) || landmarks.has(city.name)));
    const labelPositions = {
      '小樽市': { dx: -8, dy: -7, anchor: 'end' },
      '札幌市': { dx: 8, dy: 17, anchor: 'start' },
      '苫小牧市': { dx: 7, dy: 18, anchor: 'start' },
      '北見市': { dx: 8, dy: 17, anchor: 'start' },
      '留萌市': { dx: -8, dy: 4, anchor: 'end' },
      '紋別市': { dx: 7, dy: -20, anchor: 'start' },
      '網走市': { dx: -8, dy: -15, anchor: 'end' },
      '室蘭市': { dx: -8, dy: 4, anchor: 'end' },
      '岩見沢市': { dx: -8, dy: -38, anchor: 'end' },
      '倶知安町': { dx: -8, dy: 4, anchor: 'end' },
      '江差町': { dx: -8, dy: 4, anchor: 'end' },
    };
    for (const city of labels) {
      const major = populations[city.name] >= 100000;
      const [x, y] = city.point;
      const { dx, dy, anchor } = labelPositions[city.name] ?? { dx: 7, dy: 4, anchor: 'start' };
      if (Math.abs(dy) > 28) {
        $('#map-labels').append(svgElement('line', {
          x1: x, y1: y, x2: x + dx + 3, y2: y + dy + 7,
          stroke: '#51717e', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none',
        }));
      }
      $('#map-labels').append(svgElement('circle', { cx: x, cy: y, r: major ? 3 : 2.5, class: 'map-label-dot' }));
      const label = svgElement('text', {
        x: x + dx, y: y + dy, 'text-anchor': anchor,
        class: `map-city-label${major ? ' major-city-label' : ''}`, 'data-city-id': city.id,
      });
      label.textContent = city.name.replace(/[市町村]$/, '');
      $('#map-labels').append(label);
    }
    renderMapState();
  }

  function renderMapState() {
    for (const path of $$('.city-shape')) {
      const city = byId.get(path.dataset.cityId);
      const level = getRecords()[city.id]?.level ?? 0;
      path.style.fill = LEVELS[level].color;
      path.classList.toggle('selected', city.id === getSelectedId());
      path.setAttribute('aria-label', `${city.name}、${LEVELS[level].label}、${level}ポイント`);
      path.setAttribute('aria-pressed', String(city.id === getSelectedId()));
    }
    // Draw the selected boundary last, so adjacent municipalities cannot cover it.
    const selected = $(`.city-shape[data-city-id="${getSelectedId()}"]`);
    if (selected) $('#map-shapes').append(selected);
  }

  function renderViewbox() {
    const width = mapWidth / zoom, height = mapHeight / zoom;
    center.x = Math.max(mapLeft + width / 2, Math.min(mapLeft + mapWidth - width / 2, center.x));
    center.y = Math.max(mapTop + height / 2, Math.min(mapTop + mapHeight - height / 2, center.y));
    $('#hokkaido-map').setAttribute('viewBox', `${center.x - width / 2} ${center.y - height / 2} ${width} ${height}`);
    $('#hokkaido-map').classList.toggle('zoomed', zoom > 1);
    $('#zoom-out').disabled = zoom <= 1;
    $('#zoom-in').disabled = zoom >= 4;
    $('.map-hint span:last-child').textContent = zoom > 1 ? 'ドラッグで地図を移動' : readOnly ? 'まちを選んで経験を確認' : 'まちを選んで記録';
    $('#map-tooltip').hidden = true;
  }
  $('#zoom-in').addEventListener('click', () => {
    if (zoom === 1) { const city = byId.get(getSelectedId()); center = { x: city.point[0], y: city.point[1] }; }
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

  createMap();
  renderViewbox();

  return { render: renderMapState, fullViewBox: `${mapLeft} ${mapTop} ${mapWidth} ${mapHeight}` };
}
