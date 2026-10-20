# good-1+9: Data-driven mission template, checkpoints, retry, mission-complete screen, saved progress

- **Goal:**
  - Refactor `missions.js` into a data-driven template, with stages goto / pickup / deliver / chase / survive-wanted / escape. Each stage carries objectives, markers, timers, fail conditions and checkpoint saves.
  - Port the 6 missions onto it.
  - Add retry-from-checkpoint on fail, a mission-complete screen, and localStorage progress.
  - The agent actions `start_mission` / `set_mission` must keep working.
- **Base:** `b62fc3e` (good-1+8)
- **Deployed:** no

## What changed
### `public/js/missions.js` (rewritten)
**Mission shape:** `MISSIONS` is pure data: `{ id, name, brief, reward, setup?, stages[] }`.

**Stage types**

| type | what the player does |
|---|---|
| `goto` | reach a marker; optionally press F there (`interact`) |
| `pickup` | press F on an item, or get into a vehicle of a given type |
| `deliver` | press F with the item; fails if the item is gone |
| `chase` | catch an NPC courier that runs from the player (F); fails beyond `escapeRadius` |
| `takedown` | arcade soft-hit on a stationary NPC (F). This type was added beyond the brief's list, because mission 5's guard needs it. |
| `survive` | stay alive for N s with at least N stars |
| `escape` | lose the wanted level. `minStars` is re-applied on entry, so a retry is a real escape. |

**Common stage fields**
- `text`: the objective, shown in the HUD as "Name · n/N"
- `marker`: the world blip; for chase/takedown the minimap tracks the NPC instead
- `timer`: a HUD countdown that turns red under 10 s
- `checkpoint`
- `onDone`: `{heat, why}` through the wanted system, or `{clearWanted}`

**Fail conditions:** out of time, wasted (`main._respawn` → `missions.onWasted()`), courier got away, item lost.

**Checkpoints**
- Saved on entry to a `checkpoint` stage: stage index, player position, items, mission clock.
- **Retry from checkpoint** puts the player back at that stage and position and clears leftover heat; the stage re-applies the stars it needs.
- **Restart mission** goes back to stage 1.
- New agent action **`retry_mission`**.

**Screens**
- **Fail:** reason, plus a "Retry from checkpoint (stage n)" button and a "Restart mission" button.
- **Mission complete:** reward (first clear only), time and best time, "n / 6 missions", and Continue. It auto-continues after 3.5 s.

**Progress** (`localStorage['bto.progress.v1']`)
- Saves: completed missions, cash, current mission and stage, the last checkpoint, best times.
- `beginPlay()` now calls `missions.resume()`, which restores cash and continues the current mission from its checkpoint, or shows "Story complete".
- `?fresh=1` wipes the saved progress.

**The 6 missions on the template**
1. Scooter Snatch: goto docks ✓cp → take the scooter (+1★) → lose the heat (90 s) ✓cp
2. Queen Street Pickup: goto market ✓cp → pick up the package (F)
3. Creek Drop: deliver the package (120 s, F) ✓cp (+1★) → lose the heat (90 s)
4. Rival Intercept: goto downtown ✓cp → chase the fleeing courier (60 s, F, +2★) → lose the heat ✓cp
5. Warehouse Soft Hit: goto warehouse ✓cp → soft-hit the guard (+2★) → lose the heat ✓cp
6. Safehouse Run: survive 3★ for 20 s ✓cp → reach the safehouse and press F (120 s; clears the heat)

Missions 1, 3, 4 and 5 now end with an "escape" stage. Before, they simply finished and handed out stars.

### Other files
- **`index.html` / `style.css` / `hud.js`:** the fail and complete overlays (inside the safe area), and `#mission-timer` with `hud.setMissionTimer()`.
- **`main.js`:**
  - resume on START
  - the minimap blip comes from `missions.blipPos()`
  - the vehicle prompt is hidden while a mission prompt shows (replaces the hard-coded mission-id list)
  - the car-theft exclusion now keys on the current pickup-vehicle stage
  - wasted fails the mission
- **`drive.js`:**
  - `retry_mission`
  - the state sync carries a `mission` block (id, stage, type, state, checkpoint, completed)
  - `set_wanted` also accepts `wanted`
- **`server.js` / `cf-worker/worker.js`:**
  - `retry_mission` is allowed
  - `mission` appears in `/api/status`
  - **Worker fix:** the Cloudflare worker used to forward `set_wanted` as `{wanted}`, which the client ignored. It now sends `stars`, so `set_wanted` works on the live deploy.

## Verification (`docs/fidelity/good-1+9/`)
The tool is `tools/mission-test.js`: iPhone emulation, low preset, Chromium **and** WebKit. Data: `missions_{chromium,webkit}.json`. It plays every stage through agent and teleport hooks:
- `set_mission`
- teleport to the marker or NPC
- `game._onInteract()` (the real F path)
- entering the real scooter
- `debugAdvance` for the survive stage
- `clear_wanted` for escapes

| check | Chromium | WebKit |
|---|---|---|
| M1 goto→pickup(scooter)→escape | complete, $200 | same |
| M2 goto→pickup | complete, $550 | same |
| M3 deliver→escape | complete, $1,050 | same |
| M4 goto→chase→escape | complete, $1,750 | same |
| M5 goto→takedown→escape | complete, $2,650 | same |
| M6 survive→goto(F) | complete, $4,150 → "Story complete", `current: null` saved | same |
| complete screen shown after every mission | yes | yes |
| **Forced fail 1:** M3 timer (`debugAdvance 121`) | fail screen "Out of time"; Retry from checkpoint → stage 1 active, **package restored**; replayed to complete | same |
| **Forced fail 2:** wasted on M5's escape stage | fail screen "Wasted", button "Retry from checkpoint (stage 3)"; agent `retry_mission` → **resumed at stage 3** (not stage 1) with **2★ re-applied**; escaped → complete | same |
| **Persistence:** reach M4 stage 3 (checkpoint), reload with no `?fresh` | before `[M4, stage 3, completed 1–6, $4,150, pos (145.3, 11.2)]` → after reload **identical**, wanted 2 re-applied | identical |
| page errors | **0** | **0** |

**Other checks**
- **HUD overlap re-check** with the timer line and new overlays (`hud/`): 0 overlaps in Chromium and in WebKit, across all 7 layouts.
- **Smoke test** (male, auto): 0 errors; walk 2.6, drove 1.5, exited. Sprint reads 0: the known low-preset wall collider.
- **Screenshots:** `compare_missions.png` (also at `/workspace/work/app13-good1-9.png`) shows complete, fail and resumed. The others are `*_complete_m1/m6.png`, `*_fail_timer.png`, `*_fail_wasted.png`, `*_resumed.png`.
  - The timer label became "TIME m:ss" / "HOLD m:ss" after these shots: the stopwatch emoji rendered as a box in headless fonts.

## Known limits
- **Stages are verified through hooks, not by driving a route.** Timers are generous estimates, not tuned by playtest.
- **The chase courier runs in a straight line** away from the player, with building collision. There is no path-following.
- **Progress is per browser** (localStorage). Clearing site data or private mode starts over. There is no cloud save.
- **Rewards are paid on first clear only.** Replays show "Replay — no reward".
