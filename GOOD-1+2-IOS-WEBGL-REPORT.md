# good-1+2: iPhone Safari "WebGL unavailable" fix

**Goal:** the game must not die with "WebGL unavailable" on an iPhone. Renderer creation is now robust, the shaders are safe on iOS, and context loss is handled.

- **Base:** `0b2ffba` (good-1+1)
- **Deployed:** no

## Where the message came from
- `public/js/main.js` wrapped `new THREE.WebGLRenderer({antialias:true, powerPreference:'high-performance'})` in one try/catch.
- On *any* throw it painted "WebGL unavailable".
- The vendored three is **r170** (`public/vendor/three/three.module.js`). Its renderer only calls `canvas.getContext('webgl2', attrs)` and throws when that returns null.
- So a single refused attribute set killed the game with no second attempt. That covers iOS memory pressure, a refused antialias/perf-caveat, and "too many contexts".
- Every other boot error left a dead screen.

## Changes
### `public/js/gfx.js` (new)
- **`createRendererRobust()`** tries 3 WebGL2 attribute sets, each on a **fresh canvas**. A canvas that has handed out a context is locked to it, and three's own error path calls `getContext('webgl2')` a second time on the same canvas. The 3 sets are:
  1. `webgl2-default`: antialias, high-performance, `failIfMajorPerformanceCaveat:false`
  2. `webgl2-relaxed`: no AA, `powerPreference:'default'`
  3. `webgl2-minimal`: no AA, low-power, no stencil
- **Why there is no WebGL1 path:** three r163+ removed WebGL1, and r170 throws `WebGL 1 is not supported since r163` when handed a `WebGLRenderingContext` (three.module.js:28947).
  - A real WebGL1 renderer would mean shipping a second, older three build plus WebGL1 variants of every toon shader. That is out of scope.
  - Instead, when all three WebGL2 tries fail, `diagnoseWebGL()` probes WebGL1 only to explain *why*:
    - WebGL1-only means old iOS (<15) or WebGL2 disabled.
    - No WebGL at all on iOS means Lockdown Mode / Screen Time / memory.
  - `showGfxError()` then shows a clear in-page reason, the attempts tried, any `webglcontextcreationerror` status messages, and a Retry button. The details are also on `window.__GFX_DIAG__`.
- **`watchContext()`** handles context loss and restore:
  - `webglcontextlost` calls `preventDefault()` and pauses the loop (cancels the RAF).
  - It shows the "Graphics paused — restoring…" toast (a standalone toast, so it also shows on the title screen).
  - If no restore arrives after 2.5 s, it asks `WEBGL_lose_context.restoreContext()`. After 12 s it shows the Reload message.
- **`healShaderFailures()`** runs after the first frames, and again whenever a shader error is reported:
  - Any material whose program failed to compile or link (`diagnostics.runnable === false`) is swapped for a MeshLambert/MeshBasic stand-in of the same colour. Failed outline hulls are hidden.
  - A driver quirk now costs one effect instead of a blank frame.
  - `renderer.debug.onShaderError` logs a one-line warning instead of three's multi-KB dump.
- **`safePointerLock()`:** Safari's `requestPointerLock()` returns a Promise that rejects (`WrongDocumentError`), and older engines throw.
  - The WebKit run caught exactly this as an **uncaught error** on START GAME.
  - It is now caught, and touch-only devices skip pointer lock. Used by `main.js` and `player.js`.

### `public/js/main.js`
- Uses `createRendererRobust` and adopts the returned canvas.
- `_startLoop` / `_stopLoop` / `_onContextRestored`. Three's own restore handler (registered first) rebuilds GL state. On top of that, the game:
  - re-sizes
  - re-sets the clear colour
  - marks every material and texture `needsUpdate` (ramps, maps)
  - re-applies day/night
  - resumes the loop
- Boot is wrapped: a non-GL boot error shows "The game failed to start" with the message instead of a dead screen.

### `public/js/toon.js`: GLSL audit for iOS
- **Fixed a real portability bug:** the sky dome used `smoothstep(0.0, -0.12, h)`. Reversed edges are *undefined* in GLSL ES and differ between drivers (Apple/ANGLE-Metal included). It is now `1.0 - smoothstep(-0.12, 0.0, h)`.
- **Sun disk/rings and moon** no longer use cosine thresholds like `0.99955` vs `0.9997`, which are indistinguishable below highp. They now use chord distances `|d − dir|` with the same geometric edges, so they resolve at any precision.
  - Parity vs good-1+1: same calls and tris, and ≤0.45 % of pixels differ by >8/255. That is water and cloud animation time, not the sky.
- **Audit of the rest:**
  - No `#extension` is used anywhere and there are no derivatives.
  - Loops have constant bounds with a uniform `break`; `uniform vec4[8]` is indexed by the loop index.
  - No `RawShaderMaterial`, so three's prefix supplies precision.
  - WebGL2 means GLSL ES 3.00, where highp in fragment shaders is **mandatory**, and three selects highp from `getShaderPrecisionFormat`.
  - The remaining hash/noise math in the water shader therefore has guaranteed highp. All test engines report fragment HIGH_FLOAT precision 23.

