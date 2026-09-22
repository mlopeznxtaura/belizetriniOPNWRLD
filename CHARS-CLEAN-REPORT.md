# Characters Clean Pass — Report

**Date:** 2026-09-22 ~1:15 PM PT  
**App:** belizetriniOPNWRLD · https://app13.nextaura.us  
**Decision (LOCKED):** Clean Quaternius casuals first — no more kitbash.

## Outcome

| Check | Status |
|-------|--------|
| Runtime kitbash removed | Done — no material recolors, afro/bandana meshes, hoops, backpacks, dog tags |
| `male.glb` / `female.glb` | Clean Quaternius Casual_Male / Casual_Female (CC0); identical to `/tmp/charfetch` sources |
| Select labels | **Male** / **Female** (+ `Casual_Male` / `Casual_Female` desc) — no poster-match claims |
| Select thumbs | Neutral in-engine GLB captures (not Chronicles / sunny-pier crops) |
| localStorage + Idle/Walk + ground rider visible | Kept |
| Day/night, vehicle physics, missions, cops | Untouched |
| Deploy | Live — version `24fd6461-3dd2-443b-a501-1363c64cb847` |
| Git | See commit SHA below |

Hard refresh recommended.

---

## What was removed (`public/js/player.js`)

Deleted `_applyPortraitLook()` and its call site. That method previously:

- Recolored Skin / Face / Hair / Shirt / Pants / Shoes toward sunny-pier poster palette
- Hid female stock hair under a procedural curly updo (icosahedron puffs)
- Added red/orange headband, gold hoop earrings, pendant
- Added male beard mesh + dog tags chain
- Added backpack (both)

Also dropped `_accessories` tracking. Procedural GLB-fallback colors reset to neutral casual (not poster tints).

**Kept:** `CHAR_KEY` / `getStoredChar` / `setStoredChar`, Idle/Walk(/Run/Sit) mixer, ground-vehicle seating with visible rider, air hide.

---

## Asset sources

| File | Source | License | Notes |
|------|--------|---------|-------|
| `public/assets/characters/male.glb` | Quaternius Ultimate Animated Character Pack — **Casual_Male** (FBX→GLB) | CC0 | Re-copied from clean `/tmp/charfetch/Casual_Male.glb` (already identical MD5) |
| `public/assets/characters/female.glb` | Same pack — **Casual_Female** | CC0 | Re-copied from `/tmp/charfetch/Casual_Female.glb` |
| `public/assets/characters/player.glb` | Alias of male | CC0 | Fallback |
| `portraits/thumb_male.png` / `thumb_female.png` | Headless three.js render of stock GLBs | — | Replaced sunny-pier concept crops |
| `LICENSE.txt` | Updated | — | Documents clean ship; kitbash note removed |

Stock Quaternius casuals use near-black stylized skin + blue shirt + brown shorts (pack defaults). That is intentional — not leftover kitbash.

Concept refs under `portraits/caribbean_chronicles_ref.png` and `refs/*` remain on disk for history only; select UI no longer uses them.

---

## Select screen

- Labels: **Male** / **Female**
- Desc: `Casual_Male` / `Casual_Female`
- `data-char` still `male` \| `female` → `localStorage['belizetrini_char']`

---

## Deploy

| Item | Value |
|------|-------|
| Target | `app13.nextaura.us` (`nextaura-app13-us`) |
| Version ID | `24fd6461-3dd2-443b-a501-1363c64cb847` |
| `/api/health` | 200 OK |
| Live | https://app13.nextaura.us |

```bash
unset CLOUDFLARE_API_TOKEN
cd /workspace/app13-caribcrime/cf-worker
PATH="/workspace/app23-nextaura-fit/cf-worker/node_modules/.bin:$PATH" wrangler deploy
```

### Verify

1. Hard refresh https://app13.nextaura.us  
2. Select **Female** → START → stock Casual_Female (no afro/bandana/hoops)  
3. Select **Male** → stock Casual_Male (no bandana/dog tags/backpack)  
4. Mount scooter/car — rider still visible  

---

## Git

| Item | Value |
|------|-------|
| Repo | https://github.com/mlopeznxtaura/belizetriniOPNWRLD.git |
| Branch | `main` |
| Commit SHA | `8594a53614d717a672b9cfdb3120be2ee58d8b2e` |
| Message | `Use clean Quaternius casuals; remove character kitbash.` |

---

## Not in this pass

- Day/night changes  
- Vehicle physics / cop AI / missions  
- Replacing Quaternius with custom Belize/Trinidad meshes  
