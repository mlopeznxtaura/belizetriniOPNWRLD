# good-1+5: Cheap Lambert shading + blob shadows on mobile (no live shadow maps)

- **Goal:** on low/medium (and on any touch/iOS device by default), swap the toon shading for a cheap Lambert-based path that keeps the Wind Waker look; no live shadow maps on mobile; blob/contact shadows under characters and vehicles instead.
- **Base:** `e0bef20` (good-1+4)
- **Deployed:** no

## What changed
### `public/js/toon.js`: the Lambert banded path
- `SHADE.lambert` is set once before anything is built (`setShadingPath`). When it is on, `toonMaterial()` (and so `convertMaterial()`/`toonify()`) builds a **`MeshLambertMaterial`** instead of a `MeshToonMaterial`.
- The ramp banding is done in `onBeforeCompile`. In the Lambert direct-light term, `saturate(N·L)` becomes two compares:

  `irradiance = (N·L < t1 ? shadow : (N·L < t2 ? mid : 1)) * lightColor`

  This means no gradient-texture fetch per light. The thresholds reproduce the NearestFilter ramp lookup exactly:
  - world, 5 texels `s s m l l`: t1 = −0.2, t2 = 0.2
  - skin, 6 texels `s m m m l l`: t1 = −⅔, t2 = ⅓
- The levels follow the sky like `setRamp()` does, quantised to the same 8-bit steps (`BAND.world` / `BAND.skin`, updated in `applyToonSkyState`).
- The rim light is kept on characters and vehicles. One program per ramp/rim combination, the same as the toon path.
- **Precision stays highp, on purpose.** I first tried `material.precision = 'mediump'`. That turned up a **three r170 bug**: `WebGLPrograms` keeps the precision in a closure variable, so every program compiled *after* such a material went mediump too. That included the water, the outlines and the sky's sun rings. On top of that, fp16 overflows |vViewPosition|² beyond about 250 m (NaN lighting on a real iPhone). I removed it and documented why in the code.

### `public/js/quality.js`: choosing the path, and no shadows on mobile
- Presets gain two knobs:
  - `lambert`: low/medium on, high/ultra off
  - `blobShadows`: low/medium on
- `resolveShading()` picks the path, in this order:
  1. `?shade=toon|lambert` override
  2. **touch or iOS device → Lambert, whatever the preset**, including a saved Ultra
  3. otherwise the preset's knob
- Blob shadows can be overridden with `?blobs=0|1`.
- `liveShadows = preset.shadows && !lambert`, so the Lambert/mobile path never turns on `renderer.shadowMap`. `stripShadowFlags()` clears `castShadow`/`receiveShadow` on every mesh at boot, and the 0.5 s tick does the same for characters and vehicles that load later.
- The shading path is fixed for the life of the page, because materials are built with it. On desktop, switching between a Lambert preset and a toon preset in the pause menu says "shading after reload", the same way anti-aliasing already does.

### `public/js/blobshadow.js` (new): contact shadows
- **One `InstancedMesh`** (one draw call, a tiny shader, no texture) holds up to 64 flat decals, re-placed every frame.
- Look: a solid core plus one lighter ring (cel steps, no blur), in a cool dark tint.
- Shapes:
  - round under people
  - oriented ellipses under vehicles, with a footprint per type
  - helis and planes shrink and fade with altitude, gone by about 40 m
- They sit on the causeway deck where needed (`groundAt`).
- `main.js` feeds the casters every frame from pooled records (no per-frame allocation): the player on foot, all vehicles, cops, and mission NPCs. A `missions.npcs()` helper was added for the NPCs.

## Verification (`docs/fidelity/good-1+5/`)
All runs use iPhone emulation (390×844 @3, touch, iOS 18 UA), Queen St at noon, a sedan parked in view, seeded `Math.random`, frozen water/cloud time.

The tool is `tools/shade-capture.js`: screenshots plus programs, calls, shadow state and the median of 15 GPU-synced frames. The raw data is in `shade_chromium.json` and `shade_webkit.json`. Pixel diffs come from `tools/img-diff.py` (the % of pixels whose max channel differs by more than 8/255).

