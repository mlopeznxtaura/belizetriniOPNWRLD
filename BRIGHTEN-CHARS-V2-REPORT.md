# Brighten + Characters v2 — Report

**Date:** 2026-09-22 ~1:02 PM PT  
**App:** belizetriniOPNWRLD · https://app13.nextaura.us  
**Scope:** (1) Time-of-day lighting — kill night-lock. (2) Characters v2 to sunny Belize/Trinidad refs. No cop-crash physics.

## Outcome

| Item | Status |
|------|--------|
| Night lock removed | Done — default start **16:30 golden hour** |
| Day ↔ dusk ↔ night lerp | Done — ~**5 real minutes** full cycle |
| HUD clock | Done — `☀/🌤/☾ HH:MM` centered top |
| Scrub / pause clock | Done — `[` `]` ±45 min · `T` pause clock |
| Characters match sunny pier refs | Kitbashed on Quaternius CC0 (FBX links fake) |
| Select thumbs | Crops of **sunny pair** ref (not Chronicles poster) |
| Idle/Walk + localStorage + rider visible | Kept |
| Deploy | Live — version `775b2872-f241-4021-a6b7-5f9ceba85d10` |

Hard-refresh recommended (CDN may cache `/js/*.js` without query string).

---

## 1) Lighting + time of day

### Was (night lock ~world.js 857–865)
- AmbientLight `0x1a2838` @ 0.35  
- HemisphereLight `0x1e2850` / `0x0a1810` @ 0.55  
- DirectionalLight moon `0x9eb6ff` @ 0.35  
- FogExp2 + background `0x06061a` @ density `0.0095`

### Now
`createDayNight(scene, realLights, mats)` in `public/js/world.js`:

- **Game clock** advances continuously (title screen + play). Full day ≈ **5 minutes** real time.
- **Default hour = 16.5** (late afternoon / golden hour) — first load is **not** pitch black.
- Keyframe lerp: night → dawn (orange) → day (bright Caribbean blue sky, warm high sun, light fog) → golden → dusk (orange) → night.
- **Night is lifted** vs old crush: fog/bg ≈ `0x0c1028`–`0x0e1430`, density ≈ `0.006`, ambient ≈ 0.48–0.50, moon ≈ 0.4; street PointLights stay readable (`streetMul` ~1.1).
- Day: ambient ~0.78 warm, hemi sky cyan / ground green, sun ~1.55 overhead, fog density ~0.0024, bg Caribbean blue; street neon dimmed.
- Stars fade with daytime opacity.
- Water material color tracks TOD (turquoise day → deep night).
- Grass/water palette base nudged slightly greener/brighter (still Wind Waker fake-env — **no city densify**).

### HUD / controls
- `#tod-clock` — icon + `HH:MM`
- `[` / `]` scrub hour · `T` pause/resume day clock (independent of `P` game pause)
- Start toast: “Caribbean day cycle”

---

## 2) Characters v2

### Refs (copied into repo)
| File | Source |
|------|--------|
| `public/assets/characters/refs/sunny_pair_belize_trinidad.png` | Marco sunny male+female pier sheet |
| `public/assets/characters/refs/lighting_mood_bright.png` | Bright mood / asset mockup panel |
| `refs/male_belize_crop.png` / `female_trinidad_crop.png` | Working crops |
| `portraits/thumb_male.png` / `thumb_female.png` | Select UI — **crops of sunny pair** |

**Fake FBX:** `cdn.example.com/.../male_belizean.fbx` & `female_trinidadian.fbx` were **not** downloaded (conceptual only).

### Bases + kitbash
| Role | Base | Kitbash |
|------|------|---------|
| **Belize (male)** | Quaternius Casual_Male CC0 → `male.glb` | White tank, olive cargo shorts, tan boots, dog tags, backpack, short beard mesh. **No red bandana.** |
| **Trinidad (female)** | Quaternius Casual_Female CC0 → `female.glb` | Red crop shirt, olive shorts, curly updo + red/orange headband, gold hoops + pendant, backpack |

Select cards relabeled **Belize** / **Trinidad**.  
`localStorage['belizetrini_char']` still `male` | `female`.  
Ground vehicles: rider stays visible (SitDown). Air: hidden.

### Honest gaps
- Quaternius Casual mesh ≠ photoreal pier heroes; tattoos / ribbed knit / exact faces are approximate.
- No authentic CC0 “Belize fisherman / Trinidad explorer” GLB identity found; kitbash + colors + accessories are the match path.
- In-game still low-poly WW-style city under high sun.

---

## Files touched

| Path | Change |
|------|--------|
| `public/js/world.js` | `createDayNight`, default 16:30, return `dayNight` |
| `public/js/main.js` | Tick TOD, scrub keys, toast |
| `public/js/hud.js` | `setClock` |
| `public/js/player.js` | Sunny-ref kitbash v2 |
| `public/index.html` | Thumbs labels, `#tod-clock`, hints |
| `public/css/style.css` | Clock pill |
| `public/assets/characters/refs/*` | Ref copies |
| `public/assets/characters/portraits/thumb_*.png` | Sunny crops |
| `public/assets/characters/LICENSE.txt` | Updated |

---

## Deploy

| Item | Value |
|------|--------|
| Target | `app13.nextaura.us` (`nextaura-app13-us`) |
| Version ID | `775b2872-f241-4021-a6b7-5f9ceba85d10` |
| `/api/health` | 200 OK |
| Live | https://app13.nextaura.us |

```bash
unset CLOUDFLARE_API_TOKEN
cd /workspace/app13-caribcrime/cf-worker
PATH="/workspace/app23-nextaura-fit/cf-worker/node_modules/.bin:$PATH" wrangler deploy
```

### How to verify
1. Hard refresh https://app13.nextaura.us  
2. Title orbit should look **golden-hour / bright**, not black void.  
3. Pick Belize or Trinidad (sunny thumbs) → START.  
4. Watch HUD clock advance; `[` `]` scrub; wait or scrub into night — streetlamps readable, not crushed.  
5. Mount scooter/sedan/van — rider visible.

## Not in this pass
- Cop-crash / vehicle physics rewrite  
- Downloading non-existent mockup FBXs  
