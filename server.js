'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT) || 8080;
const PUBLIC = path.join(__dirname, 'public');

app.use(express.json({ limit: '256kb' }));

/** In-memory live game state — updated by browser client via POST /api/state-sync
 *  and driven by agents via POST /api/drive */
const gameState = {
  running: false,
  paused: false,
  missionId: 0,
  missionName: 'Not started',
  cash: 0,
  wanted: 0,
  health: 100,
  playerPos: { x: 0, y: 0, z: 0 },
  district: 'belize',
  inVehicle: false,
  vehicleId: null,
  startedAt: null,
  lastUpdate: null,
  pendingDrive: [], // queue of actions for the browser client to poll
};

function buildAgentJson(live = true) {
  const base = {
    schema_version: 1,
    app_id: 'app13',
    name: 'CARIB CRIME',
    title: 'CARIB CRIME — Reef Runners',
    subtitle: 'Belize ↔ Trinidad',
    host: 'app13.nextaura.us',
    purpose:
      'Fiction adult open-world browser crime game inspired by GTA3-era style. ' +
      'Player walks and drives across Belize City and Port of Spain districts, ' +
      'completes a 6-mission drug-trade story, manages wanted heat from cops. ' +
      'Agents can drive the session via /api/drive.',
    how_built:
      'Vanilla HTML/CSS/JS + Three.js (CDN/module). Express serves static files ' +
      'and in-memory JSON API for agent drive. Arcade vehicle physics, low-poly ' +
      'night tropical world, wanted stars, mission chain.',
    status: live ? (gameState.running ? 'running' : 'ready') : 'ready',
    content_note:
      'Fictional adult crime entertainment. No real cartels, addresses, or how-to. Stylized GTA3-era violence.',
    discovery: {
      agent_json: '/agent.json',
      agent_txt: '/agent.txt',
      well_known: '/.well-known/agent.json',
      llms_txt: '/llms.txt',
      robots_txt: '/robots.txt',
      sitemap: '/sitemap.xml',
    },
    api_endpoints: [
      { method: 'GET', path: '/api/health', description: 'Health check' },
      { method: 'GET', path: '/api/status', description: 'Live game state snapshot' },
      {
        method: 'POST',
        path: '/api/drive',
        description: 'Drive the game session',
        body: {
          action:
            'start_mission|set_mission|give_cash|clear_wanted|teleport|spawn_car|pause|resume|set_wanted|heal',
          missionId: 'number (optional)',
          amount: 'number (optional, cash)',
          x: 'number',
          y: 'number',
          z: 'number',
          district: 'belize|trinidad (optional)',
        },
      },
      {
        method: 'POST',
        path: '/api/state-sync',
        description: 'Browser client pushes live state (internal)',
      },
      {
        method: 'GET',
        path: '/api/drive/poll',
        description: 'Browser client polls pending drive actions',
      },
    ],
    agent_workflow: [
      '1. GET /api/health — confirm service up',
      '2. GET /api/status — read mission, cash, wanted, position, district',
      '3. POST /api/drive {"action":"start_mission"} or set_mission with missionId 1-6',
      '4. Optionally give_cash, clear_wanted, teleport, spawn_car, pause/resume',
      '5. Poll /api/status until mission advances or player reaches goal',
      '6. Open / in browser for human play; drive API works with tab open (poll loop)',
    ],
    missions: [
      { id: 1, name: 'Scooter Snatch', location: 'Belikin docks, Belize City' },
      { id: 2, name: 'Queen Street Pickup', location: 'Queen Street market' },
      { id: 3, name: 'Creek Drop', location: 'Haulover Creek boat' },
      { id: 4, name: 'Rival Intercept', location: 'Port of Spain downtown' },
      { id: 5, name: 'Warehouse Soft Hit', location: 'Trinidad warehouse district' },
      { id: 6, name: 'Safehouse Run', location: 'Belize hillside safehouse' },
    ],
    controls: {
      walk_drive: 'WASD',
      look: 'mouse (pointer lock)',
      brake: 'Space',
      enter_exit: 'F',
      pause: 'P / Esc',
    },
  };
  if (live) {
    base.live = {
      running: gameState.running,
      paused: gameState.paused,
      missionId: gameState.missionId,
      cash: gameState.cash,
      wanted: gameState.wanted,
      district: gameState.district,
      lastUpdate: gameState.lastUpdate,
    };
  }
  return base;
}

// —— Agent discovery ——
app.get('/agent.json', (_req, res) => {
  res.type('application/json').json(buildAgentJson(true));
});
app.get('/.well-known/agent.json', (_req, res) => {
  res.type('application/json').json(buildAgentJson(true));
});

app.get('/agent.txt', (_req, res) => {
  res.type('text/plain').send(
    [
      'CARIB CRIME — Reef Runners (app13)',
      'Host: app13.nextaura.us',
      'Purpose: Fiction open-world crime game Belize City ↔ Port of Spain',
      'Agent contract: /agent.json',
      'Health: GET /api/health',
      'Status: GET /api/status',
      'Drive: POST /api/drive',
      'Play: /',
    ].join('\n') + '\n'
  );
});

