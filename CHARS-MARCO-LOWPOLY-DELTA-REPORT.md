# CHARS — Marco lowpoly generation (live test vs build_characters iteration 2)

**Date:** 2026-09-24 (PT)  
**Goal:** Ship Marco's different lowpoly generation live, compare the delta against iteration 2, and roll back on git if it regressed.

## Rollback target

- **Iteration 2 assets:** commit `838b7037df2959ef181c3b7d04068b8612236368` (docs HEAD before this ship: `36cf2a3`)
- Iteration 2 provenance `*_build_v2.glb` is **untouched** in `public/assets/characters/`

**Rollback option A (recommended; restores iter2 assets and keeps the tooling fixes):**
```bash
cd /workspace/app13-caribcrime
git checkout 838b703 -- public/assets/characters/male.glb public/assets/characters/female.glb \
  public/assets/characters/player.glb public/assets/characters/portraits/thumb_male.png \
  public/assets/characters/portraits/thumb_female.png public/assets/characters/LICENSE.txt public/index.html
git commit -m "Roll back chars to build_characters iteration 2 (838b703)." && git push origin main
cd cf-worker && unset CLOUDFLARE_API_TOKEN && PATH="/workspace/app23-nextaura-fit/cf-worker/node_modules/.bin:$PATH" wrangler deploy
```
**Rollback option B (full revert):** `git revert --no-edit 173b162` (plus any later doc commits), then push and deploy as above.
Option B also reverts the normalize quaternion fix and the thumb-filter prefix fix.

## Orientation fix

The source imports into Blender lying along **−Y** (feet near y≈0, head at y≈−5.3), about **5.7 units** tall, with the face toward −Z.
`normalize_export.py` now:
- rotates **−90° about X** through world matrices (the old `rotation_euler` path silently did nothing because glTF import uses QUATERNION rotation mode)
- runs `orient_by_anchors()` with strict asserts: head clearly above the boots, nose clearly in front on Blender −Y (= glTF **+Z**)

Result: `MODEL_YAW_OFFSET` stays **0**, and `player.js` is unchanged.

## Numbers (normalized GLBs as served)

| | iter2 male | **lowpoly male** | iter2 female | **lowpoly female** |
|---|---|---|---|---|
| Meshes | 181 | **48** | 223 | **55** |
| Triangles | 27,748 | **4,892** | 32,676 | **4,820** |
| Verts (exported) | 15,752 | 13,254 | 18,180 | 12,658 |
| Source GLB bytes | 459,752 | 59,156 | 574,724 | 63,280 |
| Served GLB bytes | 520,508 | **373,844** | 607,908 | **357,120** |
| Served gzip -9 (CDN serves uncompressed) | ~182 KB | **~64 KB** | ~203 KB | **~63 KB** |
| Height / min Z | 1.700 / 0.000 | 1.700 / 0.000 | 1.700 / 0.000 | 1.700 / 0.000 |
| Fingers | yes (4 + thumb per hand) | **no** (mitten) | yes | **no** |
| Eyelids | yes | **no** | yes | **no** |
| Laces / eyelets | 10 / 20 | **0 / 0** | 10 / 20 | **0 / 0** |
| Materials | 28 | **9** | 30 | **9** |
| Skins / clips | none | none | none | none |

Size note: the lowpoly source is POSITION-only with 2,542 shared verts and renders flat-shaded. Blender adds normals and splits verts per face, so 59 KB becomes 374 KB. That is the same pipeline as v3/iter2; it could be cut down later with smooth normals or meshopt.

## Delta render

`tools/marco_char_delta/compare_iter2_vs_lowpoly.png` (1600×1083): Workbench studio light, a single ortho camera, and a light background. Columns are front / 3/4 / side for iter2 and lowpoly; rows are male and female.
Regenerate it with `blender -b -P tools/marco_char_delta/render_compare.py`.

## Honest read

**Improved**
- **Performance:** about 5.7–6.8× fewer tris, about 3.8–4× fewer meshes/draw calls, 9 materials instead of 28–30. It is about 28–41% smaller on the wire (about 3× smaller gzipped). Good for mobile.
- **Consistency:** male and female share an identical part layout and joint heights, which would make future rigging easier.

**Regressed**
- **Silhouette:** stick-thin limbs, a narrow torso and long thin legs read as a mannequin next to iter2's muscled arms, shaped torso and boots.
- **Face:** the eyes are authored inside the haircap (haircap front −0.338 vs eye −0.316), so **no eyes are visible**. The male beard reads as a dark blob and there are no eyelids or brows.
- **Head/neck:** the head floats **~6.7 cm (male) / ~4.6 cm (female)** above the neck; the gap is visible in the thumbs.
- **Hands:** a single mitten, where iter2 has 4 fingers + thumb.
- **Hair:** male curls and female locs point **up** like a crown/comb, where iter2 has hanging locs and curls.
- **Kit:** no laces or eyelets, tattoos, hoop earrings, crop top (the female is back to a red tank), watch or dog tag.

**Verdict:** a clear **visual regression** against iteration 2, and only a performance win. I recommend rolling back to `838b703` unless the perf budget is the priority. Fixing the head gap, eye depth and hair direction in the generator would be needed before this kit could replace iteration 2.

## Files

- `public/assets/characters/{male,female,player}.glb`: normalized lowpoly
- `public/assets/characters/{male_belizean,female_trinidadian}_lowpoly.glb`: provenance (new)
- All earlier provenance kept (`*_build_v2`, `*_build`, `*_simulated`, originals)
- `public/assets/characters/portraits/thumb_{male,female}.png`: recaptured face-forward
- `public/assets/characters/LICENSE.txt`, `public/index.html` alts
- `tools/marco_char_delta/normalize_export.py`: delta5 sources, matrix rotation + anchor orient
- `tools/thumb-capture.html`: head filter strips the `male_`/`female_` prefix and still excludes `eyelet*`
- `tools/marco_char_delta/render_compare.py` + `compare_iter2_vs_lowpoly.png`

## Ship

| | |
|---|---|
| Commit | `173b162fe77754a7b85387c640755e568b12de3f` |
| Deploy | Cloudflare Worker `nextaura-app13-us` Version ID `cca794d2-09c6-406a-94ff-21da24b4252a` |
| Live | https://app13.nextaura.us |
| Verify | Live sha256 (app13 + workers.dev) of male/female/player, `*_lowpoly`, `*_build_v2` and thumbs matches local, both immediately (18:12 PT) and on the 45 s recheck (18:13 PT) |
