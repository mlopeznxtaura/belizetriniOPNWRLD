# Vehicle Physics + Air Kits — WW Pass Report

**Date:** 2026-09-22 PT  
**App:** belizetriniOPNWRLD · `app13.nextaura.us` (CF-direct)  
**Art bar:** Wind Waker / GameCube fake-env (LOCKED — no city densify this pass)

## Outcome

Playable loop: walk → **F** scooter/car → drive with momentum/slip/lean → exit → **F** plane or heli → fly → soft land → exit.

No capsule/yellow-box/neon-orb/box-limb placeholders. Quaternius GLTF player unchanged. No new npm deps.

## Files changed

| File | Change |
|------|--------|
| `public/js/vehicle.js` | Velocity-vector ground physics; plane/heli kits + air control; spawns; `vehicleLabel`; `park()` settle |
| `public/js/player.js` | Air-aware exit (ground drop); higher follow cam for air |
| `public/js/main.js` | HUD labels Plane/Helicopter; `park()` for idle fleet |
| `DEVPLAN.md` | Iteration V → IN PROGRESS notes only (WW art bar untouched) |

## Physics (ground)

- `velocity` Vector3 (not scalar-only); `speed` kept as longitudinal scalar
- Accel (W), brake (Space / S when moving forward), reverse (S near stop)
- Lateral grip/slip: cars/vans grip more than scooters (`grip` tune)
- Collision softens velocity into remaining motion (no hard rubber-band)
- Scooter lean / car body roll via `body` subgroup (`rollAmt`)

## Air vehicles

### Plane (low-poly kit)
Fuselage, wings + tips, tail fin/stabilizer, spinning prop, landing gear, cockpit glass, nav lights.

**Controls:** W/S throttle · A/D yaw · ArrowUp/Down or Space/Shift pitch  
Takeoff when speed ≳ stall and nose-up / high throttle · gravity when low throttle · alt clamp **0–80 m** · soft land y≈0

### Helicopter (low-poly kit)
Cabin, boom, main + tail rotors (spin), skids, glass bubble.

**Controls:** Space/Shift collective · W/S forward/back · A/D yaw · Q/E strafe-lite  
Hover bias toward `hoverCollective` · alt clamp **0–70 m** · soft land

## Spawns

| Type | Position (x, z) | Spot |
|------|-----------------|------|
| Plane | **-112, -52** | Belize waterfront / dock approach open pad |
| Heli | **168, -58** | POS waterfront warehouse pad |

Plus existing Belize/POS sedan/scooter/van fleet (unchanged layout).

## Enter / exit / HUD

- Same **F** + `nearestVehicle` (air grab radius ~7.5 m)
- Toast / prompt: `Sedan` / `Scooter` / `Van` / **`Plane`** / **`Helicopter`**
- Exit from air drops player to ground beside craft; abandoned air craft settle to pad via `park()`

## Camera

`_camCar`: air uses dist **16**, height **~7.5+**, slightly softer follow — same path as car cam.

## Deploy

| Item | Status |
|------|--------|
| `wrangler deploy` (cf-worker) | **OK** — 2026-09-22 PT |
| Version ID | `a4766b63-7114-408c-a71a-6499e7ef6eba` |
| Uploaded assets | `vehicle.js`, `player.js`, `main.js` |
| Live | https://app13.nextaura.us |
| `/api/health` | 200 OK |

**Note:** Env `CLOUDFLARE_API_TOKEN` on this box was a stale OAuth copy; deploy worked after `unset CLOUDFLARE_API_TOKEN` so wrangler refreshed from `~/.config/.wrangler/config/default.toml`.

### Redeploy command (if needed)

```bash
unset CLOUDFLARE_API_TOKEN
cd /workspace/app13-caribcrime/cf-worker
PATH="/workspace/app23-nextaura-fit/cf-worker/node_modules/.bin:$PATH" wrangler deploy
```

## Smoke (node, no browser)

- Fleet count 16 with plane + heli at spawn coords
- Plane liftoff + climb to alt cap + land to y=0
- Heli climb / strafe / alt clamp
- Sedan vs scooter lateral slip differs by grip

## Not in this pass

- City curb densify / facade variety (rejected by WW lock)
- Mission rewrites (prompts only for vehicle names)
- IBM/other-app DNS
