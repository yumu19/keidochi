import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { municipalities } from '../src/municipalities.js';
import { LEVELS } from '../src/model.js';

// A fixed illustration for link previews, independent of anyone's saved records.
const root = fileURLToPath(new URL('../', import.meta.url));
const shapes = municipalities.map((city, index) => {
  const illustrationLevel = index % 9 === 0 ? 5 : index % 7 === 0 ? 4 : index % 5 === 0 ? 3 : index % 4 === 0 ? 2 : index % 3 === 0 ? 1 : 0;
  return `<path d="${city.path}" fill="${LEVELS[illustrationLevel].color}" stroke="#fff" stroke-width="1.4" stroke-linejoin="round" fill-rule="evenodd"/>`;
}).join('');
const legend = LEVELS.map((level, index) => {
  const x = 74 + index % 3 * 143;
  const y = 378 + Math.floor(index / 3) * 47;
  return `<g transform="translate(${x},${y})"><rect width="18" height="18" rx="4" fill="${level.color}"/><text x="28" y="18" font-size="23" fill="#304f43">${level.label}</text></g>`;
}).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f6f7f1"/>
  <rect x="0" y="0" width="1200" height="12" fill="#264f43"/>
  <ellipse cx="888" cy="303" rx="271" ry="266" fill="#e8f0ec"/>
  <g font-family="Hiragino Kaku Gothic ProN, Yu Gothic, Meiryo, sans-serif">
    <text x="72" y="112" font-size="22" font-weight="600" letter-spacing="3" fill="#617c64">北海道 179 市町村</text>
    <text x="66" y="247" font-size="112" font-weight="700" letter-spacing="9" fill="#264f43">経道値</text>
    <text x="76" y="289" font-size="24" font-weight="600" letter-spacing="6" fill="#577b65">KEIDOCHI</text>
    <text x="72" y="345" font-size="29" font-weight="500" fill="#304f43">旅の経験を、地図に記録。</text>
    ${legend}
    <text x="72" y="519" font-size="23" fill="#617463">登録不要 · ブラウザーに保存</text>
    <text x="72" y="568" font-size="19" fill="#6b8077">yumu19.github.io/keidochi/</text>
    <svg x="601" y="61" width="548" height="490" viewBox="105 5 650 570">${shapes}</svg>
    <text x="1128" y="594" text-anchor="end" font-size="16" fill="#698074">地図データ：北海道オープンデータ（CC BY）を加工</text>
  </g>
</svg>`;

await mkdir(`${root}assets`, { recursive: true });
await writeFile(`${root}assets/og-image.svg`, svg);
const fontFiles = process.env.OG_FONT_FILE ? [process.env.OG_FONT_FILE] : [];
const rendered = new Resvg(svg, { font: { loadSystemFonts: true, fontFiles } }).render();
await writeFile(`${root}assets/og-image.png`, rendered.asPng());
console.log(`Generated assets/og-image.png (${rendered.width} × ${rendered.height}).`);
