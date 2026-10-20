# good-1+11 — Streaming chunk world + Belize City expansion

**Goal:** Grow the world with streamed chunks and instanced props, starting with a much larger Belize City, iPhone-safe and shippable on its own.

**Base:** good-1+10 (`5d0a85d`).

## Changes
- `public/js/chunks.js`: 160 m chunk grid streamed by player distance. Ring radius per preset (low 180 m, medium 240, high 330, ultra 420), 48 m hysteresis, per-frame build budget (2.5–5 ms by preset), about 6–12 draw calls per chunk (merged vertex-colour meshes, instanced props, merged outlines), a close detail radius for props/outlines, full GPU disposal on unload, one merged far-LOD silhouette per district. `?chunks=0` turns it off.
- `districts.js`, `kit.js`: new Canal Lanes (west), Northside and Fort George districts (384 buildings). Haulover Creek with a swing bridge and three truss bridges, Collet Canal with five crossings, stilt houses with water tanks and fences, Queen St market hall and stall plaza, lighthouse, water-taxi terminal and piers, moored boats.
- A single camera-following ocean replaces the old water planes; the creek and canal get calm water.
- Gameplay: spatial-grid building collisions, ground units blocked from water, expanded world/aircraft bounds, police line of sight includes the new buildings, minimap draws land, district names from position, 4 new parked vehicles. The road graph is one connected network: 164 nodes, 62 joins at chunk borders.
- Tools: `chunk-test.js`, `chunk-bench.mjs`, `road-graph-check.mjs`, `world-map.mjs/.py`, `aerial-annotate.py`.

## Verification (headless, software GL; ms are relative, not device numbers)
Draw calls / triangles / frame ms at fixed spots, Chromium:

| spot | low calls / tris / ms | medium calls / tris / ms | high calls / tris / ms |
|---|---|---|---|
| queen | 195 / 69,966 / 85.2 | 217 / 132,930 / 104.5 | 227 / 144,574 / 237.7 |
| canal | 106 / 125,184 / 73.2 | 120 / 173,120 / 91.2 | 122 / 182,278 / 241.3 |
| swing | 98 / 95,360 / 69.6 | 125 / 186,068 / 93.1 | 134 / 194,532 / 227.7 |
| fort | 70 / 40,586 / 48.7 | 72 / 47,454 / 54.6 | 71 / 53,410 / 122.1 |
| lanes | 111 / 130,186 / 71.1 | 119 / 153,782 / 81.5 | 137 / 207,056 / 240.1 |
| market | 241 / 98,798 / 81.8 | 340 / 129,812 / 96.6 | 408 / 140,442 / 227.8 |
| harbour | 146 / 80,576 / 66.4 | 259 / 127,696 / 85.4 | 271 / 150,038 / 216.5 |

errors: {"low": [], "medium": [], "high": []}

| WebKit iPhone (844x390, low) spot | calls | tris | frame ms |
|---|---|---|---|
| queen | 200 | 71,708 | 29 |
| lanes | 111 | 130,186 | 35 |
| swing | 100 | 97,222 | 29 |
| harbour | 152 | 80,692 | 26 |
errors: []


- Drive across chunk borders (low/medium/high, plus WebKit iPhone low): 17–21 chunks loaded and unloaded per run, none aborted. Streamed GPU geometries return to 0 after leaving and none are orphaned; total geometries return to baseline apart from 3–5 non-chunk game objects first drawn during the drive.
- Build-step spikes reached 6–9.5 ms in this shared-CPU sandbox against a 2.5–4 ms budget; 5–28 frames per drive exceeded budget + 1 ms. One shader compile mid-drive comes from the existing hour-17 dusk transition, not chunks.
- WebKit iPhone low drive: median 56 ms, p95 99 ms (emulated, software GL).
- Old capture spots: Queen St high 166 → 183 calls (Northside now visible behind it); Causeway high 252 → 230.
- Regression suites at 0 errors: smoke (both characters), HUD overlap (0), all 6 missions incl. retry/progress, audio, wanted, batching.
- Evidence: `docs/fidelity/good-1+11/` (spot captures, drive JSON, aerial + annotated aerial, schematic map, road graph).

## Limits
- Not checked on a physical iPhone. Watch for hitches when entering a new chunk, and Queen St market at high (408 calls).
- Build-step time slicing could be finer if real devices show stutters.
