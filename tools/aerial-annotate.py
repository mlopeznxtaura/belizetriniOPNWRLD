#!/usr/bin/env python3
"""Mirror the orthographic aerial render (chunk-test.js aerial) to north-up / east-right and label it.
Usage: python3 tools/aerial-annotate.py aerial_belize.png aerial_belize.json out.png [--chunk 160]"""
import json, sys, math
from PIL import Image, ImageDraw, ImageFont, ImageOps

src, meta, dst = sys.argv[1:4]
C = 160
M = json.load(open(meta))
img = ImageOps.mirror(Image.open(src).convert('RGB'))
W, H = img.size
v = M['view']; cx, cz, s = v['cx'], v['cz'], v['s']
d = ImageDraw.Draw(img)
try:
    F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', max(14, W // 90))
    Fs = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', max(10, W // 150))
except Exception:
    F = Fs = ImageFont.load_default()
P = lambda x, z: ((x - (cx - s)) / (2 * s) * W, ((cz + s) - z) / (2 * s) * H)
x0, x1, z0, z1 = cx - s, cx + s, cz - s, cz + s
for i in range(math.floor(x0 / C), math.floor(x1 / C) + 1):
    a = P(i * C, z1); b = P(i * C, z0); d.line([a, b], fill=(255, 255, 255), width=1)
for j in range(math.floor(z0 / C), math.floor(z1 / C) + 1):
    a = P(x0, j * C); b = P(x1, j * C); d.line([a, b], fill=(255, 255, 255), width=1)
for i in range(math.floor(x0 / C), math.floor(x1 / C) + 1):
    for j in range(math.floor(z0 / C), math.floor(z1 / C) + 1):
        px, py = P(i * C + 3, (j + 1) * C - 3)
        if 0 <= px < W and 0 <= py < H: d.text((px, py), f'{i},{j}', font=Fs, fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))
for dist in M['districts']:
    r = dist['rect']; px, py = P((r['minX'] + r['maxX']) / 2, r['maxZ'] - 6)
    t = dist['label']; tw = d.textlength(t, font=F)
    d.rectangle([px - tw / 2 - 5, py - 2, px + tw / 2 + 5, py + F.size + 4], fill=(20, 30, 50))
    d.text((px - tw / 2, py), t, font=F, fill=(255, 240, 200))
d.rectangle([0, 0, W, F.size + 16], fill=(20, 30, 50))
d.text((10, 6), f"Aerial (orthographic, noon, all {M['loaded']} chunks loaded) north up / east right, 160 m chunk grid", font=F, fill=(255, 255, 255))
img.save(dst)
print('wrote', dst, img.size)
