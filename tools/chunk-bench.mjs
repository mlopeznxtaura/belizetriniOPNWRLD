// good-1+11: node-side chunk build timing (every content chunk built synchronously, per-step ms + tris by part).
// Usage: node tools/chunk-bench.mjs
globalThis.window = { location: { search: '' } }; globalThis.location = window.location;
globalThis.document = { createElement: () => ({ getContext: () => null }) };
const THREE = await import('../node_modules/three/build/three.module.js');
const { generateLayout } = await import('../public/js/districts.js');
const { ChunkStreamer } = await import('../public/js/chunks.js');
const scene = new THREE.Scene();
const t0=performance.now(); const L = generateLayout(); const t1=performance.now();
const S = new ChunkStreamer(scene, L, { preset: 'high' }); const t2=performance.now();
console.log('layout', (t1-t0).toFixed(1), 'streamer+far', (t2-t1).toFixed(1));
let worst = [];
for (const c of S.contentChunks) {
  S._begin(c); let r, i = 0; const steps = [];
  do { const s = performance.now(); r = S.current.gen.next(); steps.push(performance.now() - s); i++; } while (!r.done);
  const parts = S.current.parts; S._finish(S.current);
  const mx = Math.max(...steps); const at = steps.indexOf(mx);
  worst.push([c.key, c.buildings.length, steps.length, mx.toFixed(2), at, steps.reduce((a,b)=>a+b,0).toFixed(1), parts.prims]);
}
worst.sort((a,b)=>b[3]-a[3]); console.log(worst.slice(0,8));
const tot = {};
for (const c of S.contentChunks) {
  for (const o of c.group.children) {
    const g = o.geometry; const t = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
    tot[o.name] = (tot[o.name] || 0) + t;
  }
}
console.log(Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, Math.round(v)])));
const P = S.props; console.log(Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.geo.index.count / 3])));
