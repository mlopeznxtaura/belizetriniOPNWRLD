# good-1+3: Device quality presets (low / medium / high / ultra)

- Base: `0077fb1` (good-1+2)
- Not deployed.

## What changed
### `public/js/quality.js` (new)
**`PRESETS`**

| knob | low | medium | high (= good-1+1/1+2 look) | ultra |
|---|---|---|---|---|
| pixelRatio cap | 1 | 1.25 | 1.5 | 2 |
| antialias | off | off | on | on |
| shadows (sun, PCF, follows player ±70 m) | off | off | off | on, 2048² |
| outlines | characters+vehicles only | all | all | all |
| outline fade distance | ×0.5 | ×0.75 | ×1 | ×1.3 |
| clouds | 8 | 16 | 26 | 40 |
| water foam detail / tessellation | rim only / ¼ | rim+bands / ½ | full / 1 | full / 1 |
| draw distance (camera far) + fog | 220 m (fog ×2.05) | 320 m (×1.41) | 450 m (×1) | 600 m (×0.75) |
| max point lights (nearest-N to camera) | 2 | 4 | 8 | 8 |
| character / vehicle outline parts | 6 / 2 | 10 / 3 | 18 / 5 | 24 / 8 |

**`detectQuality()`** looks at:
- iOS / iPadOS / Android / touch
- `deviceMemory` and `hardwareConcurrency`
- screen size and DPR
- the GPU string from `WEBGL_debug_renderer_info`, read on a throwaway WebGL1 context that is released at once with `WEBGL_lose_context`, because iOS caps live contexts

Rules:

| device | preset |
|---|---|
| Software renderer | low |
| iPhone ≤ 375 pt wide (SE / mini) or iOS < 16 | low |
| Other iPhones | medium |
| iPad | medium |
| Android / touch | low if ≤ 4 GB, ≤ 4 cores or Adreno ≤ 5xx / Mali; else medium |
| Discrete desktop GPU (incl. Apple M / "Apple GPU" on Mac) | high |
| Integrated GPU | medium |

Auto never picks ultra.

**`resolveQuality()`** picks the preset in this order:
1. `?quality=` (one-off, not saved)
2. `localStorage['bto.quality']`
3. auto

**`QualityController`** applies a preset **live**:
- pixel ratio
- far plane plus fog plus sky scale. The sky dome and clouds shrink with the far plane so they stay inside it.
- outline mode and distance
- cloud count
- foam define
- shadows on/off. This recompiles the materials. Characters and vehicles loaded later are kept casting.
- the nearest-N point lights, re-picked every 0.5 s. The visible count stays constant, so no shader recompiles.

Two settings are fixed when the context or character is created: anti-aliasing and the character outline part budget. The selector says they apply "after reload".

### Pause-menu selector
- `index.html`, `style.css`, `main.js` (`_bindQualityMenu`): "Graphics quality", with buttons Auto (detected preset) / Low / Medium / High / Ultra. The choice is saved, and Auto clears it.
- A **Resume** button was added.
- An **II** pause button was added to the mobile controls, because touch devices had no way to open the pause menu.

### `toon.js`
- `TOON_Q` holds the outline mode and distance, clouds, foam and `freezeTime`. `setToonQuality()` applies it live.
- Batched static hulls are tracked so the outline mode can hide them.
- The cloud InstancedMesh now holds 40. The first 26 have the exact good-1+1 layout, stored in stride-7 slots so any prefix (low = 8) is spread around the horizon. `count` sets the number drawn.
- The water shader has `FOAM_DETAIL` 0/1/2.

### `world.js`
- `buildWorld(scene, preset)` scales the water tessellation.
- `dayNight.setDrawDistance(far)` sets the fog multiplier and sky scale.
- The sun direction is recorded for the shadow follow.
- `realLights` is exposed.

### `main.js`
- The preset is resolved before the renderer exists, so the AA attempt is skipped for low/medium.
- Exposes `game.quality` and `game.toon.{Q,U}`.

### Tools
- **`tools/quality-capture.js`** (new):
  - per-preset metrics and screenshots, with seeded `Math.random`, frozen water/cloud time and `info.autoReset=false`, so shadow-pass draw calls are counted
  - a `tree` mode for comparing two builds (used again in good-1+4)
  - `detect` mode, which runs auto-detect under emulated devices with spoofed GPU strings