### `tools/gfx-robust-test.js` (new)
Runs on Chromium or WebKit (playwright-core). Cases:
- `fallback`: the first 2 `getContext('webgl2')` calls return null.
- `nowebgl2`: `getContext('webgl2')` always returns null.
- `ctxloss`: loss/restore ×2 via `WEBGL_lose_context`, then movement.
- `iphone`: 390×844, DPR 3, touch, iOS 18.5 Safari UA, virtual stick.
- `shaderfail`: the water fragment shader is made to fail compiling.

## Verification (`docs/fidelity/good-1+2/`)
Uncaught = `pageerror`. The only console error in the fallback cases is three's own expected `Error creating WebGL context.` log for the refused attempt.

| engine | case | result | calls / tris | uncaught |
|---|---|---|---|---|
| Chromium 130 (SwiftShader) | fallback | `webgl2-default:fail → webgl2-relaxed:ok`, renders (11/16 distinct sample colours) | 413 / 68334 | 0 |
| Chromium | nowebgl2 | in-page message: "This browser only offers WebGL 1; the game needs WebGL 2." + attempts + Retry | n/a | 0 |
| Chromium | ctxloss | frames frozen at 17 while lost (RAF cancelled, toast shown). After restore: same calls/tris and same centre pixel `146,146,135`. A 2nd loss/restore also recovered (losses 2 / restores 2). Walked at 1.73 m/s afterwards. | 413 / 68334 | 0 |
| Chromium | iphone | 390×844 @3x → drawing buffer 585×1266 (pixelRatio cap 1.5), touch controls on, stick moves at 1.79 m/s | 322 / 71944 | 0 |
| Chromium | shaderfail | 2 water meshes healed to the fallback material, frame keeps rendering | 413 / 68334 | 0 |
| **WebKit (Playwright webkit-2370, WPE, Safari 27.2 engine, Mesa)** | fallback | `webgl2-relaxed:ok`, renders | 418 / 68394 | 0 (after the pointer-lock fix; before it: 1 `WrongDocumentError`) |
| WebKit | nowebgl2 | the same in-page message | n/a | 0 |
| WebKit | ctxloss | paused at 48 frames. Restored ×2 with the same calls/tris. Walked at 2.59 m/s. 0 shader warnings. | 418 / 68394 | 0 |
| WebKit | iphone | renders at 585×1266, controls on, stick moves at 1.79 m/s | 322 / 71944 | 0 |

- **Smoke** (`tools/game-smoke.js`, Chromium), 0 JS errors for both:
  - male: walk 2.49, sprint 8.15, drove at 5.1, exited
  - female: walk 2.59, sprint 8.65, drove at 5.1, exited
  - The only 404s are `/api/state-sync` and `/api/drive/poll`, from the static test server.
- **good-1+1 parity:** the 4 PNGs `parity_{queen,shore}_{noon,dusk}.png` came out of `tools/toon-capture.js`.
  - queen_noon is 434 calls / 68546 tris and shore_noon 229 / 65224, identical to good-1+1.
  - Pixel diff vs `good-1+1/after_*`: 0.18–0.45 % of pixels >8/255 (animated water and clouds).
- **Screenshots:**
  - `chromium_iphone.png`, `webkit_iphone.png` (1170×2532)
  - `*_ctxloss_lost.png` (paused toast)
  - `*_nowebgl2.png` (the in-page reason)
  - `chromium_shaderfail.png`
  - `results_{chromium,webkit}.json`, `smoke_{male,female}.json`

## Headless setup (ARM sandbox)
- **Chromium:** Playwright chromium-1140 (130) for linux-arm64, plus atk/atk-bridge/atspi/Xcomposite/Xdamage from Debian trixie `.deb`s via an `LD_LIBRARY_PATH` wrapper, passed as `CHROME=`. Flags: `--use-angle=swiftshader --enable-unsafe-swiftshader`.
- **WebKit:** playwright-core 1.64.1 `webkit-2370` (WPE MiniBrowser). This needed:
  - 72 trixie arm64 `.deb`s (gtk4, gstreamer, soup3, manette, …) plus libegl1/libegl-mesa0 copied into the bundle's `minibrowser-wpe/sys/lib` (its wrapper resets `LD_LIBRARY_PATH`)
  - `__EGL_VENDOR_LIBRARY_DIRS` pointing at mesa's `50_mesa.json`
  - `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`
  - WebGL2 then runs on Mesa (llvmpipe).
  - It is the real WebKit/JavaScriptCore/WebGL stack, but **not** iOS: the GPU is not Apple, there is no ANGLE-Metal, and there is no iOS memory limit.

## Known limits
- **Not verified on a physical iPhone.** The exact root cause on the user's device can't be confirmed from here. The fix covers every path that produced the message: attribute refusal, context-creation failure and boot errors. If it still fails, the new screen names the reason.
- **No WebGL1 rendering:** it is impossible with three r170 (see above). Devices without WebGL2 (iOS < 15) get a clear explanation, not a game.
- **Portrait HUD overlap on iPhone:** the clock sits over the mission card, and the minimap is behind the F/Brake buttons (see `*_iphone.png`). This predates this goal and is out of scope.
- **iOS sometimes never fires `webglcontextrestored`:** after 12 s the user gets a Reload prompt instead of an automatic rebuild.
