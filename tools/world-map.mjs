// Dump the streamed-world layout (districts.js) as JSON for tools/world-map.py (schematic overview map).
// Usage: node tools/world-map.mjs [belize|all] > /tmp/layout.json
globalThis.window = { location: { search: '' } }; globalThis.location = window.location;
const { generateLayout, footprint, CORE_RECTS, CHUNK, REGIONS } = await import('../public/js/districts.js');
const which = process.argv[2] || 'all';
const parts = which === 'belize' ? [REGIONS.belizeExpansion()] : Object.values(REGIONS).map((f) => f());
const L = generateLayout(parts);
const out = {
  chunk: CHUNK, core: CORE_RECTS, bounds: L.bounds, districts: L.districts.map((d) => ({ id: d.id, label: d.label, rect: d.rect })),
  land: L.land, channels: L.channels, reefs: L.reefs, roads: L.roadsWhole, bridges: L.bridges, docks: L.docks,
  buildings: L.buildings.map((b) => ({ kind: b.kind, fp: footprint(b, false), color: b.color, name: b.name || null })),
  palms: L.props.palm.length + L.props.bush.length, props: Object.fromEntries(Object.entries(L.props).map(([k, v]) => [k, v.length])),
  boats: L.props.boat.map((b) => [b.x, b.z]), spawns: L.spawns || [],
};
process.stdout.write(JSON.stringify(out));
