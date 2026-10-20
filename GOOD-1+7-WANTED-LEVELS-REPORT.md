# good-1+7: Wanted levels, 1–5 stars

- **Goal:** a proper 1–5 star system.
  - Crimes add heat.
  - Heat decays out of sight: line of sight, a search radius, a cooldown, and flashing HUD stars.
  - Each star escalates the pursuit: foot cop → patrol cars → roadblocks → ramming + an AI heli with a spotlight → max units + spike strips.
  - Pursuit uses the road graph.
  - Agent `set_wanted` / `clear_wanted` keep working.
  - Stylised, non-graphic fiction.
- **Base:** `db80872` (good-1+6)
- **Deployed:** no

## What the old logic was
- `game.wanted` was an integer that only went up: +1 for taking a car within 18 m of a cop, plus the mission soft-hits.
- It dropped one star after 25 s with no cop within 45 m.
- All 8 patrol boxes drove straight at the player whenever wanted was above 0, at every star level alike.

## What changed
### `public/js/wanted.js` (new): `WantedSystem`
**Heat**
- A float from 0 to 5.99; stars = floor(heat). `game.wanted` is now a getter/setter on it, so old callers keep working.
- Crimes (`CRIME_HEAT`). Each type has a cooldown so one act counts once:
  - car theft 1.0
  - hitting a pedestrian (mission NPC) with a car 0.7
  - ramming a cop above 6 m/s 1.2
  - mission soft-hit 2.0
- **Witnessed** (a cop or unit within 35 m) gives full heat; unwitnessed gives half.

**Sight**
- The player is seen while any unit or patrol is within the sight radius (32/40/48/56/64 m by star) **and** has line of sight, or while the player stands in the heli spotlight pool.
- Line of sight is a 2-D slab test against the building colliders (`hasLOS`).
- Seen → the last-known position (LKP) is refreshed and the escape timer resets.

**Escape**
- Out of sight, a search timer runs: **8 / 11 / 14 / 17 / 20 s** to drop one star at 1–5★.
- It runs **×2 once the player is outside the search radius** around the LKP (45–110 m).
- After each drop the timer restarts at the new level.
- **The HUD stars flash** while the cops are searching (`.star.on.flash`, a stepped blink).

**Escalation**
Target counts per star are kept topped up at one spawn per 0.4 s; extras stand down farthest-first.

| ★ | foot | cars | roadblocks | heli | spikes |
|---|---|---|---|---|---|
| 1 | 1 | – | – | – | – |
| 2 | 1 | 2 | – | – | – |
| 3 | 2 | 3 | 1 | – | – |
| 4 | 2 | 4 (ramming) | 1 | 1 | – |
| 5 | 2 | 6 | 2 | 1 | 2 |

**Units**
- **Foot cop:** blocky uniform with a cap and badge, legs swinging from the hip. Runs at 6.2 m/s toward the player (the LKP when unseen). A tackle is arcade damage, on foot only.
- **Pursuit car:** the cruiser mesh. Follows an **A\* path on a road graph** built from `world.roads` (endpoints + intersections, re-pathed every 1.5 s) until within 26 m, then steers direct. Speed rises with stars.
  - **4★+ ramming:** leads the target by its velocity, ×1.35 speed, and an impact knocks the player's car sideways and bleeds its speed.
- **Roadblock:** two cruisers nose to nose plus a striped barrier, across the road at a graph node 45–110 m **ahead** of the player's heading. It adds a wall collider to `world.colliders` and removes it when it is recycled.
- **Spike strip:** 30–75 m ahead across the road. Driving over it blows the tyres for 4 s (speed bleeds to about 35 % per second).
- **Heli:** the player's heli kit (`Vehicle('heli')`), AI-flown. It circles the player at 26 m with rotors turning.
  - Its "spotlight" is an additive cone plus a ground pool, **not a real light**, so lit materials do not need recompiling and mobile pays no extra light cost. The pool lags the player, so you can slip out of it.
- Units left far behind (130–170 m) are recycled and respawn on road nodes out of view.