### Look
| comparison | Chromium | WebKit |
|---|---|---|
| medium **Lambert** vs medium **toon** (blobs off): same look? | **0.059 %** px differ, mean luma 132.8 = 132.8 | **0.040 %** |
| low Lambert vs low toon (blobs off) | 0.36 % (outline/AA edge pixels) | – |
| medium Lambert + blobs vs medium toon | 1.87 % (the blob decals) | 1.52 % |
| medium Lambert + blobs vs **high toon** (reference) | 10.9 % (pixel ratio, clouds, foam, outline distance from the preset, plus blobs); mean RGB within 1/255 | 10.9 % |
| good-1+4 medium (base tree) vs this tree with `?shade=toon&blobs=0` | 0.65 % (character idle phase) | – |

- Side by side: `compare_iphone.png`, also copied to `/workspace/work/app13-good1-5.png`. It shows high toon, medium Lambert + blobs, low Lambert + blobs, and WebKit medium Lambert.
- I looked at the shots. Bands, outlines, sky and colours match. The new difference is the round two-step contact shadow under the character and the oval one under the car.

### Programs, shadows, draw calls (Chromium, iPhone)
| config | programs | draw calls | shadowMap | cast/receive meshes | Lambert/toon meshes |
|---|---|---|---|---|---|
| medium toon | 13 | 115 | off | 0/0 | 0 / 296 |
| medium Lambert, no blobs | **13** | 115 | off | 0/0 | 296 / 0 |
| medium Lambert + blobs | 14 (+1 blob program) | **116 (+1)** | off | 0/0 | 296 / 0 |
| low Lambert + blobs | 13 | 112 | off | 0/0 | 296 / 0 |
| **`?quality=ultra` on iPhone** | 14 | 123 | **off** (desktop ultra: on) | 0/0 | 296 / 0 |

### Frame ms, median of 15 GPU-synced renders (SwiftShader/WebKit software GL)
| preset (iPhone) | good-1+4 base tree | toon (`?shade=toon&blobs=0`) | **Lambert + blobs** | change |
|---|---|---|---|---|
| medium, Chromium | 103.6 | 103.6 / 103.2 (2 runs) | **78.0 / 78.9** | **−24 %** |
| low, Chromium | 61.2 | 61.6 / 61.6 | **52.2 / 53.2** | **−14 %** |
| medium, WebKit | – | 43 | 42 (no blobs: 42) | about 0 |
| low, WebKit | – | 26 | 26 | 0 |

- On SwiftShader the per-light gradient texture fetch is expensive, and the Lambert compares remove it. WebKit's software GL shows no change.
- **Neither is a real Apple GPU.** Read these as "the Lambert path is no slower anywhere, and faster where texture fetch costs", not as iPhone fps.
- The blob decals cost about 0 ms here: 1 call, small, alpha-blended.

### Regression
- **Desktop parity** (non-touch, so toon is kept): `?quality=high` and `?quality=ultra` match good-1+4 call for call:
  - high: 166 / 87 calls
  - ultra with shadows **on**: 335 / 203 calls, triangles identical
  - frame ms within 0.5 %
  - ultra pixels: queen 0.147 %, shore 0.254 % differ (character idle phase)
  - Files: `regress/tree_parity.log`, `regress/*_noon.png`.
- **Smoke tests:**
  - male (auto, low): 0 errors; walk 2.6, drove 12.2, exited OK. Sprint reads 0: this is the known good-1+3 market-wall collider at z ≈ −5.6, unchanged.
  - female `?quality=high`: 0 errors; walk 2.51, sprint 8.87, drove 5.1, exited OK.
- **`gfx-robust-test`, iPhone + context loss:**
  - Chromium: 0 uncaught, 0 console errors, 0 shader warnings; stick moves 8.97 m/s; 2× loss/restore keeps the same calls and programs.
  - WebKit: 0 uncaught; restore OK, 13 programs.
- **0 page errors in every capture.**

## Known limits
- **No real-iPhone or GPU numbers.** The speed-up is measured on software rasterisers only, and WebKit's shows none.
- **The Lambert path is still per-fragment lighting** (three r170 has no per-vertex Lambert). The saving is the gradient texture fetch per light, plus no shadow-map code. mediump was rejected (see above).
- **The shading path cannot change live.** A desktop user who moves between Medium and High needs a reload to swap materials (the toast says so).
- **Blob shadows assume flat ground** (the world is flat apart from the causeway deck). They do not climb props or kerbs, and they ignore the sun direction (always directly below).
- **Cops parked far away still use a blob slot** (25 casters here). That is harmless (64 max, one draw call).
