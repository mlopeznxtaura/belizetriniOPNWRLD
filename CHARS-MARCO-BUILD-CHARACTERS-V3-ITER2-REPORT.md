# CHARS — Marco build_characters.py iteration 2 (fingers + detail)

**Date:** 2026-09-24 (PT)  
**Goal:** Ship Marco `build_characters.py` iteration 2 as live male/female/player, the same way as iteration 1 (98a75b8). Static pose OK.

## Delta vs iteration 1 (98a75b8)

| | Iteration 1 | Iteration 2 (this ship) |
|---|---|---|
| Source | `*_build.glb` | `*_build_v2.glb` |
| Meshes | 108 male / 156 female | **181 male / 223 female** |
| New detail | — | 4 separate fingers + thumb per hand, eyelids, inner ears, boot lace eyelets, more hair/kit parts |
| Facing | local +Z | local **+Z** (unchanged, so `MODEL_YAW_OFFSET` stays 0) |
| Skins / clips | None | **None**, still static |
| Height | 1.700 m, feet y=0 | **1.700 m, feet y=0** (male and female) |
| Normalized GLB size | 300 KB male / 390 KB female | **521 KB male / 608 KB female** (+73% / +56%) |

Load impact: the live CDN serves `model/gltf-binary` **uncompressed** (no content-encoding). With gzip it would be about 182 KB / 203 KB.
Only one character GLB loads in-world, so each load adds about 220 KB. Draco/meshopt is not used (Blender's Draco library is missing on the box).

## Thumb-capture fix

The new boot `eyelet_*` meshes matched the head-cluster filter (`startsWith('eye')`), which zoomed the camera out to a full-body shot.
`tools/thumb-capture.html` now excludes `eyelet*`. Thumbs are recaptured face-forward with head-cluster framing.

## Files

- `public/assets/characters/{male,female,player}.glb`: normalized iteration 2 exports
- `public/assets/characters/{male_belizean,female_trinidadian}_build_v2.glb`: provenance (new)
- Iteration 1 `*_build.glb`, `*_simulated.glb`, and earlier deltas are **kept** (iteration 1 hashes unchanged)
- `public/assets/characters/refs/build_characters_turnaround_v2.png`
- `tools/marco_char_delta/build_characters.py` (iteration 2); `build_characters_v1.py` (iteration 1)
- `tools/marco_char_delta/normalize_export.py`: JOBS point at `/workspace/marco-char-delta4/*_build_v2.glb`
- `public/assets/characters/portraits/thumb_{male,female}.png`, `LICENSE.txt`, `public/index.html` alts

## Ship

| | |
|---|---|
| Commit | *(filled after push)* |
| Deploy | Cloudflare Worker `nextaura-app13-us` Version ID *(filled after deploy)* |
| Live | https://app13.nextaura.us |