### Integration
- `main.js`:
  - patrol cops now only patrol and witness
  - damage comes from pursuit units
  - car theft calls `crime('carTheft')` (mission 1's scooter is excluded, since its heat comes from the mission)
  - the minimap shows pursuit units
  - blob shadows cover foot cops, pursuit cars and the heli
- `missions.js`: soft-hits use `addWanted(2, 'softHit')`; Safehouse/mission 6 set or clear the stars through the setter.
- `drive.js`: `set_wanted` (0–5) and `clear_wanted` call `wantedSys.setStars()`. The state sync now carries a `wantedState` block (stars, heat, seen, search timer, unit counts).
- `hud.js` + `style.css`: `setWanted(stars, flashing)`.

## Verification (`docs/fidelity/good-1+7/`)
The tool is `tools/wanted-test.js`: iPhone emulation 390×844 @3, **low preset**, governor off. Data: `wanted_{chromium,webkit}.json`.

**Units per star**, set through the agent action `set_wanted`, counted after 6 s:

| ★ | Chromium | WebKit | HUD stars lit |
|---|---|---|---|
| 1 | foot 1 | foot 1 | 1 |
| 2 | foot 1, car 2 | same | 2 |
| 3 | foot 2, car 3, roadblock 1 | same | 3 |
| 4 | foot 2, car 4, roadblock 1, heli 1 | same | 4 |
| 5 | foot 2, car 6, **roadblock 2, heli 1, spikes 2** (13) | foot 2, car 6, roadblock 2, heli 1 at 5 s; 13 incl. spikes a few seconds later | 5 |

**`clear_wanted`:** 0 stars, 0 units, 0 HUD stars.

**Crimes**
- car theft with a cop 10 m away → heat 1.0 (1★)
- car theft unwitnessed → 0.5
- ramming a patrol car at 12 m/s → 1.2 (1★)
- mission 5 guard soft-hit → 2.0 (2★)

**Escape timing** (game seconds, units frozen by the test hook `wantedSys.freezeUnits`, player out of sight)

| case | expected | Chromium | WebKit |
|---|---|---|---|
| 2★, inside search radius | 11 s → 1★, then 8 s → 0★ | **11.08 s, 19.05 s** (earlier run 11.12 / 19.19) | 11.0 s (the second drop fell outside the 50 s wall-clock window: WebKit runs about 6 fps, so game time is slow) |
| 2★, outside radius (×2) | 5.5 s, then 4 s | **5.67 s, 9.64 s** | **5.55 s, 9.60 s** |

- The HUD flashed during the search in all cases.
- **Seen → no decay:** a unit 6 m away in plain sight for 12 s kept 1★, searchT 0, no flashing.

**Frame cost at 5★, iPhone low preset** (median of 15 GPU-synced renders)

| | 0★ | 5★ (13 units) |
|---|---|---|
| Chromium | 50–52 ms, 103 calls | 54–56 ms in 2 runs, **84 ms in 1 run** (heli cone close to the camera: full-screen additive fill); 151–163 calls |
| WebKit | 26 ms | 29 ms |

**Other checks**
- Screenshots: `{chromium,webkit}_star3/4/5*.png`; `compare_stars.png` is also at `/workspace/work/app13-good1-7.png`.
  - 3★: a roadblock down Queen St.
  - 5★: a ramming cruiser, foot cops, a spike strip across the road, the heli pool.
- **0 page errors** in both engines.
- Smoke test (male, `?quality=high`): 0 errors; walk 2.59, sprint 7.55, drove 6.8, exited.

## Known limits
- **The heli spotlight cone can fill the screen when the heli passes near the camera** (the 84 ms sample). A low-preset option to drop the cone and keep only the pool would fix it; not done.
- **Pursuit cars are kinematic.** They steer and collide with buildings but not with each other or with traffic. Ramming is an impulse on the player's car, not a physics contact.
- **Roadblocks are placed at graph nodes (intersections).** On long straight roads the nearest block can be 100 m off. Roadblock cars are decor, behind a static wall collider.
- **There are no pedestrians in the world yet.** "Hitting peds" is wired to mission NPCs (the courier and guard), so it fires only during missions 4 and 5.
- **Game time slows below 20 fps** (the existing dt clamp of 0.05 s). Escape timers are exact in game time but longer in wall time on very slow devices.
- **The iPhone portrait HUD overlaps** (wanted stars under the pause button, mission card over the clock). Fixed in the next tag, good-1+8.
