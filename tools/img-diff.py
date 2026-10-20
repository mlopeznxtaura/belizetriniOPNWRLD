#!/usr/bin/env python3
"""Pixel comparison of two screenshots: % of pixels differing by > threshold (max channel), mean abs
diff, and a mean-colour / luma comparison. Optional heat-map output.
Usage: img-diff.py A.png B.png [--thr 8] [--map out.png]"""
import sys, json
import numpy as np
from PIL import Image

args = sys.argv[1:]
thr = int(args[args.index('--thr') + 1]) if '--thr' in args else 8
out = args[args.index('--map') + 1] if '--map' in args else None
a = np.asarray(Image.open(args[0]).convert('RGB')).astype(np.int16)
b = np.asarray(Image.open(args[1]).convert('RGB')).astype(np.int16)
if a.shape != b.shape:
    h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    a, b = a[:h, :w], b[:h, :w]
d = np.abs(a - b).max(axis=2)
luma = lambda x: (0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]).mean()
res = {
    'a': args[0].split('/')[-1], 'b': args[1].split('/')[-1],
    'pct_over_thr': round(float((d > thr).mean() * 100), 3), 'thr': thr,
    'mean_abs': round(float(np.abs(a - b).mean()), 3),
    'mean_rgb_a': [round(float(v), 1) for v in a.reshape(-1, 3).mean(0)],
    'mean_rgb_b': [round(float(v), 1) for v in b.reshape(-1, 3).mean(0)],
    'luma_a': round(float(luma(a)), 2), 'luma_b': round(float(luma(b)), 2),
}
if out:
    m = np.clip(d * 4, 0, 255).astype(np.uint8)
    Image.fromarray(m).save(out)
print(json.dumps(res))
