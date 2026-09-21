# belizetriniOPNWRLD (app13)

Fiction open-world browser crime game inspired by GTA3-era style.
**Belize City ↔ Port of Spain (Trinidad)** on one map.

Dark neon tropical night · walk & drive · wanted stars · 6-mission story.

> Adult fiction entertainment. No real cartels, addresses, or crime how-to. Stylized non-graphic violence.

## Quick start

```bash
cd /workspace/belizetrini-opnwrld
npm install
npm start
# → http://localhost:8080
```

`PORT` env supported (default **8080**).

### Docker

```bash
docker build -t belizetrini-opnwrld .
docker run -p 8080:8080 -e PORT=8080 belizetrini-opnwrld
```

## Controls

| Key | Action |
|-----|--------|
| WASD | Move / drive |
| Mouse | Look (pointer lock) |
| F | Enter/exit vehicle · mission interact |
| Space | Brake |
| P / Esc | Pause |

Mobile: on-screen stick + F / Brake buttons when touch detected.

## Missions

1. **Scooter Snatch** — Steal scooter at Belikin docks  
2. **Queen Street Pickup** — Package at market  
3. **Creek Drop** — Deliver to boat at Haulover Creek  
4. **Rival Intercept** — Intercept courier in Port of Spain  
5. **Warehouse Soft Hit** — Soft-hit warehouse guard (NPC despawns)  
6. **Safehouse Run** — Escape to hillside safehouse with heat  

## Agent drive API (NextAura)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/agent.json` | Full contract (+ live fields) |
| GET | `/agent.txt` | Plain discovery |
| GET | `/.well-known/agent.json` | Well-known |
| GET | `/llms.txt` | LLM summary |
| GET | `/robots.txt` | Robots |
| GET | `/sitemap.xml` | Sitemap |
| GET | `/api/health` | `{ ok, device, running }` |
| GET | `/api/status` | Live game snapshot |
| POST | `/api/drive` | Drive session |
| GET | `/api/drive/poll` | Browser polls queued actions |
| POST | `/api/state-sync` | Browser → server state |

### Drive actions

```json
{ "action": "start_mission" }
{ "action": "set_mission", "missionId": 3 }
{ "action": "give_cash", "amount": 1000 }
{ "action": "clear_wanted" }
{ "action": "set_wanted", "stars": 2 }
{ "action": "teleport", "district": "trinidad" }
{ "action": "teleport", "x": -95, "z": -28 }
{ "action": "spawn_car" }
{ "action": "pause" }
{ "action": "resume" }
{ "action": "heal" }
```

Keep a browser tab on `/` so the client can poll and apply drive actions.

## Stack

- Express (`server.js`) — static + in-memory API  
- Three.js 0.170 vendored at `public/vendor/three/` (import map; also in package.json)  
- Vanilla JS modules under `public/js/`  

## Layout

```
belizetrini-opnwrld/
  package.json
  server.js
  Dockerfile
  README.md
  public/
    index.html
    css/style.css
    js/{main,world,player,vehicle,missions,hud,ai,drive}.js
    agent.json, agent.txt, llms.txt, robots.txt, sitemap.xml
    .well-known/agent.json
```
