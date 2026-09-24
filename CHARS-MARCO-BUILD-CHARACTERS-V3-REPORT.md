# CHARS — Marco build_characters.py turnaround v3

**Date:** 2026-09-24 (PT)  
**Goal:** Ship Marco `build_characters.py` Belize/Trinidad turnaround kit as live male/female/player. Static pose OK.

## Delta vs simulated v2 (9a42e71)

| | Simulated v2 | This ship (build_characters v3) |
|---|---|---|
| Source | `*_simulated.glb` (spheres/cyls kit) | `*_build.glb` from `build_characters.py` turnaround |
| Meshes | 62 male / 56 female | **108 male / 156 female** |
| Kit | tank, cargo, backpack, basic hair/locks | Male: tank + beard + tattoos + watch/dogtag; Female: **crop_top**, **headwrap** stripes/knot, **hoop earrings**, curls/locs |
| Facing | local −Z (`MODEL_YAW_OFFSET = π`) | local **+Z** (`MODEL_YAW_OFFSET = 0`) |
| Skins / clips | None | **None** — still static |
| Height | 1.7 m, feet y=0 | Same |

Honest limit: characters still do **not** walk-animate (no Idle/Walk clips). `player.js` keeps mesh visible.

## Normalize results

- Male: **108** meshes, H(z)=**1.700** m, minZ=**0.000**
- Female: **156** meshes, H(z)=**1.700** m, minZ=**0.000**
- Head (male) after normalize ≈ 0.19 × 0.22 × 0.24 m — proportional

## Files

- `public/assets/characters/{male,female,player}.glb` — normalized build exports
- `public/assets/characters/{male_belizean,female_trinidadian}_build.glb` — provenance (normalized)
- Prior `*_simulated.glb` / `male_belizean.glb` / `female_trinidadian.glb` **kept**
- `public/assets/characters/refs/build_characters_turnaround.png`
- `public/assets/characters/portraits/thumb_{male,female}.png` — recaptured face-forward
- `public/assets/characters/LICENSE.txt` — updated
- `public/index.html` — select alt text
- `public/js/player.js` — `MODEL_YAW_OFFSET = 0` for +Z-facing builds
- `tools/marco_char_delta/{normalize_export.py,build_characters.py}`
- `tools/thumb-capture.html` — default yaw π (face camera)

## Ship

| | |
|---|---|
| Commit | *(filled after push)* |
| Deploy | Cloudflare Worker `nextaura-app13-us` Version ID *(filled after deploy)* |
| Live | https://app13.nextaura.us |
| Verify | Hard-refresh select screen — new thumbs (crop_top/headwrap / tank+beard+tattoos); in-world static kit (no walk clips) |
