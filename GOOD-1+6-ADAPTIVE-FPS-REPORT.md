# good-1+6: Adaptive frame-rate governor (dynamic resolution, then quality)

- **Goal:** a dynamic resolution/quality governor. It measures rolling frame time against a target (60 desktop; 30 or 60 mobile, configurable). It steps pixelRatio down/up within preset bounds with hysteresis, then drops outline distance / clouds / foam, then the preset tier, and never thrashes. State shows in a `?debug=1` overlay and in `/api/status`.
- **Base:** `6d8369a` (good-1+5)
- **Deployed:** no

## What changed
### `public/js/governor.js` (new): `FpsGovernor`
**Target**
- 60 fps on desktop, **30 fps on touch/iOS** by default.
- Override with `?fps=30|60|…` or `localStorage['bto.fps']` (`setTarget(fps, save)`).
- `?gov=0` turns it off.

**Measurement**
- The real, *unclamped* frame interval from the game loop.
- Rolling window of about 1 s of frames, at least 20 samples. A single hitch is capped at 250 ms.

**Ladder (cumulative, cheapest-looking cut first)**
1. pixel ratio −0.25 per step, from `min(DPR, preset cap)` down to the preset floor: low 0.6, medium 0.75, high 1, ultra 1
2. outline fade distance ×0.6
3. clouds ×0.5
4. water foam detail → 0
5. each lower preset tier, down to low. Pixel-ratio and outline cuts stay applied, and the tier's own cap/floor is respected.

Level 0 is always exactly the chosen preset. The governor never saves anything.

**Hysteresis / anti-thrash**
- Step **down** after the window average has been above **1.2× budget** for **1.0 s**.
- Step **up** only after it has been below **0.72× budget** for **5 s**, or 8 s for a tier step.
- Every step is followed by a **1.5 s cooldown**.
- If a step up is undone within 8 s, the up-delay **doubles** (up to 60 s).
- Between 0.72× and 1.2× it holds.
- The full history goes to `governor.timeline`.

**Interaction with the pause menu:** picking a preset re-bases the governor (`rebase()`, back to level 0 of the new preset).

**Debug overlay (`?debug=1`):** shows fps, average ms, target, `gov L/max`, base→current tier, pixel ratio, outline/cloud/foam knobs, last action, draw calls/triangles, shading path and blob count. It sits bottom-left, above the touch stick.

### `/api/status`
- `drive.js` adds `perf: governor.state()` to every 1 s state sync.
- `server.js` and `cf-worker/worker.js` store it as `gameState.perf`, so `GET /api/status` returns it.

## Verification (`docs/fidelity/good-1+6/`)
**Setup.** `tools/governor-test.js` runs `?quality=medium&fps=10&debug=1`, 480×270 CSS @ DPR 2 (buffer 600×338 at pr 1.25). The software rasteriser is far slower than any phone, so the target is 10 fps (budget 100 ms) to keep the baseline under budget.

**Load** is injected *inside rAF* as a busy-loop after every `renderer.render`:
- **B, fill-bound:** busy 120 ms × (buffer px / 600×338), so pixel-ratio cuts really do help
- **C, heavy:** a constant 220 ms (CPU-bound; nothing helps, so it must walk the whole ladder)
- **D:** no load, so it must recover

The timeline is sampled every 250 ms: `timeline_{chromium,webkit}.json`, and charted in `timeline_*.png`/`.svg` (made with `tools/timeline-svg.py`).

| | Chromium | WebKit |
|---|---|---|
| A baseline (no load) | L0, 61 ms (16 fps), buffer 600×337 | L0, 62 ms |
| first step down after load starts at t=10 s | **t=14.3 s** (4.3 s: window fill + 1 s hold) | t=12.8 s |
| B fill-bound load: where it settles | **L1 (pr 1.0), 90.5 ms**: 1 step, then held for 30 s | L5 (pr 0.75, outlines, clouds, foam), 97 ms |
| steps up during B / direction reversals within 8 s (whole run) | **0 / 0** | **0 / 0** |
| C heavy load | walked L2→L6 in 1.6 s steps (pr 0.75 → outlines → clouds → foam → **tier medium→low**), 228 ms | same, L6, 250 ms |
| D recovery | one step every ~5 s, tier step first; **back to L0 (medium, pr 1.25) at t=113 s** (25 s after load removed), 50 ms | back to L0 at t=110 s, 59 ms |
| page errors | 0 | 0 |

- **Chart:** `timeline_chromium.png`, also copied to `/workspace/work/app13-good1-6.png`. It shows the average ms against the budget line with the level trace and the phases shaded.
- **Screenshots:** `{chromium,webkit}_under_fill_load.png`, `_under_heavy_load.png`, `_recovered.png`. The overlay is visible in them.
- **`api_status.json`** comes from `tools/api-perf-check.js`, which boots `server.js`, plays, and reads `GET /api/status`:

  `"perf":{"enabled":true,"targetFps":60,"avgMs":46.5,"fps":21.5,"level":5,"maxLevel":5,"base":"low","tier":"low","pixelRatio":0.6,"outlineDist":0.3,"clouds":4,"foam":0,"lastAction":"down:foam",…}`

- **`iphone_debug_overlay.png`:** iPhone emulation with `?debug=1`. Auto target is **30 fps**. On SwiftShader it walked to L5 (low, pr 0.6). 0 page errors.
- **Smoke test** (female, auto): 0 errors; walk 2.6, drove 17.7, exited. Sprint reads 0: the known low-preset market-wall collider, same as good-1+3 and good-1+5.

## Known limits
- **Tuned on a software rasteriser, with a 10 fps target for the test.** The thresholds are ratios of the budget, so they carry over to 30/60 fps, but the hold times have not been tried on a real iPhone (thermal throttling, 120 Hz ProMotion).
- **A tier drop re-applies that preset live.** Far plane, point lights, clouds and outline budget change; anti-aliasing and the shading path stay fixed (as in good-1+3/1+5). A tier change can cause one small hitch, because point-light visibility changes, but the light count stays constant, so there are no shader recompiles.
- **There is no on-screen fps-target selector yet.** It is URL/localStorage only.
- **On a slow device the governor sits at the bottom of the ladder** and the image gets soft (pr 0.6 on low). That is the intended trade, but worth a look on hardware.
