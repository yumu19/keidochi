import { LEVELS, summarize } from './model.js';

const escapeXml = value => String(value).replace(/[<>&"']/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]);

/** Capture the recorded map at full extent, without editor controls or personal notes. */
export function createShareSvg(map, records, viewBox, { shared = false } = {}) {
  const snapshot = map.cloneNode(true);
  snapshot.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns', 'http://www.w3.org/2000/svg');
  snapshot.setAttribute('viewBox', viewBox);
  snapshot.setAttribute('x', '90');
  snapshot.setAttribute('y', '242');
  snapshot.setAttribute('width', '1020');
  snapshot.setAttribute('height', '810');
  snapshot.removeAttribute('id');
  snapshot.removeAttribute('class');
  snapshot.removeAttribute('aria-labelledby');
  snapshot.querySelectorAll('title, desc').forEach(element => element.remove());
  for (const path of snapshot.querySelectorAll('.city-shape')) {
    const level = records[path.dataset.cityId]?.level ?? 0;
    path.setAttribute('fill', LEVELS[level].color);
    path.setAttribute('stroke', '#ffffff');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    for (const name of ['class', 'style', 'tabindex', 'role', 'aria-label', 'aria-pressed', 'data-city-id']) path.removeAttribute(name);
  }
  for (const label of snapshot.querySelectorAll('.map-city-label')) {
    label.setAttribute('fill', '#244555');
    label.setAttribute('font-size', '24');
    label.setAttribute('font-weight', label.classList.contains('major-city-label') ? '700' : '600');
    label.setAttribute('stroke', '#ffffff');
    label.setAttribute('stroke-width', '3.5');
    label.setAttribute('stroke-linejoin', 'round');
    label.setAttribute('paint-order', 'stroke');
    label.removeAttribute('class');
    label.removeAttribute('data-city-id');
  }
  for (const dot of snapshot.querySelectorAll('.map-label-dot')) {
    dot.setAttribute('fill', '#244555');
    dot.setAttribute('stroke', '#ffffff');
    dot.setAttribute('stroke-width', '1.5');
    dot.removeAttribute('class');
  }
  const { score, touched, visited, stayed, counts } = summarize(records);
  const mapMarkup = new map.ownerDocument.defaultView.XMLSerializer().serializeToString(snapshot);
  const legend = LEVELS.map((level, index) => {
    const x = 107 + index * 169;
    return `<g transform="translate(${x},1092)"><rect width="26" height="26" rx="5" fill="${level.color}"/><text x="36" y="23" font-size="28" fill="#304b43">${escapeXml(level.label)} <tspan font-size="24" fill="#657c73">${counts[index]}</tspan></text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
    <rect width="1200" height="1200" fill="#f6f7f1"/>
    <g font-family="Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif">
      <text x="64" y="79" font-size="40" font-weight="700" fill="#264f43">経道値 <tspan font-size="24" letter-spacing="3">KEIDOCHI</tspan></text>
      <text x="1136" y="74" text-anchor="end" font-size="24" fill="#637666">北海道179市町村の旅の記録</text>
      <rect x="48" y="109" width="1104" height="112" rx="15" fill="#234c40"/>
      <text x="74" y="145" font-size="24" fill="#d9e6cb">${shared ? '共有された経道値' : '私の経道値'}</text>
      <text x="74" y="198" font-size="53" font-weight="700" fill="#ffffff">${score}<tspan dx="12" font-size="24" font-weight="400" fill="#d9e6cb">/ 895 pt</tspan></text>
      <text x="465" y="153" font-size="24" fill="#d9e6cb">足あとを残したまち</text>
      <text x="465" y="193" font-size="31" fill="#ffffff">${touched}<tspan font-size="24"> / 179</tspan></text>
      <text x="742" y="153" font-size="24" fill="#d9e6cb">訪問以上</text>
      <text x="742" y="193" font-size="31" fill="#ffffff">${visited}<tspan font-size="24"> 市町村</tspan></text>
      <text x="951" y="153" font-size="24" fill="#d9e6cb">宿泊以上</text>
      <text x="951" y="193" font-size="31" fill="#ffffff">${stayed}<tspan font-size="24"> 市町村</tspan></text>
      <rect x="48" y="240" width="1104" height="810" rx="15" fill="#edf5fa"/>
      ${mapMarkup}
      ${legend}
      <text x="64" y="1160" font-size="24" fill="#6b8077">地図データ：北海道オープンデータ（CC BY）を加工</text>
      <text x="1136" y="1160" text-anchor="end" font-size="28" font-weight="600" fill="#264f43">#経道値</text>
    </g>
  </svg>`;
}

/** Rasterize locally: the SVG contains no remote images, fonts, or foreignObject. */
export async function createShareImage(svg, browserWindow = window) {
  const svgUrl = browserWindow.URL.createObjectURL(new browserWindow.Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new browserWindow.Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('地図画像を読み込めませんでした。'));
      image.src = svgUrl;
    });
    const canvas = browserWindow.document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1200;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('このブラウザーでは画像を生成できません。');
    context.drawImage(image, 0, 0);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('地図画像を保存できませんでした。')), 'image/png'));
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return new browserWindow.File([blob], `keidochi-${date}.png`, { type: 'image/png' });
  } finally {
    browserWindow.URL.revokeObjectURL(svgUrl);
  }
}

export function canShareImage(file, navigator) {
  try { return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }); }
  catch { return false; }
}

export function imageShareData(file, intentUrl) {
  const params = new URL(intentUrl).searchParams;
  const text = [params.get('text'), params.get('hashtags')?.split(',').map(tag => `#${tag}`).join(' '), params.get('url')].filter(Boolean).join('\n');
  return { title: '私の経道値', text, files: [file] };
}
