/**
 * belizetriniOPNWRLD — Cloudflare-direct (no IBM origin).
 * Static files from Workers Assets; /api/* + agent discovery in-worker.
 */

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
  pendingDrive: [],
};

const MISSIONS = {
  1: 'Scooter Snatch',
  2: 'Queen Street Pickup',
  3: 'Creek Drop',
  4: 'Rival Intercept',
  5: 'Warehouse Soft Hit',
  6: 'Safehouse Run',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

function text(body, status = 200, type = 'text/plain; charset=utf-8') {
  return new Response(body, {
    status,
    headers: { 'content-type': type, 'cache-control': 'no-store' },
  });
}

function agentContract() {
  return {
    schema_version: 1,
    app_id: 'app13',
    name: 'belizetriniOPNWRLD',
    title: 'belizetriniOPNWRLD',
    subtitle: 'Belize ↔ Trinidad',
    host: 'app13.nextaura.us',
    purpose:
      'Fiction adult open-world browser crime game. Agents drive via /api/drive.',
    how_built: 'Cloudflare Worker + Assets (Three.js). No IBM origin.',
    status: gameState.running ? 'running' : 'ready',
    discovery: {
      agent_json: '/agent.json',
      agent_txt: '/agent.txt',
      well_known: '/.well-known/agent.json',
      llms_txt: '/llms.txt',
      robots_txt: '/robots.txt',
      sitemap: '/sitemap.xml',
    },
    api_endpoints: [
      { method: 'GET', path: '/api/health' },
      { method: 'GET', path: '/api/status' },
      { method: 'POST', path: '/api/drive' },
      { method: 'POST', path: '/api/state-sync' },
      { method: 'GET', path: '/api/drive/poll' },
    ],
    live: {
      running: gameState.running,
      paused: gameState.paused,
      missionId: gameState.missionId,
      cash: gameState.cash,
      wanted: gameState.wanted,
      district: gameState.district,
      health: gameState.health,
    },
  };
}

function handleDrive(body) {
  const action = body && body.action;
  if (!action) return { ok: false, error: 'action required' };
  const enqueue = (payload) => {
    gameState.pendingDrive.push({ ...payload, ts: Date.now() });
    if (gameState.pendingDrive.length > 50) gameState.pendingDrive.shift();
  };
  switch (action) {
    case 'start_mission':
      gameState.missionId = gameState.missionId > 0 ? gameState.missionId : 1;
      gameState.missionName = MISSIONS[gameState.missionId] || 'Mission';
      gameState.running = true;
      gameState.startedAt = gameState.startedAt || new Date().toISOString();
      enqueue({ action: 'start_mission', missionId: gameState.missionId });
      break;
    case 'set_mission': {
      const id = Math.max(1, Math.min(6, Number(body.missionId) || 1));
      gameState.missionId = id;
      gameState.missionName = MISSIONS[id];
      gameState.running = true;
      enqueue({ action: 'set_mission', missionId: id });
      break;
    }
    case 'give_cash':
      gameState.cash += Number(body.amount) || 0;
      enqueue({ action: 'give_cash', amount: Number(body.amount) || 0 });
      break;
    case 'clear_wanted':
      gameState.wanted = 0;
      enqueue({ action: 'clear_wanted' });
      break;
    case 'set_wanted':
      gameState.wanted = Math.max(0, Math.min(5, Number(body.wanted) || 0));
      enqueue({ action: 'set_wanted', wanted: gameState.wanted });
      break;
    case 'teleport':
      enqueue({
        action: 'teleport',
        x: Number(body.x) || 0,
        y: Number(body.y) || 0,
        z: Number(body.z) || 0,
        district: body.district,
      });
      break;
    case 'spawn_car':
      enqueue({ action: 'spawn_car' });
      break;
    case 'pause':
      gameState.paused = true;
      enqueue({ action: 'pause' });
      break;
    case 'resume':
      gameState.paused = false;
      enqueue({ action: 'resume' });
      break;
    case 'heal':
      gameState.health = 100;
      enqueue({ action: 'heal' });
      break;
    default:
      return { ok: false, error: `unknown action: ${action}` };
  }
  gameState.lastUpdate = new Date().toISOString();
  return { ok: true, state: { ...gameState, pendingDrive: undefined } };
}

async function handleApi(request, url) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    });
  }

  if (url.pathname === '/api/health') {
    return json({
      ok: true,
      device: 'browser',
      running: gameState.running,
      app_id: 'app13',
      host: 'cloudflare-direct',
    });
  }
  if (url.pathname === '/api/status') {
    return json({ ok: true, ...gameState, pendingDriveCount: gameState.pendingDrive.length });
  }
  if (url.pathname === '/api/drive/poll' && request.method === 'GET') {
    const batch = gameState.pendingDrive.splice(0, 20);
    return json({ ok: true, actions: batch });
  }
  if (url.pathname === '/api/state-sync' && request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch (_) {}
    for (const k of ['running','paused','missionId','missionName','cash','wanted','health','district','inVehicle','vehicleId']) {
      if (body[k] !== undefined) gameState[k] = body[k];
    }
    if (body.playerPos) gameState.playerPos = body.playerPos;
    gameState.lastUpdate = new Date().toISOString();
    return json({ ok: true });
  }
  if (url.pathname === '/api/drive' && request.method === 'POST') {
    let body = {};
    try { body = await request.json(); } catch (_) {}
    return json(handleDrive(body));
  }
  return json({ ok: false, error: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, url);
    }
    if (url.pathname === '/agent.json' || url.pathname === '/.well-known/agent.json') {
      return json(agentContract());
    }
    if (url.pathname === '/agent.txt') {
      return text(
        [
          'belizetriniOPNWRLD (app13)',
          'Host: app13.nextaura.us',
          'Agent: /agent.json',
          'Health: GET /api/health',
          'Drive: POST /api/drive',
          'Origin: cloudflare-direct (no IBM)',
        ].join('\n') + '\n'
      );
    }

    // Static assets via Workers Assets binding
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return text('ASSETS binding missing', 500);
  },
};
