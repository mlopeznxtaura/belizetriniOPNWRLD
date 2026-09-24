# CHARS — OPNassetBUILDER heroes (replace Mixamo)

**Date:** 2026-09-24 (PT)  
**Goal:** Ship Belize male + Trinidad female from OPNassetBUILDER hero meshes with Idle/Walk (and Run), not Mixamo Soldier/Erika.

## Sources
| Asset | Origin |
|-------|--------|
| Base male | `https://app14.nextaura.us/assets/male-hero.gltf` (OPNassetBUILDER "Belize male") |
| Base female | `https://app14.nextaura.us/assets/female-hero.gltf` (OPNassetBUILDER "Trinidad female") |
| Build mirror | `/workspace/opn-chars/{male,female}-hero.gltf` |
| Refs | `public/assets/characters/refs/male_belize_crop.png`, `female_trinidad_crop.png` |
| Builder | `tools/opn_hero_build/build_opn_heroes.py` (Blender 4.3) |

## What was applied
| Item | Male | Female |
|------|------|--------|
| Skin | dark Caribbean `(0.16,0.09,0.06)` | `(0.18,0.10,0.07)` |
| Cloth (tank/crop) | white | red |
| Shorts (skin split: hips+thighs) | olive | khaki |
| Boots (ankle joints) | tan | tan |
| Hair / eyes | near-black / dark | near-black / dark |
| Anims | Idle, Walk, Run (procedural, 17 bones) | same |
| Facing | exported -Z (MODEL_YAW_OFFSET=π unchanged) | same |
| Tris / size | ~1.2k tris / ~119 KB GLB | ~1.2k tris / ~119 KB GLB |

## Files
- `public/assets/characters/male.glb`, `female.glb`, `player.glb` (player=male copy)
- `public/assets/characters/portraits/thumb_{male,female}.png`
- `public/assets/characters/LICENSE.txt`
- `public/index.html` alt text
- `public/js/player.js` — comment only; **MODEL_YAW_OFFSET + load-race guards untouched**

## Remaining gaps vs refs
- Low-poly segmented OPN heroes, not 12k-poly photoreal sheets
- No backpack, tattoos, jewelry, curly-hair sculpt, dog tags
- Garments are material remaps (no unique cargo-pocket / crop topology)
- Procedural walk/run, not mocap

## Rebuild
```bash
blender -b -P tools/opn_hero_build/build_opn_heroes.py
```

## Ship
| Item | Value |
|------|--------|
| Commit | `04243d39a6c87d2a1543ea9ab6119f4465658e5c` (`04243d3`) |
| Deploy | Cloudflare Worker `nextaura-app13-us` Version ID `5450a280-58a6-44b5-ab91-b6613c1e2591` |
| Live | https://app13.nextaura.us |
| Verified | live `male.glb`/`player.glb`/`female.glb` ≈122 KB, md5 male=player=`2764b571…`, clips Idle/Walk/Run |
