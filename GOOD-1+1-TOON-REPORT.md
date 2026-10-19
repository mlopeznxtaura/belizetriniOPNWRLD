# good-1+1: Wind Waker toon world pass

Goal: the world reads as Wind Waker-style toon / cel-shaded, and the characters stay modern humans.
Base = `150e290`. Not deployed (no Cloudflare token yet). Only main and the tag are pushed.

## What changed
- **`public/js/toon.js` (new): the shared toon system**
  - Gradient ramps on `MeshToonMaterial.gradientMap`, using nearest-filtered DataTextures:
    - `RAMP_WORLD` is a crisp 3-band ramp (shadow, thin terminator band, lit).
    - `RAMP_SKIN` is a softer 3-band ramp with a wide mid band, for skin and cloth.
    - Both shadow levels follow the sky state each frame (`applyToonSkyState`).
  - `toonMaterial()` / `convertMaterial()` give flat albedos. A banded rim/sky light is injected through
    `onBeforeCompile`, with one shared program per ramp. Rim lighting is only on characters and vehicles. On big flat walls and ground,
    a view-angle rim turned into a smeared gradient, so world surfaces get their sky fill from the hemisphere light instead.
  - Inverted-hull outlines: a BackSide hull on welded geometry (`mergeVertices` plus smooth normals, so box
    corners stay closed), pushed out along the normal in the vertex shader.
    - The width is about 1.1–1.7 px, capped in metres per class (building 7 cm, prop 3 cm, vehicle 2.8 cm,
      character 1.1 cm), so thin parts are never swallowed.
    - Lines fade to zero with distance (near/far per class) and take the fog colour.
  - Outline budget:
    - **Static world outlines are batched**: about 284 building and prop hulls are baked to world space and merged
      into one mesh per class, so they cost **2 draw calls** in total. A per-vertex owner AABB drops a hull when the camera is
      inside its owner.
    - Moving objects keep their own hull: vehicles get the 5 biggest parts each, characters the 18 biggest parts.
      Owners that are tiny (`minR`), far away, or below a minimum screen size get no outline draw (`updateToon` culls them per frame). A hull is also hidden when the camera is inside its owner.
  - **Wind Waker sky**: the gradient dome is computed per vertex (horizon = fog colour, warmed by a low sun; the zenith is a deeper,
    more saturated version of the keyframe colour). The sun is a disk with two flat halo rings and the moon a crescent disk.
    There are 26 puffy two-tone cel cloud cards in one InstancedMesh, billboarded in the vertex shader and slowly drifting.
    The sky follows the camera, because the old dome (r = 480) sat outside the camera's 450 m far plane and never drew.
  - **Stylised water** (no textures):
    - A flat shallow/deep two-tone colour and a gentle vertex wave.
    - A white contact rim, plus travelling foam bands parallel to the shore, broken up by world-space value noise.
    - Sparse open-water flecks.
    - The shore comes from box SDFs of the two land masses and the two piers.
  - `?toon=0` is a kill switch that restores the exact pre-pass look (verified identical numbers below).
- **`world.js`**
  - The same material keys now carry Wind Waker albedos (`WW_ALBEDO`: bright, saturated, flat).
    MeshStandard materials became toon materials; unlit decals (windows, neon) keep MeshBasic.
  - The water uses the new shader with tessellated planes.
  - Toon mode only:
    - Sand beach strips along both shorelines.
    - The bridge rails are painted white instead of the glowing cyan slabs.
  - Time of day (the `createDayNight` KEYS and `apply()`) is untouched. In toon mode `apply()` additionally drives:
    - the sky dome, sun, moon and clouds
    - the ramp shadow levels
    - the rim and outline colours
    - the water's shallow, deep and foam colours
    - the fog density (×2.3, capped at 0.0075), so the far city melts into the horizon band
  - The old dome stays for `?toon=0`, and stars ride with the toon sky.
- **`player.js`**: the loaded character gets `toonify(model, {klass:'char', ramp: RAMP_SKIN})` after the rig is built.
  Geometry, joints, and `char_rig.js` are unchanged. Dispose skips the shared outline material and hulls.
- **`main.js`**: vehicles and cops get toon materials plus vehicle-class outlines. `updateToon()` runs before each render.
- **`tools/game-smoke.js`** honours `CHROME=` (falls back to `/usr/bin/google-chrome`).
- **`tools/toon-capture.js` (new)** captures 4 fixed spots × noon (12:00) / dusk (18:45). For each it records a PNG plus `renderer.info`
  (calls, triangles), the point-light count and the median of 15 synced renders (`readPixels`) on SwiftShader, writes everything to
  `docs/fidelity/good-1+1/`, and builds a contact sheet (`node tools/toon-capture.js sheet`).