app.get('/llms.txt', (_req, res) => {
  res.type('text/plain').send(
    `# CARIB CRIME (app13)
> Fiction GTA3-inspired browser open-world. Belize ↔ Trinidad. Agents drive via /api/drive.

## Endpoints
- GET /agent.json — full contract
- GET /api/health — {ok, device, running}
- GET /api/status — live snapshot
- POST /api/drive — start_mission | set_mission | give_cash | clear_wanted | teleport | spawn_car | pause | resume

## Missions
1 Scooter Snatch (Belikin docks)
2 Queen Street Pickup
3 Creek Drop (Haulover Creek)
4 Rival Intercept (Port of Spain)
5 Warehouse Soft Hit
6 Safehouse Run

## Notes
Fictional adult crime entertainment. Stylized violence. No real cartel names.
`
  );
});

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n');
});

app.get('/sitemap.xml', (_req, res) => {
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://app13.nextaura.us/</loc></url>
  <url><loc>https://app13.nextaura.us/agent.json</loc></url>
  <url><loc>https://app13.nextaura.us/api/health</loc></url>
</urlset>
`);
});

// —— API ——
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    device: 'browser',
    running: gameState.running,
    app_id: 'app13',
    port: PORT,
  });
});

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    ...gameState,
    pendingDriveCount: gameState.pendingDrive.length,
  });
});

app.post('/api/state-sync', (req, res) => {
  const b = req.body || {};
  if (typeof b.running === 'boolean') gameState.running = b.running;
  if (typeof b.paused === 'boolean') gameState.paused = b.paused;
  if (typeof b.missionId === 'number') gameState.missionId = b.missionId;
  if (typeof b.missionName === 'string') gameState.missionName = b.missionName;
  if (typeof b.cash === 'number') gameState.cash = b.cash;
  if (typeof b.wanted === 'number') gameState.wanted = b.wanted;
  if (typeof b.health === 'number') gameState.health = b.health;
  if (b.playerPos && typeof b.playerPos === 'object') {
    gameState.playerPos = {
      x: Number(b.playerPos.x) || 0,
      y: Number(b.playerPos.y) || 0,
      z: Number(b.playerPos.z) || 0,
    };
  }
  if (typeof b.district === 'string') gameState.district = b.district;
  if (typeof b.inVehicle === 'boolean') gameState.inVehicle = b.inVehicle;
  gameState.lastUpdate = new Date().toISOString();
  if (gameState.running && !gameState.startedAt) {
    gameState.startedAt = gameState.lastUpdate;
  }
  res.json({ ok: true });
});

app.get('/api/drive/poll', (_req, res) => {
  const actions = gameState.pendingDrive.splice(0, gameState.pendingDrive.length);
  res.json({ ok: true, actions });
});

app.post('/api/drive', (req, res) => {
  const body = req.body || {};
  const action = String(body.action || '').trim();
  if (!action) {
    return res.status(400).json({ ok: false, error: 'action required' });
  }

  const allowed = new Set([
    'start_mission',
    'set_mission',
    'give_cash',
    'clear_wanted',
    'set_wanted',
    'teleport',
    'spawn_car',
    'pause',
    'resume',
    'heal',
  ]);
  if (!allowed.has(action)) {
    return res.status(400).json({ ok: false, error: 'unknown action', allowed: [...allowed] });
  }

  // Optimistic server-side bookkeeping for status reads before client applies
  if (action === 'give_cash') {
    gameState.cash += Number(body.amount) || 500;
  } else if (action === 'clear_wanted') {
    gameState.wanted = 0;
  } else if (action === 'set_wanted') {
    gameState.wanted = Math.max(0, Math.min(5, Number(body.stars) || Number(body.amount) || 0));
  } else if (action === 'heal') {
    gameState.health = 100;
  } else if (action === 'pause') {
    gameState.paused = true;
  } else if (action === 'resume') {
    gameState.paused = false;
  } else if (action === 'start_mission') {
    gameState.missionId = gameState.missionId > 0 ? gameState.missionId : 1;
    gameState.running = true;
  } else if (action === 'set_mission') {
    const id = Math.max(1, Math.min(6, Number(body.missionId) || 1));
    gameState.missionId = id;
    gameState.running = true;
  } else if (action === 'teleport' && body.district) {
    gameState.district = body.district === 'trinidad' ? 'trinidad' : 'belize';
  }

  const driveAction = { action, ...body, queuedAt: new Date().toISOString() };
  gameState.pendingDrive.push(driveAction);
  // Cap queue
  if (gameState.pendingDrive.length > 50) {
    gameState.pendingDrive = gameState.pendingDrive.slice(-50);
  }

  res.json({
    ok: true,
    queued: driveAction,
    pendingDriveCount: gameState.pendingDrive.length,
    status: {
      missionId: gameState.missionId,
      cash: gameState.cash,
      wanted: gameState.wanted,
      paused: gameState.paused,
      district: gameState.district,
    },
  });
});

// Prefer public/agent.json file for static hosts; Express overrides with live
app.get('/agent.json', (_req, res) => {
  res.type('application/json').json(buildAgentJson(true));
});

app.use(express.static(PUBLIC, { index: 'index.html', extensions: ['html'] }));

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CARIB CRIME (app13) listening on http://0.0.0.0:${PORT}`);
  console.log(`Agent: http://localhost:${PORT}/agent.json`);
});
