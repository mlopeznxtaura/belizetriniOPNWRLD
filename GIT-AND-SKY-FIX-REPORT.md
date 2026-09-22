# GIT-AND-SKY-FIX-REPORT

**Date:** 2026-09-22 PT  
**Repo:** `/workspace/app13-caribcrime`  
**Live:** https://app13.nextaura.us  
**GitHub:** https://github.com/mlopeznxtaura/belizetriniOPNWRLD.git

---

## Root cause of the black slab

The hard horizontal black rectangle covering the top ~2/3 of the 3D view at golden-hour→dusk was **not** a CSS overlay or an unrotated `PlaneGeometry` wall.

**Primary cause:** evening/night TOD keyframes used near-black sky + fog colors (`bg`/`fogC` ≈ `0x503848` → `0x0e1430` / `0x0c1028`) with relatively dense `FogExp2`. Looking slightly above the horizon, the empty upper frustum + fogged distance read as a solid black slab with a sharp horizon edge. Ground/character remained faintly visible below because they were lit meshes closer to the camera.

**Contributing factors:**
1. No sky dome — upper view relied only on `scene.background` / void clear.
2. `renderer.setClearColor` was never set; WebGL default clear is black if background ever fails to paint.
3. Stars/fog interaction: star points had fog enabled and sat in a flat band, so night sky still looked empty/crushed.
4. Default start hour was **16:30** (golden hour), so play quickly drifted into the crushed dusk band (~17:54 in Marco’s screenshot).

**Ruled out:**
- Full-screen CSS during play: `#start-screen` / `#pause-overlay` use `.hidden`; `#hud` is `pointer-events: none` with no opaque full-bleed layer.
- Unrotated black planes: road/ground/water planes all use `rotation.x = -π/2`; asphalt is dark but ground-level, not a vertical wall.

---

## Fixes applied

| Change | Detail |
|--------|--------|
| Lift dusk + night sky | Evening `bg` → `0x8a6080`; night → navy `0x1a2a50` / `0x1e3058` (not pure black) |
| Soften daytime fog | Noon/afternoon `fogD` ≈ `0.0016–0.0017`; night ≈ `0.0040–0.0042` (was ~0.0062) |
| Sky dome | Large inward `SphereGeometry(480)` + `MeshBasicMaterial` (`BackSide`, `fog: false`) color-synced to TOD `bg` |
| Clear color sync | `renderer.setClearColor` on bind + every frame from `scene.background` |
| Default hour | **14:00** bright afternoon |
| Stars | Upper-hemisphere placement on dome radius; `fog: false` |

---

## Files changed (this fix + prior uncommitted deltas)

**Sky / lighting / renderer (this pass):**
- `public/js/world.js` — `createDayNight` keyframes, sky dome, clear-color apply, default hour 14
- `public/js/main.js` — `setClearColor`, `dayNight.bindRenderer`, per-frame clear sync
- `public/index.html` — TOD clock default label `☀ 14:00`

**Also committed (all previous uncommitted work):**
- `DEVPLAN.md`, `cf-worker/worker.js`, `cf-worker/wrangler.toml`
- `public/css/style.css`, `public/js/hud.js`, `public/js/player.js`, `public/js/vehicle.js`
- `public/assets/characters/*` (male/female GLBs, portraits, refs, LICENSE)
- Reports: `BRIGHTEN-CHARS-V2-REPORT.md`, `CHARS-MALE-FEMALE-REPORT.md`, `VEHICLE-PHYSICS-WW-REPORT.md`
- `tools/asset-atlas-v3-seed.json`

---

## Deploy

| Field | Value |
|-------|--------|
| Worker | `nextaura-app13-us` |
| Route | `app13.nextaura.us/*` |
| **Deploy / Version ID** | `10840085-9c49-4aa2-9383-abcf7b877a4a` |
| Workers.dev | https://nextaura-app13-us.mlopez-683.workers.dev |
| Uploaded assets | `index.html`, `js/main.js`, `js/world.js` (+ 31 already present) |
| Result | **OK** |

Command:
```bash
cd /workspace/app13-caribcrime/cf-worker
PATH="/workspace/app23-nextaura-fit/cf-worker/node_modules/.bin:$PATH" wrangler deploy
```

---

## Git commit + push

| Field | Value |
|-------|--------|
| **Commit SHA** | `cc7a1d5ba680190b7a32c02bacc9ff32d55c2863` |
| Short | `cc7a1d5` |
| Message | Ship day/night, rideables, and Belize/Trinidad character select. |
| Parent | `d46f866` (Iteration A) |
| Files | 24 changed, +2764 / −224 |
| **Push** | **OK** — `d46f866..cc7a1d5  main -> main` |
| Remote | `https://github.com/mlopeznxtaura/belizetriniOPNWRLD.git` |

Auth: existing box git credentials; no force-push. Commit author via env vars (no `git config` writes): `Marco Lopez <mlopez@nextaura.fit>`.

---

## Verify checklist

- [x] Default load clock ≈ 14:00, sky obviously blue/sunny
- [x] Scrub `[` `]` through dusk/night — upper view navy/purple, not a black slab
- [x] No CSS black rectangle over canvas during play
- [x] CF redeployed to app13.nextaura.us
- [x] All deltas committed and pushed to `main`
