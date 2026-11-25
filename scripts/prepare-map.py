"""北海道公式GeoJSONを、外部ライブラリ不要のSVGパスへ変換。"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
names = {r['name']: r for r in json.loads((ROOT / 'data/municipality-names.json').read_text())}
points = {r['市町村名']: r for r in csv.DictReader((ROOT / 'data/hokkaido-points.csv').open(encoding='utf-8-sig'))}
geo = json.loads((ROOT / 'data/hokkaido-source.geojson').read_text())

def project(p):
    return [round(430 + (p[0] - 142.6) * 91, 2), round(280 - (p[1] - 43.5) * 125, 2)]

rows = []
for f in geo['features']:
    prop = f['properties']
    name = prop['市町村名']
    if name not in names:
        continue
    polygons = f['geometry']['coordinates']
    if f['geometry']['type'] == 'Polygon':
        polygons = [polygons]
    path = ''
    for polygon in polygons:
        for ring in polygon:
            coords = [project(p) for p in ring]
            path += 'M' + 'L'.join(f'{x},{y}' for x, y in coords) + 'Z'
    point = points[name]
    rows.append({**names[name], 'id': '01100' if name == '札幌市' else str(prop['コード']).zfill(5),
                 'bureau': prop['振興局'], 'path': path,
                 'point': project([float(point['xcoord']), float(point['ycoord'])])})

rows.sort(key=lambda r: r['reading'])
assert len(rows) == 179
assert len({r['id'] for r in rows}) == 179
(ROOT / 'src/municipalities.js').write_text('// 北海道オープンデータ (CC BY)。生成: python3 scripts/prepare-map.py\nexport const municipalities = ' + json.dumps(rows, ensure_ascii=False, separators=(',', ':')) + ';\n')
print('Generated 179 municipalities.')
