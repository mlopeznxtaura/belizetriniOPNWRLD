# Characters From Scratch — Report

**Date:** 2026-09-22 ~1:48 PM PT  
**App:** belizetriniOPNWRLD · https://app13.nextaura.us  
**Decision (LOCKED):** From-scratch stylized low-poly (Blender boxes → Rigify → Idle/Walk → GLB). **No Quaternius Casual plate-faces. No fake store FBX. No kitbash.**

## Outcome

| Check | Status |
|-------|--------|
| Male complete (Idle + Walk wired) | **Done** — teal tank, khaki cargo, boots, short dark hair + beard suggestion |
| Female complete (Idle + Walk wired) | **Done** — coral crop, indigo shorts, boots, updo/braids + amber headband |
| Faces | Painted texture eyes/mouth/nose — **no** separate white Face plate meshes |
| Skin | Warm Caribbean brown (male ≈ RGB 0.46/0.29/0.18, female ≈ 0.52/0.33/0.20) — not pitch black, not ghost beige |
| Clips | Exactly `Idle` and `Walk` (looping) on both GLBs |
| Select labels | **Male** / **Female** · Belize survivor / Trinidad explorer |
| Select thumbs | New in-engine captures of these GLBs |
| Quaternius / kitbash paths | Stripped from player runtime + LICENSE + select UI |
| Rider on ground vehicles | Unchanged (still visible) |
| City / vehicles / missions | Untouched |
| Deploy | Live — see version id below |
| Git | See commit SHA below |

Hard refresh recommended (`Cmd/Ctrl+Shift+R`).

---

## Pipeline (this machine)

| Step | Detail |
|------|--------|
| Blender | **4.3.2** (Debian) + Rigify + glTF 2.0 exporter |
| Blockout | ~11+ overlapping cubes (head/neck/torso/pelvis/limbs/boots + hair extras) |
| Solidify | Boolean UNION → voxel remesh → smooth → optional subdiv |
| Materials | Zone-assigned FaceSkin (painted atlas), Skin, Tank/Crop, Cargo/Shorts, Boots, Hair, Headband |
| Rig | Rigify **basic human** metarig → generate → automatic weights |
| Anims | Control-rig FK keyframes → export deform bones; clip names `Idle`, `Walk` |
| Export | glTF Binary `.glb`, +Y up, animations, apply modifiers |
| Script | `tools/char_build/build_chars.py` · blends in `tools/char_build/out/` |

### Tri counts (exported)

| Asset | Tris (approx) | Bytes | Clips |
|-------|---------------|-------|-------|
| `male.glb` / `player.glb` | **23 568** | 1 057 632 | Idle, Walk |
| `female.glb` | **21 264** | 983 432 | Idle, Walk |

Target band was 10–20k; shipped slightly above (~21–24k) after remesh+subdiv for silhouette continuity. Acceptable for stylized in-game use.

---

## Integrate

| File | Change |
|------|--------|
| `public/assets/characters/male.glb` | Replaced with from-scratch male |
| `public/assets/characters/female.glb` | Replaced with from-scratch female |
| `public/assets/characters/player.glb` | Alias of male |
| `public/assets/characters/LICENSE.txt` | Documents original assets (not Quaternius) |
| `public/assets/characters/portraits/thumb_*.png` | Recaptured |
| `public/js/player.js` | Comments + removed Quaternius beige `_ensureStockMaterial` recolor (now metalness/colorSpace only) |
| `public/index.html` | Labels: Belize survivor / Trinidad explorer |
| `tools/thumb-capture.html` | No beige force; front-ish camera |

`CHAR_PATHS` still `male` → `male.glb`, `female` → `female.glb`. Mixer still finds Idle/Walk case-insensitively.

---

## Deploy

| Item | Value |
|------|-------|
| Target | `app13.nextaura.us` (`nextaura-app13-us`) |
| Version ID | `8f23d72c-4991-4659-8de5-6ef809f5dc89` |
| `/api/health` | 200 `{"ok":true,...}` |
| Live | https://app13.nextaura.us |

```bash
unset CLOUDFLARE_API_TOKEN
cd /workspace/app13-caribcrime/cf-worker
PATH="/workspace/app23-nextaura-fit/cf-worker/node_modules/.bin:$PATH" wrangler deploy
```

### Verify

1. Hard refresh https://app13.nextaura.us  
2. Select thumbs: warm brown custom blocky characters (not Quaternius casuals)  
3. START as Male — Idle breathing, Walk on WASD; teal tank + cargo  
4. START as Female — Idle/Walk; coral crop + headband  
5. Mount scooter/car — rider still visible  

---

## Git

| Item | Value |
|------|-------|
| Repo | https://github.com/mlopeznxtaura/belizetriniOPNWRLD.git |
| Branch | `main` |
| Commit SHA | `f91658f70ed3b243da5aaee317de6668aa9bd8d2` | Message | `Ship from-scratch low-poly male/female chars (Rigify Idle/Walk).` |

---

## Known limitations

- Silhouette is **deliberately blocky** (joined/remeshed boxes), not organic sculpted anatomy — matches “stylized low-poly from cubes” brief.  
- Face paint is a simple atlas (eyes/brows/nose/mouth ± beard wash); readable at game distance, not high-res portrait.  
- Female midriff / crop zone assignment is approximate on the remesh; some back faces may read as skin vs crop.  
- Walk/Idle are functional FK loops (not mocap); stride is arcade-simple.  
- Auto-weights may leave minor volume loss at shoulders; glTF caps 4 influences/vert.  
- Tris slightly over 20k target (~21–24k).  
- `soldier_mixamo.glb` / `xbot.glb` remain as optional fallbacks only (not used when male/female load).  

## Not in this pass

- Day/night, vehicle physics, missions, cop AI, city densification  
