# Characters Black-Skin Fix — Report

**Date:** 2026-09-22 ~1:30 PM PT  
**App:** belizetriniOPNWRLD · https://app13.nextaura.us  
**Scope:** Select thumbs + in-world Casual_Male / Casual_Female pitch-black skin / white-square eyes. No kitbash. No vehicles/missions.

## Outcome

| Check | Status |
|-------|--------|
| Root cause | FBX2glTF Skin `baseColorFactor` ≈ `[0.011,0.011,0.011]` (near black) + `metallicFactor` 0.4 |
| Skin restored | Warm beige sRGB `#E8C4A8` (linear ≈ `[0.807,0.552,0.392]`), metalness 0 |
| Select thumbs | Re-rendered with Ambient + Hemisphere + Directional; beige skin |
| In-world mesh | Same patched GLBs + runtime `_ensureStockMaterial` guard |
| Eyes | Pack Face plates stay light-gray Quaternius style — readable on beige (not “white on black”) |
| Labels | Male / Female · Casual_Male / Casual_Female unchanged |
| Kitbash | None added |
| Deploy | Live — version `beee5a9c-9dc3-4199-87bc-5fd5d82d173c` |
| Git | See commit SHA below |

Hard refresh recommended.

---

## Root cause

Not missing thumb lights (capture already had Ambient + Hemi + sun). Not dayNight failing to illuminate characters.

`Casual_Male.glb` / `Casual_Female.glb` (FBX→GLB via FBX2glTF) shipped with:

| Material | baseColor (linear) | metalness | Result |
|----------|-------------------|-----------|--------|
| **Skin** | ~`0.0107` gray | 0.4 | Pitch-black under MeshStandardMaterial |
| Face | ~`0.80` light | 0.4 | White eye/brow squares |
| Shirt / Pants / Hair | dark blue / brown / brown | 0.4 | Looked “OK” → false “lighting” theory |

Prior clean-chars pass incorrectly treated near-black Skin as intentional Quaternius style. It is a conversion bug; stock Quaternius casuals read as warm beige Caucasian/default skin.

---

## Fix

1. **Patched GLBs** (`male.glb`, `female.glb`, `player.glb` alias): Skin → `#E8C4A8`, metalness 0, roughness 0.72; Face metalness 0; other mats metalness capped ~0.05.
2. **`public/js/player.js`**: `_ensureStockMaterial()` — if Skin (or near-black non-cloth) → warm beige; Face metalness 0; else clamp metalness. Safety net only — not Caribbean recolors/accessories.
3. **Thumbs**: Re-captured via headless Chrome + Ambient/Hemi/Directional + same stock repair (`tools/thumb-capture.*`).
4. dayNight Ambient/Hemi/sun already illuminate characters; materials now respond.

---

## Deploy

| Item | Value |
|------|-------|
| Target | `app13.nextaura.us` (`nextaura-app13-us`) |
| Version ID | `beee5a9c-9dc3-4199-87bc-5fd5d82d173c` |
| `/api/health` | 200 OK `{"ok":true,...}` |
| Live Skin check | `male.glb` / `player.glb` baseColor `[0.807,0.552,0.392]` metalness 0 |

```bash
unset CLOUDFLARE_API_TOKEN
cd /workspace/app13-caribcrime/cf-worker
PATH="/workspace/app23-nextaura-fit/cf-worker/node_modules/.bin:$PATH" wrangler deploy
```

### Verify

1. Hard refresh https://app13.nextaura.us  
2. Select thumbs: beige skin, not black silhouettes  
3. START as Male / Female — in-world skin matches  
4. No afro/bandana/hoops/backpack kitbash  

---

## Git

| Item | Value |
|------|-------|
| Repo | https://github.com/mlopeznxtaura/belizetriniOPNWRLD.git |
| Branch | `main` |
| Commit SHA | _(filled after push)_ |
| Message | `Fix Quaternius casual black skin materials and thumbs.` |

---

## Not in this pass

- Caribbean kitbash / poster recolors  
- Vehicle / mission / cop changes  
- Replacing Quaternius with custom Belize/Trinidad meshes  
