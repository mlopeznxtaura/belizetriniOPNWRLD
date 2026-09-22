# belizetriniOPNWRLD — production plan

Ship like a real studio: one meaningful vertical slice per iteration. Do not chase AAA in one pass.

## What we have now (baseline)

- Three.js WebGL2, night tropical Belize ↔ Trinidad box-built city
- Walk + drive, wanted, 6 fiction missions, agent `/api/drive`
- Live: `https://app13.nextaura.us` · repo public

Pain today: low density, placeholder geometry, empty streets, weak “2000-era city” read.

## Research note — sprites vs web (Sep 2026)

### What GTA III actually did
GTA III was **realtime 3D** (RenderWare): streamed city blocks, low-poly buildings/vehicles/peds, aggressive LOD and DVD streaming constrained by ~32MB PS2 RAM. It was **not** a 2D sprite open-world. Distant cheap impostors were explored (`CDummyPed`) and largely abandoned because they looked wrong without animation.

### What the browser can do well in 2026
| Approach | Fit for us | Notes |
|----------|------------|--------|
| **Keep Three.js WebGL2 world** | Yes — stay | Cinevva-style spikes show WebGL + `InstancedMesh` is enough for open-world *density* if draw calls and lights are budgeted. WebGPU is optional later, not a gate. |
| **Full 2D sprite engine (Phaser/Pixi)** | No for final feel | Top-down GTA1/2 vibe, not GTA3 third-person night city. Would throw away camera/drive feel we already have. |
| **Hybrid: 3D city + billboard/atlas crowds** | Strong for **peds / far props** | Atlas + one `InstancedMesh` + cylindrical billboard shader = thousands of agents / one draw call. Proven Three.js pattern. Good impostor *layer*, not the hero art path. |
| **Low-poly 3D kits (buildings, cars)** | Strong for **hero reads** | Matches real GTA3 craft: readable silhouettes, few materials, texture atlases, chunk streaming later. |
| **three-flatland / WebGPU TSL sprites** | Later R&D | Alpha, WebGPU-first. Too early as foundation. |

### Decision (locked for near-term)
1. **World + vehicles + player stay 3D** (low-poly, atlased textures).
2. **Pedestrians & distant clutter can be atlas billboards** once we need crowd density — after streets feel real.
3. **No engine rewrite.** Budget: draw calls, point lights, shadows, main-thread updates.
4. **Art pipeline:** one shared texture atlas, modular building kits, 3–5 car chassis — not unique mesh per prop.

## Art bar — Wind Waker / GameCube (locked 2026-09-22)

Marco: trick the player with a **fake environment**. World detail is low priority as long as it does not look stupid. Think Zelda Wind Waker on GameCube (~20MB headroom): big readable shapes, soft fog, few materials — not curb-prop density porn.

**Hero focus (ship this):**
1. Characters (Quaternius-level animated GLTF — already on player)
2. Vehicles that work as **one system**: cars, scooters, planes, helicopters
3. **Real physics** feel (momentum, grip/slip, gravity/lift for air) — not rubber arcade only
4. Enter/exit + camera that fits each mode

**Backdrop (keep cheap):**
- Stylized low-poly city + water + fog is enough
- Stop chasing Iteration A “district density” until rideables feel good
- Reject list still stands: no capsule player, yellow boxes, neon-orb lamps, box-limb humanoids

## Iteration roadmap

### Iteration A — City read (DEPRIORITIZED — WW fake-env only)
Goal: from “tech demo blocks” → “you’re in a Caribbean night district.”
- Road graph (lanes, intersections, sidewalks) for Belize + POS cores
- Building kit: 6–8 facade variants, roofs, balconies, neon signs (atlas)
- Prop scatter along curb (bins, stalls, barrels) via instancing
- Fog + tone so distant city collapses cleanly
- Exit criteria: still 50+ fps on mid laptop; screenshot pass looks denser at street level

### Iteration V — Vehicles & physics (IN PROGRESS — 2026-09-22)
Goal: one rideable system the player trusts.
- Shared controller: sedan / scooter / van on ground with **velocity vector**, accel/brake/reverse, lateral grip/slip, collision softens velocity
- Scooter lean; car body roll from steer/speed (body subgroup)
- Plane + helicopter kits (fuselage/wings/rotors/glass/gear) in same Vehicle class
- Air: throttle + pitch/yaw (plane); collective + strafe-lite (heli); gravity when low throttle; soft land y≈0; alt clamp ~80/70m
- Same F enter/exit + nearest-vehicle picker; HUD names Plane / Helicopter
- Spawns: plane Belize waterfront (-112,-52); heli POS pad (168,-58)
- Exit criteria: steal scooter → sedan → take off in plane or heli without mode feeling bolted on; no rubber-band collisions
- See `VEHICLE-PHYSICS-WW-REPORT.md`

### Iteration B — Traffic & life
- Car kits (sedan, scooter, van) with simple materials
- Ambient traffic on road graph; park cars as set dressing
- Billboard ped passers on sidewalks (atlas, 4–8 frames walk cycle)
- Exit criteria: idle 30s without mission still feels inhabited

### Iteration C — Feel / control
- Camera follow polish, suspension-ish car lean, collision that doesn’t rubber-band
- Audio bed (engine, night ambience) — one loop each, no library bloat
- Exit criteria: 2-minute drive Belize→bridge→POS feels intentional

### Iteration D — Mission craft
- Rewrite 2 missions with clearer staging, checkpoints, fail/retry
- Wanted AI that uses road graph instead of pure chase vectors
- Exit criteria: mission 1–2 feel designed, not waypoint scavenger

### Later (not now)
Chunk streaming, WebGPU, multiplayer, custom shaders beyond atlas/billboard, full skeletal peds.

## Working rules
- One iteration = one PR + redeploy app13
- Measure fps before/after on the same drive path
- Prefer atlas + instance over new materials
- Fiction only; no real crime tradecraft

## Iteration A art bar (locked Sep 2026)
- Player: Quaternius Casual_Male GLB (CC0) with Idle/Walk clips via GLTFLoader + AnimationMixer. Mixamo Soldier kept as fallback. No capsule/box humanoids.
- Vehicles: sedan / scooter / van kits with windshield glass, wheel+rim stacks, bumpers, body panels.
- City: explicit road graph, building kit with tropical paints + façade windows, rectangular streetlamp fixtures (no neon orbs).