## Numbers (SwiftShader, 960×540, same spots and camera; before = 150e290 worktree)
| spot_time | draw calls | triangles | frame ms (median) |
|---|---|---|---|
| queen_noon | 389 → 434 | 45758 → 68546 | 142.2 → 177.2 |
| queen_dusk | 390 → 435 | 45758 → 68546 | 142.2 → 175.2 |
| shore_noon | 200 → 229 | 42830 → 65224 | 90.5 → 108.8 |
| shore_dusk | 201 → 230 | 42830 → 65224 | 90.7 → 107.8 |
| bridge_noon | 1141 → 1170 | 52954 → 75348 | 142.9 → 184.3 |
| bridge_dusk | 1142 → 1171 | 52954 → 75348 | 143.1 → 183.1 |
| pos_noon | 662 → 707 | 48478 → 71064 | 148.4 → 187.2 |
| pos_dusk | 663 → 708 | 48478 → 71064 | 150.1 → 188.2 |

- Draw calls: +29 to +45 per view (+3 to +15%). That breaks down as:
  - 2 batched static outline meshes
  - about 6 instanced prop hulls
  - 18 character hulls
  - the vehicle hulls in view
  - sky and clouds
- The large existing counts (1141 at the bridge) come from the unbatched window and frame meshes. That was already true before this pass and is the next budget win.
- Point lights: 8 → 8. No lights were added and no shadows are used.
- Triangles: about +22k. Roughly 11k is instanced palm and lamp hulls, 5k character hulls, 3k water tessellation, 1.5k sky.
- Frame time on SwiftShader (CPU raster, so the cost is all fill): +18 to +41 ms. On the queen view, toggling each piece off showed:
  - sky dome ≈ 12 ms
  - outlines ≈ 16 ms
  - water ≈ 7 ms
  - clouds ≈ 2 ms
  - The toon materials cost the same as MeshStandard (the planes measured 64 vs 63 ms).
  - On a real GPU these passes are trivial, but they were not measured on a GPU here.
- Kill switch `?toon=0` gives 389 calls, 45758 tris and 142.2 ms at queen_noon, identical to before.
- Smoke tests (`CHROME=… node tools/game-smoke.js male|female`): **0 JS errors** for both.
  - male: walk 2.53, sprint 8.66 m/s, entered sedan, drove at 4.25, exited.
  - female: walk 2.57, sprint 7.80, entered, drove at 5.1, exited.
  - The only 404s are `/api/state-sync` and `/api/drive/poll`, because the smoke server is static only (same as before).
  - Raw output: `docs/fidelity/good-1+1/smoke_{male,female}.json`.

## Screenshots (`docs/fidelity/good-1+1/`)
- `before_{queen,shore,bridge,pos}_{noon,dusk}.png` and `after_…` (16 PNGs)
- `flag0_queen_noon.png` (the `?toon=0` kill switch)
- `contact_sheet.png` (before | after with calls/tris/ms per row)
- `metrics.json` (everything above, plus outline stats per class)

## Headless route used
This sandbox is aarch64 and has no `/usr/bin/google-chrome`. The route that worked:
- Playwright's Chromium 130 build for linux-arm64 (`npx playwright-core install chromium`).
- Five missing shared libraries (atk, atk-bridge, atspi, Xcomposite, Xdamage), extracted from Debian trixie `.deb`s into a local `LD_LIBRARY_PATH`.
- A wrapper passed via `CHROME=`, using the same `--use-angle=swiftshader` flags as before.
- `puppeteer-core@23` installed with `--no-save` (`node_modules` is gitignored).

## Known limits
- Dusk is very warm. The existing dusk keyframes (orange hemi and ambient) multiplied with the brighter albedos make the ground
  olive and the asphalt maroon. It reads as sunset, but a toon-specific dusk palette would look better.
- Characters are dark at night, the same as before. The skin ramp only changes the banding.
- Foam is drawn only where the water plane is visible. The ground planes cover the creek and both piers, so the pier foam
  rectangles currently sit under land. The south coast is a straight edge, so the foam is too. The map layout was out of scope.
- Character hulls are per rigid part, capped at the 18 largest. Fingers and small trims have no line. Where rigid parts overlap at a joint, the
  hulls can show a short inner line.
- Hulls on the instanced palms and lamps cover the whole map, so they are never CPU-culled (per-vertex fade only).
- The car camera can still clip into buildings. This existed before the pass (see `game_female_vehicle.png` in both trees). Hulls hide while the camera is
  inside their owner, so the clipping no longer floods the screen with outline colour.
- Frame time was measured on SwiftShader only (no GPU in the sandbox).
