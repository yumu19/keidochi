import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { municipalities } from '../src/municipalities.js';
import { LEVELS, shareUrl } from '../src/model.js';
import { createShareSvg, canShareImage, imageShareData, createShareImage } from '../src/share-image.js';

test('share snapshot includes all recorded municipality colors, full map, labels and score; excludes notes and selection', () => {
  const dom = new JSDOM('<svg id="map" viewBox="300 200 200 200"><g id="map-shapes"></g><g id="map-labels"></g></svg>');
  const map = dom.window.document.querySelector('svg');
  const records = Object.fromEntries(municipalities.map((city, index) => [city.id, { level: index % 6, note: 'PRIVATE <script>test</script>', updatedAt: '2026-11-25' }]));
  map.querySelector('#map-shapes').innerHTML = municipalities.map(city => `<path data-city-id="${city.id}" class="city-shape selected" tabindex="0" role="button" style="fill:red;filter:blur(10px)" d="${city.path}"/>`).join('');
  map.querySelector('#map-labels').innerHTML = '<text class="map-city-label major-city-label" x="300" y="300">札幌</text><circle class="map-label-dot" cx="300" cy="300" r="3"/>';
  const svg = createShareSvg(map, records, '105 5 650 570');
  const parsed = new dom.window.DOMParser().parseFromString(svg, 'image/svg+xml');
  assert.equal(parsed.querySelector('parsererror'), null);
  assert.equal(parsed.documentElement.getAttribute('width'), '1200');
  assert.equal(parsed.querySelector('svg svg').getAttribute('viewBox'), '105 5 650 570');
  const paths = [...parsed.querySelectorAll('path')];
  assert.equal(paths.length, 179);
  paths.forEach((path, index) => {
    assert.equal(path.getAttribute('fill'), LEVELS[index % 6].color);
    assert.equal(path.hasAttribute('style'), false);
    assert.equal(path.hasAttribute('tabindex'), false);
  });
  assert.ok(parsed.documentElement.textContent.includes('札幌'));
  assert.ok(parsed.documentElement.textContent.includes('地図データ：北海道オープンデータ'));
  assert.ok(!svg.includes('PRIVATE') && !svg.includes('script') && !svg.includes('selected'));
  assert.equal(map.getAttribute('viewBox'), '300 200 200 200');
  assert.ok(map.querySelector('.selected'));
  dom.window.close();
});

test('native file sharing is only offered when the exact file type is supported', () => {
  const file = new File(['png'], 'keidochi.png', { type: 'image/png' });
  assert.equal(canShareImage(file, {}), false);
  assert.equal(canShareImage(file, { share() {} }), false);
  assert.equal(canShareImage(file, { share() {}, canShare: () => false }), false);
  assert.equal(canShareImage(file, { share() {}, canShare() { throw new Error('blocked'); } }), false);
  assert.equal(canShareImage(file, { share() {}, canShare: data => data.files[0] === file }), true);
  const data = imageShareData(file, shareUrl({ '01100': { level: 4, note: 'PRIVATE' } }, 'https://example.com/keidochi/?private=1'));
  assert.equal(data.files[0], file);
  assert.match(data.text, /4 \/ 895/);
  assert.match(data.text, /#経道値 #北海道/);
  assert.ok(data.text.includes('https://example.com/keidochi/'));
  assert.ok(!data.text.includes('PRIVATE') && !data.text.includes('private=1'));
});

test('temporary SVG URLs are released when canvas rendering or encoding fails', async () => {
  for (const failure of ['context', 'encoding', 'image']) {
    let revoked = null;
    const browserWindow = {
      Blob, File,
      URL: { createObjectURL: () => 'blob:temporary-svg', revokeObjectURL: url => { revoked = url; } },
      Image: class { set src(value) { queueMicrotask(() => failure === 'image' ? this.onerror() : this.onload()); } },
      document: { createElement: () => ({ getContext: () => failure === 'context' ? null : { drawImage() {} }, toBlob: callback => callback(null) }) },
    };
    await assert.rejects(() => createShareImage('<svg/>', browserWindow));
    assert.equal(revoked, 'blob:temporary-svg');
  }
});
