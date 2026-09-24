# CHARS — Marco Belizean / Trinidadian *simulated* trimesh delta

**Date:** 2026-09-24 (PT)  
**Goal:** Ship next Marco look-delta (`*_simulated.glb`) as live male/female/player. Static pose OK.

## Delta vs prior Marco trimesh (862b9d1)

| | Prior Marco trimesh | This ship (simulated) |
|---|---|---|
| Source | `male_belizean.glb` / `female_trinidadian.glb` | `male_belizean_simulated.glb` / `female_trinidadian_simulated.glb` |
| Meshes | ~39 male / ~52 female | **62 male / 56 female** |
| Kit extras | tank, cargo, backpack, single hair/locks | + boot **laces**, multi hair/dread strands, headwrap, eyes/nose/lips, beard, tattoo bands, straps |
| Materials | generic part colors | Named: `off_white_tank`, `trinidad_red_top`, `olive_cargo`/`khaki_cargo`, `deep_brown_skin`, `hair`, `headwrap`, … |
| Skins / clips | None | **None** — still static |
| Height | 1.7 m, feet y=0 | Same |
| Source attrs | POSITION (+ NORMAL after Blender) | POSITION-only source; Blender recalc adds NORMAL on export |

Honest limit: characters still do **not** walk-animate (no Idle/Walk clips). `player.js` keeps mesh visible.

## Head / scale notes

- Normalized H = **1.70 m**, minY = **0.0** (both).
- Head mesh after normalize ≈ **0.21 × 0.23 × 0.22 m** — proportional, not huge/wrong.
- Prior select thumbs had gray blocky head look; this capture uses **face-forward yaw=0** + head-cluster framing so face/hair/headwrap read clearly (backpack sits behind, not as a head artifact).
- Face remains minimal (tiny eye dots; nose/lips low-contrast vs skin).

## Files

- `public/assets/characters/{male,female,player}.glb` — normalized simulated exports
- `public/assets/characters/{male_belizean,female_trinidadian}_simulated.glb` — provenance
- Prior `male_belizean.glb` / `female_trinidadian.glb` **kept**
- `public/assets/characters/portraits/thumb_{male,female}.png` — recaptured
- `public/assets/characters/LICENSE.txt` — updated
- `public/index.html` — select alt text
- `public/js/player.js` — visible-when-no-clips + MODEL_YAW_OFFSET + load-race guards **kept**
- `tools/marco_char_delta/normalize_export.py` — Blender normalize/export
- `tools/thumb-capture.html` — face-forward / head-framed capture

NOT used: Mixamo Soldier / Erika, OPNassetBUILDER heroes.
