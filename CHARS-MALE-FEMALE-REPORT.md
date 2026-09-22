# Male + Female Characters — Report

**Date:** 2026-09-22 PT  
**App:** belizetriniOPNWRLD · https://app13.nextaura.us  
**Scope:** 2 playable characters (1 male + 1 female), character select, ground-vehicle rider visibility. No time-of-day. No cop-crash physics.

## Outcome

- Select **Male** or **Female** on the start screen → persists `localStorage.belizetrini_char` (default `male`).
- Quaternius CC0 GLBs with Idle + Walk load from `male.glb` / `female.glb` (`player.glb` kept as male alias/fallback).
- Caribbean-readable skin + shirt tint + afro/bandana accessories kitbashed at runtime to approach Marco’s Caribbean Chronicles portrait vibe.
- Mounting scooter/sedan/van **keeps the rider mesh visible** (parented to vehicle body, SitDown when available). Plane/heli still hide the on-foot mesh.

## Portrait / look reference

| Source | Path / note |
|--------|-------------|
| Requested “portrait sheet” | `/home/box/.../attachments/bee192b2….png` — **not a 2×3 bust grid**; it is an **app13 gameplay screenshot** (HUD/minimap crops). Documented gap. |
| Primary look target used | Caribbean Chronicles concept poster `…/b26324371….png` (and copies under `public/assets/characters/portraits/caribbean_chronicles_ref.png`) |
| Select thumbnails | `portraits/thumb_male.png` — left male (red bandana, tank) crop · `portraits/thumb_female.png` — center female (rounded afro, tactical/camo) crop |

**Matched “cells” (concept poster, not Quaternius mesh identity):**

1. **Male** — left hero: deep brown skin, red bandana, light tank.  
2. **Female** — center hero: deep brown skin, large rounded afro, olive/tactical shirt energy.

Exact Quaternius mesh identity for those illustrated faces/hair does **not** exist in the Ultimate Animated Character Pack. Closest CC0 full-body animated bases used: **Casual_Male** + **Casual_Female**, then kitbashed.

## Assets

| File | Source | License | Size |
|------|--------|---------|------|
| `public/assets/characters/male.glb` | Quaternius Ultimate Animated Character Pack — Casual_Male (FBX→GLB via FBX2glTF) | CC0 | ~628 KB |
| `public/assets/characters/female.glb` | Same pack — Casual_Female | CC0 | ~641 KB |
| `public/assets/characters/player.glb` | Alias of male.glb (fallback) | CC0 | ~628 KB |
| `portraits/thumb_*.png` | Crops from Marco’s Caribbean Chronicles concept | User ref (UI only) | — |
| LICENSE | `public/assets/characters/LICENSE.txt` | — | — |

**Clips (both):** Idle, Walk, SitDown, (+ Punch, Victory, etc.). Mixer resolves Idle/Walk case-insensitively; SitDown used when seated.

## Implementation

| File | Change |
|------|--------|
| `public/js/player.js` | `CHAR_KEY` / paths; `_loadCharacter` uses selected GLB; portrait kitbash; `enterVehicle` seats on ground vehicles (no hide); air still hides |
| `public/js/main.js` | Char-select wiring; reload char on Start |
| `public/index.html` | Male/Female cards with portrait thumbs |
| `public/css/style.css` | Char-select card styles |
| Assets | male.glb, female.glb, portraits/* |

### How to select

1. Hard refresh https://app13.nextaura.us  
2. Click **Male** or **Female** card (thumbs from concept poster).  
3. **START GAME** — choice saved in `localStorage['belizetrini_char']`.  
4. Change anytime on the title screen before start (re-click a card).

### Rider visibility

- Ground (`scooter` / `sedan` / `van`): character stays visible, parented to `vehicle.body`, seat offset + SitDown.  
- Air (`plane` / `heli`): root hidden (cockpit). Exit restores on-foot mesh.

## Deploy

| Item | Status |
|------|--------|
| Target | `app13.nextaura.us` (cf-worker `nextaura-app13-us`) |
| Version ID | `324c0ea5-c016-45de-b370-4eeb6a741e57` |
| Live | https://app13.nextaura.us |
| `/api/health` | 200 OK |
| Assets | `male.glb`, `female.glb`, thumbs, `player.js`, `main.js`, `index.html`, CSS |

**Redeploy:**
```bash
unset CLOUDFLARE_API_TOKEN
cd /workspace/app13-caribcrime/cf-worker
PATH="/workspace/app23-nextaura-fit/cf-worker/node_modules/.bin:$PATH" wrangler deploy
```

## Honest gaps

- No authentic Quaternius “afro female / bandana male” GLB identity in the local Ultimate pack; kitbash approximates silhouette + colors.
- Concept art is comic-GTA, in-game is low-poly Quaternius — faces will not match illustration pixel-for-pixel.
- Requested bee192 “2×3 portrait sheet” file was a night-city screenshot; thumbs come from Caribbean Chronicles poster instead.

## Not in this pass

- Time-of-day system
- Cop crash / vehicle physics rewrite
- Exact Universal Base Characters pack download (itch/Drive; not fetched this pass)
