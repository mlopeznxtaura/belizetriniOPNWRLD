// good-1+11: road graph over core + chunk-split district roads — connectivity + sample A* routes.
// Usage: node tools/road-graph-check.mjs [belize|all] > docs/fidelity/<goal>/road_graph.json
globalThis.window = { location: { search: '' } }; globalThis.location = window.location;
globalThis.document = { createElement: () => ({ getContext: () => null }) };
const { generateLayout, REGIONS, CHUNK } = await import('../public/js/districts.js');
const { buildRoadGraph } = await import('../public/js/wanted.js');
const fs = await import('fs');
const src = fs.readFileSync(new URL('../public/js/world.js', import.meta.url), 'utf8');
const core = eval(src.slice(src.indexOf('const ROADS = [') + 'const ROADS = '.length, src.indexOf('];', src.indexOf('const ROADS = [')) + 1));
const which = process.argv[2] || 'all';
const L = generateLayout(which === 'belize' ? [REGIONS.belizeExpansion()] : Object.values(REGIONS).map((f) => f()));
const roads = core.concat(L.roads);
const G = buildRoadGraph(roads);
const comp = new Array(G.nodes.length).fill(-1); let nc = 0; const sizes = [];
for (let s = 0; s < G.nodes.length; s++) { if (comp[s] >= 0) continue; let q = [s], n = 0; comp[s] = nc; while (q.length) { const u = q.pop(); n++; for (const [v] of G.nodes[u].adj) if (comp[v] < 0) { comp[v] = nc; q.push(v); } } sizes.push(n); nc++; }
const spawn = G.nearest(-72, 4);
const borderNodes = G.nodes.filter((n) => (Math.abs(n.x / CHUNK - Math.round(n.x / CHUNK)) < 1e-6 || Math.abs(n.z / CHUNK - Math.round(n.z / CHUNK)) < 1e-6));
const route = (x, z) => { const p = G.path(spawn, G.nearest(x, z)); const n = G.nodes[p[p.length - 1]]; return { to: [x, z], reached: [n.x, n.z], hops: p.length, chunks: [...new Set(p.map((i) => Math.floor(G.nodes[i].x / CHUNK) + ',' + Math.floor(G.nodes[i].z / CHUNK)))] }; };
const out = { roads: { core: core.length, districtPieces: L.roads.length, districtWhole: L.roadsWhole.length }, nodes: G.nodes.length, components: nc, componentSizes: sizes.sort((a, b) => b - a),
  spawnComponentSize: sizes[0], allInSpawnComponent: comp.every((c) => c === comp[spawn]), chunkBorderJoinNodes: borderNodes.length,
  routes: [route(-540, -60), route(-480, 300), route(100, 280), route(-60, 300), route(-310, -95)] };
// islands are separate road networks (no road across the sea) — report them, don't count as broken
console.log(JSON.stringify(out, null, 1));
