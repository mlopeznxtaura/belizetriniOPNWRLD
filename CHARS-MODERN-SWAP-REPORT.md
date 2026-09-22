# Characters Modern Swap — Report

**Date:** 2026-09-22 ~2:00 PM PT  
**App:** belizetriniOPNWRLD · https://app13.nextaura.us  
**Decision (LOCKED):** Remove from-scratch Blender **box-rig** player presentation. Ship **modern Mixamo humanoids** with Idle+Walk. Wind Waker = world only; characters ≠ WW/chibi/boxes.

## Outcome

| Check | Status |
|-------|--------|
| Box-rig male/female stopped as player presentation | **Done** — replaced GLBs + LICENSE; runtime comments updated |
| Male modern humanoid Idle+Walk | **Done** — Mixamo Soldier (Vanguard), clips Idle/Walk/Run |
| Female modern humanoid Idle+Walk | **Done** — Mixamo Erika Archer + Standing Idle + Walk merged |
| Select Male/Female wired | Unchanged paths `male.glb` / `female.glb` |
| Select thumbs = NEW model renders | Recaptured `thumb_male.png` / `thumb_female.png` |
| Ground-vehicle rider visible | Unchanged (still parented + Idle when no Sit) |
| City / vehicle physics / missions | Untouched |
| Deploy CF | Live — version id below |
| Git push origin main | SHA below |

Hard refresh recommended (`Cmd/Ctrl+Shift+R`).

---

## Sources & licenses

| File | Source | License |
|------|--------|---------|
| `male.glb` / `player.glb` | Mixamo **Soldier** via three.js `examples/models/gltf/Soldier.glb` (same bytes as local `soldier_mixamo.glb`) | Adobe Mixamo TOU — free personal/commercial use of downloaded characters & animations |
| `female.glb` | Mixamo **Erika Archer** skinned FBX + `Standing Idle-Female` + `Walking-Female` (anim-only), merged with Blender 4.3 (`tools/char_build/merge_mixamo_female.py`). FBX mirror: Rokojori/winter-tales Mixamo asset tree | Adobe Mixamo TOU |
| Thumbs | In-engine WebGL captures of the new GLBs | Project UI |

**Not used:** Blender box-rig (`tools/char_build` cube pipeline), Quaternius Casual plate faces, concept-PNG “downloads”.

### Asset digests (local = live)

| Asset | Bytes | SHA-256 |
|-------|------:|---------|
| `male.glb` / `player.glb` | 2 160 468 | `dfb230fc1f942f259dd00281a1186953ad602fc5d69067ce63e24b2aa439736b` |
| `female.glb` | 8 490 848 | `5a59628ae3251cfb75ab8a6c6e06d2c54f577e1f4c9fe79104ad5aa37cfd23dd` |

Clips verified live: male `Idle, Run, TPose, Walk` · female `Idle, Walk`.

---

## Integrate

| File | Change |
|------|--------|
| `public/assets/characters/male.glb` | Soldier Mixamo (replaces box-rig) |
| `public/assets/characters/player.glb` | Alias of male |
| `public/assets/characters/female.glb` | Erika + Idle/Walk merge (texture-optimized ~8.1 MB, no Draco) |
| `public/assets/characters/LICENSE.txt` | Documents Mixamo sources |
| `public/assets/characters/portraits/thumb_*.png` | Recaptured from new GLBs |
| `public/js/player.js` | Comments; Z-up→Y-up orient guard before height normalize |
| `public/index.html` | Select alts mention Mixamo |
| `tools/char_build/merge_mixamo_female.py` | Merge pipeline |
| `tools/thumb-capture.html` | Orient + female facing |

`CHAR_PATHS` unchanged. Mixer still resolves Idle/Walk case-insensitively. Rider path unchanged.

---

## Deploy

| Item | Value |
|------|-------|
| Target | `app13.nextaura.us` (`nextaura-app13-us`) |
| Version ID | `59a214c6-6847-4fbd-be6b-40bf084919a2` |
| `/api/health` | 200 `{"ok":true,...}` |
| Live | https://app13.nextaura.us |

```bash
unset CLOUDFLARE_API_TOKEN
cd /workspace/app13-caribcrime/cf-worker
PATH="/workspace/app23-nextaura-fit/cf-worker/node_modules/.bin:$PATH" wrangler deploy
```

### Verify

1. Hard refresh https://app13.nextaura.us  
2. Select thumbs: tactical Soldier male · hooded Erika female (not stacked cubes)  
3. START Male — Idle/Walk on WASD  
4. START Female — Idle/Walk  
5. Mount scooter/car — rider still visible  

---

## Git

| Item | Value |
|------|-------|
| Repo | https://github.com/mlopeznxtaura/belizetriniOPNWRLD.git |
| Branch | `main` |
| Commit SHA | `6e6faf7b02245489799b9a5a7df212bd64e3f467` |
| Message | `Swap box-rig chars for Mixamo Soldier + Erika Idle/Walk.` |

---

## Known limitations

- Male is **military Vanguard** (helmeted), not civilian Caribbean streetwear.  
- Female is Mixamo **Erika Archer** (fantasy hood/quiver), not jeans/tee civilian — still a textured modern humanoid vs boxes.  
- Skin tones are Mixamo defaults (not specially darkened); preferable to kitbash theater.  
- `xbot.glb` / `soldier_mixamo.glb` remain on disk as optional fallbacks.  
- Box-rig blends under `tools/char_build/out/` are leftover build artifacts only — not presented in-game.

## Not in this pass

- City densification, vehicle physics, missions, day/night, civilian wardrobe kitbash  
