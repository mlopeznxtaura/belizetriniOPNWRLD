#!/usr/bin/env python3
"""Render a governor timeline JSON (tools/governor-test.js) as an SVG: frame ms (avg) vs budget, and
the ladder level, with the load phases shaded. Usage: timeline-svg.py timeline.json out.svg"""
import sys, json
d = json.load(open(sys.argv[1]))
s, sm = d['samples'], d['summary']
W, H, PAD = 900, 380, 46
tmax = max(x['t'] for x in s) or 1
mmax = max(min(max(x['avgMs'] for x in s), 400), 60)
lmax = max(len(sm['ladder']), 1)
budget = 1000 / float(next((p.split('=')[1] for p in sm['query'].strip('?').split('&') if p.startswith('fps=')), 30))
X = lambda t: PAD + (W - 2 * PAD) * t / tmax
Y1 = lambda ms: PAD + (H / 2 - PAD) * (1 - min(ms, mmax) / mmax)
Y2 = lambda lv: H / 2 + 24 + (H / 2 - PAD - 24) * (lv / lmax)
out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="monospace" font-size="11">',
       f'<rect width="{W}" height="{H}" fill="#0d1424"/>']
ph = sm['phases']; t = 0
cols = {'A': '#16243d', 'B': '#3b2a14', 'C': '#4a1622', 'D': '#13331f'}
names = {'A': 'baseline', 'B': 'fill-bound load', 'C': 'heavy load', 'D': 'no load'}
for k in 'ABCD':
    out.append(f'<rect x="{X(t):.1f}" y="{PAD - 14}" width="{X(t + ph[k]) - X(t):.1f}" height="{H - PAD - 10}" fill="{cols[k]}"/>')
    out.append(f'<text x="{X(t) + 4:.1f}" y="{PAD - 2}" fill="#9fb3d1">{names[k]}</text>')
    t += ph[k]
out.append(f'<line x1="{PAD}" x2="{W - PAD}" y1="{Y1(budget):.1f}" y2="{Y1(budget):.1f}" stroke="#ffd166" stroke-dasharray="4 3"/>')
out.append(f'<text x="{W - PAD - 150}" y="{Y1(budget) - 4:.1f}" fill="#ffd166">budget {budget:.0f} ms</text>')
pts = ' '.join(f'{X(x["t"]):.1f},{Y1(x["avgMs"]):.1f}' for x in s)
out.append(f'<polyline points="{pts}" fill="none" stroke="#4cc9f0" stroke-width="1.6"/>')
out.append(f'<text x="6" y="{PAD + 10}" fill="#4cc9f0">avg ms</text><text x="6" y="{PAD + 22}" fill="#4cc9f0">(max {mmax:.0f})</text>')
pts = ' '.join(f'{X(x["t"]):.1f},{Y2(x["level"]):.1f}' for x in s)
out.append(f'<polyline points="{pts}" fill="none" stroke="#f72585" stroke-width="2"/>')
out.append(f'<text x="6" y="{H / 2 + 34}" fill="#f72585">level</text>')
for i, name in enumerate(['0 preset'] + sm['ladder']):
    out.append(f'<text x="{W - PAD + 4}" y="{Y2(i) + 4:.1f}" fill="#c77dff" font-size="9">{i}</text>')
out.append(f'<text x="{PAD}" y="{H - 8}" fill="#9fb3d1">t (s) 0 … {tmax:.0f}   ladder: {" › ".join(sm["ladder"])}</text>')
out.append('</svg>')
open(sys.argv[2], 'w').write('\n'.join(out))
print('wrote', sys.argv[2])
