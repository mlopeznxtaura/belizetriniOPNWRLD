# CHARS — Marco Belizean / Trinidadian trimesh delta

**Date:** 2026-09-24 (PT)  
**Goal:** Urgent visual delta — ship Marco’s own hierarchical GLBs (backpack/tank/cargo/locks) on select + in-world. Static pose OK.

## Delta vs prior OPN heroes

| | Prior (OPNassetBUILDER heroes) | This ship (Marco trimesh) |
|---|---|---|
| Source | app14 male-hero / female-hero | `male_belizean.glb` / `female_trinidadian.glb` (Marco) |
| Parts | Segmented limbs; shorts/boots = material remaps of skin | Authored parts: cargo/shorts, tank/red_tank, backpack, boots, hair/locks, jewelry |
| Skins | 17-bone humanoid | **None** (`skins: null`) |
| Clips | Procedural Idle / Walk / Run | **None** — static pose, mesh stays visible |
| Height | ~1.8 m runtime normalize | Exported **1.7 m**, feet on y=0 |
| Tris / style | ~1.2k OPN hero | Low-poly box/cyl trimesh parts (~39 male / 52 female meshes) |
| Match to Belize/Trinidad refs | Weak (no backpack/locks/jewelry) | **Much closer** (kit matches refs) |

Honest limit: characters do not walk-animate yet (no Idle/Walk clips). Optional later: hierarchical bob without skins.

## Files

- `public/assets/characters/{male,female,player}.glb` — normalized exports
- `public/assets/characters/{male_belizean,female_trinidadian}.glb` — provenance originals
- `public/assets/characters/portraits/thumb_{male,female}.png` — in-engine recapture
- `public/assets/characters/LICENSE.txt` — Marco authorship note
- `public/js/player.js` — keep mesh visible if no clips; comments updated (MODEL_YAW_OFFSET + load-race guards kept)
- `public/index.html` — select alt text
- `tools/marco_char_delta/normalize_export.py` — Blender normalize/export

NOT used: Mixamo Soldier / Erika.