- **`tools/quality-menu-test.js`** (new): exercises the pause-menu selector.
- **`game-smoke.js`** takes `SMOKE_QUERY`.
- **`gfx-robust-test.js`** takes `GFX_QUERY` / `GFX_OUT`.

## Verification (`docs/fidelity/good-1+3/`)
### Per-preset numbers
Queen St, noon, 960×540 CSS at **DPR 2** (so the pixel-ratio cap shows), SwiftShader. Calls include the shadow pass.

| preset | buffer | draw calls | triangles | frame ms (median of 15, GPU-synced) | point lights on |
|---|---|---|---|---|---|
| low | 960×540 | **402** | **48,388** | **81** | 2 |
| medium | 1200×675 | 420 | 63,708 | 145 (199 on a noisy run) | 4 |
| high | 1440×810 | 434 | 68,546 | 321–326 (DPR 2) | 8 |
| ultra | 1920×1080 | 869 (≈435 shadow + 434 main) | 88,378 | 810 | 8 |

- Screenshots: `{low,medium,high,ultra}_queen_noon.png`, `metrics.json`.
- Frame times are CPU-raster (SwiftShader, 2 cores), so they mostly measure fill. A real GPU is much faster. The *ratios* are what to read: low costs about ¼ of high.
- Draw calls barely move between presets, because about 300 of them are the unbatched window/frame meshes. That is goal good-1+4.

### Parity
`high` reproduces good-1+2. Both trees ran with the same seeded/frozen harness at DPR 1:
- queen_noon: 434 / 68,546 in both, and **0.009 %** of pixels differ by more than 8/255
- shore_noon: 229 / 65,224 in both, and **0.006 %** of pixels differ

The files are `base12_*` and `parity_high_*`.

### Auto-detect (`detect.json`)

| device | detected preset |
|---|---|
| iPhone 15 (393 pt, iOS 18) | **medium** |
| iPhone 13/14 (390 pt, iOS 17) | **medium** |
| iPhone SE (375 pt) | **low** |
| iPad | medium |
| Android with Adreno 610 | low |
| Desktop RTX 3060 | high |
| Intel UHD 620 laptop | medium |
| Headless SwiftShader | low |

### Pause menu (`menu_test.json`, `menu_desktop.png`, `menu_iphone.png`)
- On desktop, P then Ultra gave:
  - far 600, 40 clouds, 8 lights, `localStorage=ultra`
  - the toast "anti-aliasing & character outlines after reload"
- Choosing Medium, then reloading, kept medium (saved). Auto cleared the saved value.
- iPhone emulation: the II button opens the menu, Low applies, and Resume closes it.
- 0 page errors.

### Regression
- **Smoke tests:**
  - male (auto = low): 0 errors; walked 2.6 and drove 11.0. Sprint ended at 0.1 m/s because the faster low preset lets the character reach the market-row wall collider at z ≈ −5.6 within the 2 s sprint window.
  - female with `?quality=high`: 0 errors; walk 2.58, sprint 8.16, drove 4.72, exited.
- **Context loss:**
  - Chromium (auto = low): 2× loss/restore and movement OK, 0 uncaught.
  - **WebKit with `?quality=ultra`** (shadows on): restored 2× with the same calls (434 → 437) and the same pixels, 0 uncaught, 0 shader warnings.
- **iPhone emulation:** renders, stick works, 0 errors.

## Known limits
- **Not measured on a real iPhone or GPU.** The iPhone defaults are a judgement: DPR-3 fill rate and Safari's memory kills are the risk. Use `?quality=` or the menu to override.
- **Some iPhone guesses can't be refined.** Safari does not expose `deviceMemory`, and it masks the GPU as "Apple GPU". So iPhone presets come from screen width and iOS version, not the chip.
- **Anti-aliasing and the character/vehicle outline part budgets apply after a reload.** The user is told so.
- **Ultra shadows have limits:** a single 140 m shadow box around the player, so there are no shadows beyond about 70 m. There is mild PCF banding on walls facing away from the sun. At noon the shadows are short.
- **Draw calls are dominated by the per-window meshes** at every preset, which is the next goal.
