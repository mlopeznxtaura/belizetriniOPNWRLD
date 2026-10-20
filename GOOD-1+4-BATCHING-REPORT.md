# good-1+4: Instanced / merged props, with a big draw-call cut and the same look

- **Base:** `e2d220e` (good-1+3)
- **Deployed:** no
- **Kill switch:** `?batch=0` restores the exact good-1+3 scene graph. Its numbers are identical to good-1+1/1+3: 434 / 229 / 1170 / 707 calls.

## What changed
### `public/js/batch.js` (new)
- **`batchStatic(root, {cell: 96})`** merges every plain opaque static Mesh directly under the world root into world-space geometry.
  - That covers window panes, window frames, base trims, roofs, porches and posts, balconies and balcony rails, neon strips, awnings, gas canopies, steeples, bridge deck and rails, road strips, sidewalks, intersection pads and pier crates.
  - Grouping is one mesh per *equivalent material* per 96 m XZ cell, so frustum culling still drops whole districts behind the camera.
  - At build time 1,123 meshes become 117 batches plus a few singletons.
  - Materials are reused as-is, so the toon ramps, fog, lights and shadows are untouched.
  - Batches made only of flat planes are flagged `noCast` for ultra shadows.
  - Excluded: InstancedMesh, ShaderMaterial (water, sky), transparent materials, `renderOrder ≠ 0`, mission blips and outlines.
- **`batchChildren(parent, klass)`** is the generic rigid-part merge. It works in the parent's local space, so the parent still moves or animates as one.
  - Parts are merged per equivalent material (`materialKey()`: type, colour, emissive, maps, side, opacity, program key…). Vehicles create a fresh material per part, so a uuid key would never merge them.
  - The outline hulls those parts already carried (the toon budget picks the N biggest parts) are merged into **one hull mesh**. That hull stays registered with the toon outline culler (`registerOutline`, new in toon.js) and is its own owner.
  - Transparent parts (car glass, so it keeps its back-to-front sort) and sub-groups (heli and plane rotors and props) stay separate.
- **`batchVehicle(v)`** runs `batchChildren(v.body)` and is called from `main.js` after the vehicles are toonified.
  - A sedan goes from 39 meshes to about 10 draws, including its 4 glass panes and 1 merged hull.
- **`batchCharacter(rig)`** runs `batchChildren` on each of the 17 procedural-rig joint pivots. It is called from `player.js` only when the ProceduralRig drives the model and no glTF clip could target part nodes.
  - Character draws: **203 → 69** (185 parts → 59 merged meshes, 18 part hulls → 10 merged hulls).
  - Character swaps re-batch cleanly: the outline registry stays at 46 entries across male → female → male.
- **Instanced props** (bins, barrels, stalls, palms, lamp poles, arms and heads) were already `InstancedMesh`.
  - Their outline hulls were 6+ separate instanced draws. Every instance's hull is now baked into the static batched `prop` outline mesh (in `world.js`; `buildStaticOutlines` accepts a per-instance `matrix`), so they cost **0 extra draws**.
  - They keep the per-vertex owner box, which drops the hull when the camera is inside it.
- **`tools/quality-capture.js`** gained a `--query` option and per-run batch stats. **`tools/batch-test.js`** (new) covers character swap, vehicle drive, `?toon=0` and `?batch=0`.

## Verification (`docs/fidelity/good-1+4/`)
### Draw calls, triangles and frame time
`high` preset (the good-1+1 look), SwiftShader 960×540 at DPR 1, noon, same seeded and frozen harness. Before = `?batch=0`.

| spot | draw calls | triangles | frame ms (median of 15) |
|---|---|---|---|
| Queen St | **434 → 166 (−62 %)** | 68,546 → 71,334 | 178.1 → 171.2 |
| South shore | **229 → 87 (−62 %)** | 65,224 → 65,228 | 110.8 → 103.0 |
| **Causeway** | **1170 → 252 (−78 %)** | 75,348 → 75,340 | 196.8 → 165.2 |
| Downtown PoS | **707 → 190 (−73 %)** | 71,064 → 73,486 | 192.4 → 202.5 |

- `low` preset: Queen 402 → 155, causeway 1150 → 243.
- WebKit iPhone emulation (auto preset): 322 → 112 calls.
- Triangles rise by up to +3.4 % where the 96 m cells pull in some off-screen geometry. That is the trade for about 4× fewer draws.
- The frame ms here is CPU-raster fill on 2 shared cores, so it is noisy (±10 ms run to run). Draw-call overhead is mostly a CPU/driver cost that SwiftShader does not model well. The causeway still dropped 32 ms.
- On a real phone GPU, the ~900 fewer draws per frame at the causeway are the main win. This was **not measured on a device**.

### Pixel diff, before vs after (`pixel_diff.json`, `diff_*_noon.png`, `contact_sheet.png`)

| spot | px > 8/255 | outside the character box |
|---|---|---|
| Queen St | 0.22 % | 0.004 % |
| South shore | 0.28 % | 0.000 % |
| Causeway | 0.23 % | 0.055 % |
| Downtown PoS | 0.20 % | 0.039 % |

- **World:** the world is identical apart from a one-pixel sliver along the causeway deck edge (draw order on coplanar edges) and a few pixel specks at PoS.
- **Character:** almost all the remaining difference is on the character's outlines. The run-to-run noise of the unbatched build on the character, from its idle animation, is 0.09 % (`before` vs a second `before`). The other ~0.15 % comes from the merged per-joint character hulls, which have slightly different culling and overlap than the 18 per-part hulls.
- The side-by-side crops look the same by eye.

### Smoke and regression tests
- **Smoke** (`?quality=high`), 0 JS errors for both:
  - male: walk 2.21, sprint 7.74, sedan drove 3.53, exited
  - female: walk 2.56, sprint 8.78, drove 4.1, exited
  - A first female run under host load sampled mid-acceleration (walk 0.97 / sprint 6.03). The rerun is above.
- **`batch-test.js`**, 0 errors in all three modes:
  - Character swap ×2 with a stable outline registry.
  - Entered a merged sedan, drove and turned, exited (`batch_drive.png`).
  - `?toon=0` + batching: 141 calls.
  - `?batch=0`: 413 calls (unbatched, as before).
- **WebKit:**
  - context loss/restore ×2 with batches: 165 → 166 calls, moved 2.6 m/s, 0 uncaught, 0 shader warnings
  - iPhone emulation renders (`webkit_iphone.png`), 0 errors

## Known limits
- **Cop cars and peds (`ai.js`) are not batched yet.** That is 40 meshes, 8 units × 5.
- **Some separate draws remain on purpose:** car glass, heli/plane rotors, and single-material parts.
- **Merged character hulls differ slightly:** they are culled per joint, not per part, which explains the ~0.15 % outline pixel difference on the character.
- **Coarse cells:** 96 m means some off-screen batches still draw (+0–3.4 % tris). The cell size is a parameter (`quality.batchCell`). 48 m gave 381 / 566 / 457 calls before the vehicle and character passes, so 96 was chosen.
- **Batched geometry is built once:** the world kit is static. If world meshes are ever edited at runtime, the batch must be rebuilt.
- **Frame-time gains were measured on SwiftShader only.**
