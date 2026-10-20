#!/usr/bin/env python3
"""Schematic overview map of the streamed world (north up, east right).
Usage: node tools/world-map.mjs all > /tmp/layout.json && python3 tools/world-map.py /tmp/layout.json out.png [--px 1.4]
Draws: sea, core (hand-built, resident), district land, channels, roads, bridges, docks, buildings,
reef, 160 m chunk grid with chunk ids, district labels, scale bar, compass."""
import json, sys
from PIL import Image, ImageDraw, ImageFont

src, dst = sys.argv[1], sys.argv[2]
PX = float(sys.argv[sys.argv.index('--px') + 1]) if '--px' in sys.argv else 1.2
L = json.load(open(src))
b = L['bounds']
pad = 40
W = int((b['maxX'] - b['minX']) * PX) + 2 * pad
H = int((b['maxZ'] - b['minZ']) * PX) + 2 * pad + 60
img = Image.new('RGB', (W, H), (38, 120, 168))
d = ImageDraw.Draw(img)
try:
    F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15)
    Fs = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 10)
    Fb = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)
except Exception:
    F = Fs = Fb = ImageFont.load_default()

def P(x, z):  # north (+z) up, east (+x) right
    return (pad + (x - b['minX']) * PX, pad + 60 + (b['maxZ'] - z) * PX)

def rect(r, fill, outline=None, w=1):
    x0, y0 = P(r['minX'], r['maxZ']); x1, y1 = P(r['maxX'], r['minZ'])
    d.rectangle([x0, y0, x1, y1], fill=fill, outline=outline, width=w)

hexrgb = lambda h: ((h >> 16) & 255, (h >> 8) & 255, h & 255)
# shallow water halo around land / reef
for r in L['land'] + L['core'] + L['reefs']:
    rr = dict(r); g = 10
    rr.update(minX=r['minX'] - g, maxX=r['maxX'] + g, minZ=r['minZ'] - g, maxZ=r['maxZ'] + g)
    rect(rr, (72, 182, 205))
for r in L['reefs']:
    rect(r, (240, 250, 255))
for r in L['core']:
    rect(r, (150, 170, 130), (90, 110, 80))
for r in L['land']:
    g = r.get('ground')
    rect(r, (236, 220, 158) if g == 'sand' else (98, 176, 74) if g != 'park' else (109, 186, 82))
for c in L['channels']:
    rect(c, (72, 182, 205))
for rd in L['roads']:
    hw = rd['w'] / 2
    r = {'minX': min(rd['x1'], rd['x2']) - (0 if rd['z1'] == rd['z2'] else hw), 'maxX': max(rd['x1'], rd['x2']) + (0 if rd['z1'] == rd['z2'] else hw),
         'minZ': min(rd['z1'], rd['z2']) - (hw if rd['z1'] == rd['z2'] else 0), 'maxZ': max(rd['z1'], rd['z2']) + (hw if rd['z1'] == rd['z2'] else 0)}
    rect(r, (226, 206, 150) if rd.get('surface') == 'sand' else (76, 82, 96))
for br in L['bridges']:
    r = br['rect']
    rect(r, (79, 143, 122) if br['kind'] == 'swing' else (110, 110, 120), (30, 30, 30))
for dk in L['docks']:
    rect({'minX': dk['x'] - dk['w'] / 2, 'maxX': dk['x'] + dk['w'] / 2, 'minZ': dk['z'] - dk['d'] / 2, 'maxZ': dk['z'] + dk['d'] / 2}, (214, 176, 122), (90, 60, 30))
for bd in L['buildings']:
    rect(bd['fp'], hexrgb(bd['color']), (40, 40, 50))
for (x, z) in L['boats']:
    px, py = P(x, z); d.ellipse([px - 1.5, py - 1.5, px + 1.5, py + 1.5], fill=(255, 255, 255))
# chunk grid
C = L['chunk']
import math
i0, i1 = math.floor(b['minX'] / C), math.floor(b['maxX'] / C)
j0, j1 = math.floor(b['minZ'] / C), math.floor(b['maxZ'] / C)
for i in range(i0, i1 + 2):
    x0, y0 = P(i * C, b['maxZ']); x1, y1 = P(i * C, b['minZ'])
    d.line([x0, y0, x1, y1], fill=(255, 255, 255), width=1)
for j in range(j0, j1 + 2):
    x0, y0 = P(b['minX'], j * C); x1, y1 = P(b['maxX'], j * C)
    d.line([x0, y0, x1, y1], fill=(255, 255, 255), width=1)
for i in range(i0, i1 + 1):
    for j in range(j0, j1 + 1):
        x, y = P(i * C + 3, (j + 1) * C - 3)
        d.text((x, y), f'{i},{j}', font=Fs, fill=(255, 255, 255))
# labels
for dist in L['districts']:
    r = dist['rect']; x, y = P((r['minX'] + r['maxX']) / 2, r['maxZ'])
    t = dist['label']; tw = d.textlength(t, font=F)
    d.rectangle([x - tw / 2 - 4, y - 22, x + tw / 2 + 4, y - 3], fill=(20, 30, 50))
    d.text((x - tw / 2, y - 21), t, font=F, fill=(255, 240, 200))
for r, t in [(L['core'][0], 'Belize City core (hand-built)'), (L['core'][1], 'Port of Spain core')]:
    x, y = P((r['minX'] + r['maxX']) / 2, (r['minZ'] + r['maxZ']) / 2); tw = d.textlength(t, font=F)
    d.rectangle([x - tw / 2 - 4, y - 10, x + tw / 2 + 4, y + 10], fill=(20, 30, 50)); d.text((x - tw / 2, y - 9), t, font=F, fill=(255, 255, 255))
for bd in L['buildings']:
    if bd['name']:
        r = bd['fp']; x, y = P(r['maxX'], r['maxZ'])
        d.text((x + 3, y - 12), bd['name'], font=Fs, fill=(255, 255, 255), stroke_width=2, stroke_fill=(20, 30, 50))
for c in L['channels']:
    if c.get('label'):
        x, y = P(c['minX'] + 70 if c['maxX'] - c['minX'] > 100 else c['maxX'] + 4, (c['minZ'] + c['maxZ']) / 2 if c['maxX'] - c['minX'] > 100 else c['minZ'] + 60)
        d.text((x, y - 6), c['label'], font=Fs, fill=(255, 255, 255), stroke_width=2, stroke_fill=(20, 60, 90))
# title, scale bar, compass
d.rectangle([0, 0, W, 50], fill=(20, 30, 50))
d.text((14, 12), 'belizetriniOPNWRLD streamed world: overview (north up, 160 m chunks)', font=Fb, fill=(255, 255, 255))
sx, sy = P(b['minX'] + 20, b['minZ'] + 20)
d.rectangle([sx, sy - 6, sx + 100 * PX, sy], fill=(255, 255, 255)); d.text((sx, sy - 22), '100 m', font=Fs, fill=(255, 255, 255))
cx, cy = W - 50, 95
d.polygon([(cx, cy - 22), (cx - 9, cy + 6), (cx + 9, cy + 6)], fill=(255, 255, 255)); d.text((cx - 5, cy + 8), 'N', font=F, fill=(255, 255, 255))
img.save(dst)
print('wrote', dst, img.size, 'buildings', len(L['buildings']), 'props', L['props'])
