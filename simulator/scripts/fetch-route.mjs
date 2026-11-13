#!/usr/bin/env node
/**
 * Downloads Sydney bus route 445 from OpenStreetMap (Overpass API) and writes
 * src/data/route445.json in local metres. Run once; the game reads the JSON.
 *
 *   node scripts/fetch-route.mjs                 # fetch live
 *   node scripts/fetch-route.mjs --input raw.json  # use a saved Overpass response
 *
 * Map data © OpenStreetMap contributors, ODbL.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const QUERY = `[out:json][timeout:60];
rel["route"="bus"]["ref"="445"](-33.96,151.05,-33.84,151.21)->.r;
.r out geom;
way(r.r);out tags;
node(r.r);out tags;`;

const args = process.argv.slice(2);
let raw;
if (args[0] === '--input') raw = JSON.parse(readFileSync(args[1], 'utf8'));
else {
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: QUERY }) });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  raw = await res.json();
}

const rels = raw.elements.filter((e) => e.type === 'relation');
const wayTags = new Map(raw.elements.filter((e) => e.type === 'way').map((w) => [w.id, w.tags ?? {}]));
// Prefer the direction towards Balmain; otherwise the first relation.
const rel = rels.find((r) => /balmain/i.test(r.tags.to ?? r.tags.name ?? '')) ?? rels[0];
if (!rel) throw new Error('Route 445 not found');
console.log(`Using: ${rel.tags.name}`);

// --- Chain the route's ways in order, flipping each to join the previous one
const WIDTH = { trunk: 15, primary: 14, secondary: 13, tertiary: 12 };
const pts = []; // [lat, lon, width]
const ways = rel.members.filter((m) => m.type === 'way' && (m.role === '' || m.role === 'forward' || m.role === 'backward') && m.geometry);
const d2 = (a, b) => (a.lat - b.lat) ** 2 + (a.lon - b.lon) ** 2;
for (let i = 0; i < ways.length; i++) {
  let g = ways[i].geometry;
  if (pts.length) {
    const last = { lat: pts.at(-1)[0], lon: pts.at(-1)[1] };
    if (d2(g.at(-1), last) < d2(g[0], last)) g = [...g].reverse();
  } else if (ways[1]) {
    // Orient the first way so its end touches the second
    const n = ways[1].geometry, ends = [n[0], n.at(-1)];
    const dEnd = Math.min(...ends.map((e) => d2(g.at(-1), e))), dStart = Math.min(...ends.map((e) => d2(g[0], e)));
    if (dStart < dEnd) g = [...g].reverse();
  }
  const w = WIDTH[wayTags.get(ways[i].ref)?.highway] ?? 11;
  for (const p of g) pts.push([p.lat, p.lon, w]);
}

// --- Project to local metres: x = east, z = south (so the world isn't mirrored in Three.js)
const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
const lon0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), kz = 110540;
const proj = (lat, lon) => [+((lon - lon0) * kx).toFixed(2), +(-(lat - lat0) * kz).toFixed(2)];

let path = [];
for (const [lat, lon, w] of pts) {
  const [x, z] = proj(lat, lon);
  const prev = path.at(-1);
  if (!prev || Math.hypot(x - prev[0], z - prev[1]) > 2) path.push([x, z, w]);
}
path = simplify(path, 0.6);

// --- Stops: platforms (kerbside) preferred, else stop positions
const stopMembers = rel.members.filter((m) => m.type === 'node' && /platform/.test(m.role));
const stops = (stopMembers.length ? stopMembers : rel.members.filter((m) => m.type === 'node' && /stop/.test(m.role)))
  .map((m) => ({ ref: m.ref, xz: proj(m.lat, m.lon) }));
const nodeNames = new Map(raw.elements.filter((e) => e.type === 'node').map((n) => [n.id, n.tags?.name ?? '']));

const out = {
  name: rel.tags.name, from: rel.tags.from, to: rel.tags.to,
  attribution: 'Map data © OpenStreetMap contributors (ODbL)',
  origin: { lat: +lat0.toFixed(6), lon: +lon0.toFixed(6) },
  path,                                            // [x, z, roadWidth]
  stops: stops.map((s) => ({ name: nodeNames.get(s.ref) || 'Bus stop', x: s.xz[0], z: s.xz[1] })),
};
writeFileSync(new URL('../src/data/route445.json', import.meta.url), JSON.stringify(out));
const len = path.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0);
console.log(`Wrote ${path.length} points, ${(len / 1000).toFixed(1)} km, ${out.stops.length} stops`);

function simplify(p, tol) {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const stack = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(p[i], p[a], p[b]);
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return p.filter((_, i) => keep[i]);
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}
