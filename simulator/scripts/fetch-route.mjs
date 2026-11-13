#!/usr/bin/env node
/**
 * Downloads Sydney bus route 445 from OpenStreetMap (Overpass API), plus the
 * real buildings and side streets along it, and writes src/data/route445.json
 * in local metres. Run once; the game reads the JSON.
 *
 *   node scripts/fetch-route.mjs                 # fetch live
 *   node scripts/fetch-route.mjs --input raw.json  # use a saved Overpass response
 *
 * Map data © OpenStreetMap contributors, ODbL.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const QUERY = `[out:json][timeout:90];
rel["route"="bus"]["ref"="445"](-33.96,151.05,-33.84,151.21)->.r;
.r out geom;
way(r.r);out tags;
node(r.r);out tags;`;
// Buildings and streets are fetched in small boxes along the route (one big query is too heavy)
const chunkQuery = (s, w, n, e) => `[out:json][timeout:90];
(way["building"](${s},${w},${n},${e});
 way["highway"~"^(trunk|primary|secondary|tertiary|residential|unclassified|living_street|service)$"](${s},${w},${n},${e}););
out geom;`;

const args = process.argv.slice(2);
let raw;
if (args[0] === '--input') raw = JSON.parse(readFileSync(args[1], 'utf8'));
else raw = await fetchOverpass(QUERY);

async function fetchOverpass(query) {
  // Overpass rejects anonymous clients (HTTP 406), so identify the app.
  const servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const url of servers) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'User-Agent': 'sydney-bus-simulator/0.1 (route data fetch)',
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ data: query }).toString(),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.remark) throw new Error(`server problem: ${json.remark.slice(0, 160)}`);
          return json;
        }
        console.warn(`${url} answered ${res.status}: ${(await res.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`);
        if (![429, 502, 503, 504].includes(res.status)) break; // not worth retrying
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = (retryAfter > 0 ? retryAfter : 5 * 2 ** (attempt - 1)) * 1000;
        if (attempt < 5) { console.log(`Retrying in ${wait / 1000}s (attempt ${attempt + 1}/5)...`); await sleep(wait); }
      } catch (e) {
        console.warn(`${url} failed: ${e.message}`);
        if (attempt < 5) await sleep(5000 * 2 ** (attempt - 1));
      }
    }
  }
  throw new Error('All Overpass servers failed. Wait a minute and try again.');
}

const rels = raw.elements.filter((e) => e.type === 'relation');
const wayTags = new Map(raw.elements.filter((e) => e.type === 'way' && !e.geometry).map((w) => [w.id, w.tags ?? {}]));
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

// --- Fetch buildings/streets in ~800 m chunks of the route
if (args[0] !== '--input') {
  const PAD = 0.0011; // ≈ 110 m
  const seen = new Set(raw.elements.map((e) => e.type + e.id));
  let chunkStart = 0, chunks = [];
  for (let i = 1, acc = 0; i < pts.length; i++) {
    acc += Math.hypot((pts[i][0] - pts[i - 1][0]) * kz, (pts[i][1] - pts[i - 1][1]) * kx);
    if (acc > 800 || i === pts.length - 1) { chunks.push(pts.slice(chunkStart, i + 1)); chunkStart = i; acc = 0; }
  }
  for (let c = 0; c < chunks.length; c++) {
    const lats = chunks[c].map((p) => p[0]), lons = chunks[c].map((p) => p[1]);
    const box = [Math.min(...lats) - PAD, Math.min(...lons) - PAD * 1.2, Math.max(...lats) + PAD, Math.max(...lons) + PAD * 1.2].map((v) => v.toFixed(5));
    process.stdout.write(`Buildings and streets: chunk ${c + 1}/${chunks.length}...\r`);
    const part = await fetchOverpass(chunkQuery(...box));
    for (const e of part.elements) if (!seen.has(e.type + e.id)) { seen.add(e.type + e.id); raw.elements.push(e); }
    await new Promise((r) => setTimeout(r, 1500)); // be polite to the free server
  }
  console.log('');
}

// --- Spatial index of the route, to keep only nearby buildings/streets
const CELL = 50, grid = new Map();
for (let i = 0; i < path.length - 1; i++) {
  const [ax, az] = path[i], [bx, bz] = path[i + 1];
  for (let cx = Math.floor((Math.min(ax, bx) - 120) / CELL); cx <= Math.floor((Math.max(ax, bx) + 120) / CELL); cx++)
    for (let cz = Math.floor((Math.min(az, bz) - 120) / CELL); cz <= Math.floor((Math.max(az, bz) + 120) / CELL); cz++) {
      const k = cx + ',' + cz; (grid.get(k) ?? grid.set(k, []).get(k)).push(i);
    }
}
const routeDist = (x, z) => {
  let best = Infinity;
  for (const i of grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL)) ?? []) best = Math.min(best, segDist([x, z], path[i], path[i + 1]));
  return best;
};
const r1 = (v) => Math.round(v * 10) / 10;

// --- Buildings: [type, heightM, levels, x0, z0, x1, z1, ...] (open ring, metres)
const TYPE = { house: 0, detached: 0, semidetached_house: 0, terrace: 0, residential: 0, bungalow: 0, yes: 0,
  apartments: 1, flats: 1, commercial: 2, retail: 2, supermarket: 2, office: 2, hotel: 2,
  church: 3, school: 3, public: 3, civic: 3, hospital: 3, university: 3, train_station: 3,
  industrial: 4, warehouse: 4, garage: 5, garages: 5, shed: 5, carport: 5, roof: 5 };
const buildings = [];
for (const e of raw.elements) {
  if (e.type !== 'way' || !e.tags?.building || !e.geometry || e.geometry.length < 4) continue;
  const ring = e.geometry.slice(0, -1).map((g) => proj(g.lat, g.lon));
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  if (routeDist(cx, cz) > 90) continue;
  let type = TYPE[e.tags.building] ?? 0;
  if (type === 0 && (e.tags.shop || e.tags.amenity)) type = 2;
  const h = parseFloat(e.tags.height) || 0, lv = parseInt(e.tags['building:levels']) || 0;
  buildings.push([type, r1(h), lv, ...ring.flatMap(([x, z]) => [r1(x), r1(z)])]);
}

// --- Side streets (not the route itself), clipped to 120 m of the route: { w, n, p: [x0,z0,...] }
const routeWayIds = new Set(rel.members.filter((m) => m.type === 'way').map((m) => m.ref));
const SIDE_W = { trunk: 15, primary: 14, secondary: 13, tertiary: 12, residential: 9, unclassified: 9, living_street: 7, service: 5 };
const streets = [];
for (const e of raw.elements) {
  if (e.type !== 'way' || !e.tags?.highway || !e.geometry || routeWayIds.has(e.id)) continue;
  let run = [];
  const flush = () => { if (run.length >= 4) streets.push({ w: SIDE_W[e.tags.highway] ?? 8, n: e.tags.name ?? '', p: run }); run = []; };
  for (const g of e.geometry) {
    const [x, z] = proj(g.lat, g.lon);
    if (routeDist(x, z) <= 120) run.push(r1(x), r1(z)); else flush();
  }
  flush();
}

const out = {
  name: rel.tags.name, from: rel.tags.from, to: rel.tags.to,
  attribution: 'Map data © OpenStreetMap contributors (ODbL)',
  origin: { lat: +lat0.toFixed(6), lon: +lon0.toFixed(6) },
  path,                                            // [x, z, roadWidth]
  stops: stops.map((s) => ({ name: nodeNames.get(s.ref) || 'Bus stop', x: s.xz[0], z: s.xz[1] })),
  buildings,
  streets,
};
writeFileSync(new URL('../src/data/route445.json', import.meta.url), JSON.stringify(out));
const len = path.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0);
console.log(`Wrote ${path.length} points, ${(len / 1000).toFixed(1)} km, ${out.stops.length} stops, ${buildings.length} buildings, ${streets.length} side streets`);

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
