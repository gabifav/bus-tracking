import * as THREE from 'three';
import type { Collider } from '../vehicles/Bus';
import { RoutePath, type PathPoint } from './RoutePath';
import { StreetIndex, type Street } from './StreetIndex';
import { buildRealBuildings, type BuildingRecord } from './Buildings';

export interface RouteData {
  name: string; from?: string; to?: string; attribution: string;
  path: number[][];                       // [x, z, roadWidth]
  stops: { name: string; x: number; z: number }[];
  buildings?: BuildingRecord[];   // real OSM footprints
  streets?: Street[];             // real side streets near the route
}
export interface Stop { name: string; s: number; x: number; z: number }

const FOOTPATH = 4;   // m between kerb and property line
const rnd = mulberry32(445);

/**
 * Builds a Sydney inner-west street corridor along a real route path:
 * road with kerbs and markings, footpaths, terraces and shopfronts, timber
 * power poles with street lights, trees and bus stops. Only the road is drivable.
 */
export class RouteWorld implements Collider {
  readonly group = new THREE.Group();
  readonly path: RoutePath;
  readonly stops: Stop[];
  readonly streets: StreetIndex;
  private occupied = new Set<string>(); // 2 m cells covered by real buildings

  constructor(readonly data: RouteData) {
    this.path = new RoutePath(data.path);
    this.stops = data.stops
      .map((st) => ({ ...st, s: this.path.nearest(st.x, st.z).s }))
      .filter((st) => this.path.nearest(st.x, st.z).dist < 30)
      .sort((a, b) => a.s - b.s);

    this.streets = new StreetIndex(data.streets ?? []);
    const sideLines: PathPoint[][] = (data.streets ?? []).map((st) => {
      const pts: PathPoint[] = [];
      for (let i = 0; i + 1 < st.p.length; i += 2) pts.push({ x: st.p[i], z: st.p[i + 1], width: st.w, junction: 0 });
      return pts;
    });
    this.group.add(this.ribbon([this.path.pts, ...sideLines], FOOTPATH - 1, 0.0, 0xa9a59c)); // footpaths
    this.group.add(this.ribbon(sideLines, 0, 0.025, 0x3d3d40));                                // side streets
    this.group.add(this.ribbon([this.path.pts], 0, 0.03, 0x37373a));                           // route asphalt
    this.buildGround();
    this.buildMarkingsAndKerbs();
    this.buildRealBuildings();
    this.buildBuildings();
    this.buildStreetFurniture();
    this.buildStops();
  }

  isBlocked(x: number, z: number): boolean {
    const n = this.path.nearest(x, z);
    return n.dist > n.width / 2 - 0.2 && !this.path.inJunction(x, z, -0.2) && !this.streets.contains(x, z, -0.2);
  }

  nearestRoadPoint(x: number, z: number): { x: number; z: number } {
    return this.path.at(this.path.nearest(x, z).s);
  }

  /** Start of the route, in the left lane, facing along the route. */
  get spawn(): { x: number; z: number; heading: number } {
    const p = this.path.at(25);
    return { x: p.x + p.dirZ * (p.width / 4), z: p.z - p.dirX * (p.width / 4), heading: Math.atan2(p.dirX, p.dirZ) };
  }

  // ---------------------------------------------------------------- road
  /** Flat band following the path: quads per segment plus discs at joints. */
  private ribbon(lines: PathPoint[][], extra: number, y: number, colour: number): THREE.Mesh {
    const pos: number[] = [];
    const tri = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => pos.push(ax, y, az, bx, y, bz, cx, y, cz);
    for (const pts of lines) for (let i = 0; i < pts.length; i++) {
      const a = pts[i], hw = a.width / 2 + extra, jr = Math.max(a.width / 2, a.junction) + extra;
      if (i < pts.length - 1) {
        const b = pts[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const nx = ((b.z - a.z) / len) * hw, nz = (-(b.x - a.x) / len) * hw;
        tri(a.x + nx, a.z + nz, b.x + nx, b.z + nz, a.x - nx, a.z - nz);
        tri(b.x + nx, b.z + nz, b.x - nx, b.z - nz, a.x - nx, a.z - nz);
      }
      const N = a.junction ? 24 : 10; // joint disc
      for (let k = 0; k < N; k++) {
        const t0 = (k / N) * Math.PI * 2, t1 = ((k + 1) / N) * Math.PI * 2;
        tri(a.x, a.z, a.x + Math.cos(t1) * jr, a.z + Math.sin(t1) * jr, a.x + Math.cos(t0) * jr, a.z + Math.sin(t0) * jr);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // Fix winding so every triangle faces up, then flat normals
    const p = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < p.length; i += 9) {
      const cross = (p[i + 3] - p[i]) * (p[i + 8] - p[i + 2]) - (p[i + 5] - p[i + 2]) * (p[i + 6] - p[i]);
      if (cross > 0) for (let k = 0; k < 3; k++) [p[i + 3 + k], p[i + 6 + k]] = [p[i + 6 + k], p[i + 3 + k]];
    }
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(p.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colour, roughness: 0.95 }));
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildGround(): void {
    const xs = this.path.pts.map((p) => p.x), zs = this.path.pts.map((p) => p.z);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 1000;
    const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 64, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x6d7f55, roughness: 1 }));
    g.position.set(cx, -0.3, cz); // well below the footpath to avoid depth fighting at grazing angles
    g.receiveShadow = true;
    this.group.add(g);
  }

  /** Walks the path in fixed steps, calling fn with a sample and its left normal. */
  private walk(step: number, fn: (p: ReturnType<RoutePath['at']>, s: number, lx: number, lz: number) => void, start = 0): void {
    for (let s = start; s < this.path.length; s += step) {
      const p = this.path.at(s);
      fn(p, s, p.dirZ, -p.dirX);
    }
  }

  /** Keeps an object only if it sits at least `clear` metres from every part of the road. */
  private clearOfRoad(x: number, z: number, clear: number): boolean {
    const n = this.path.nearest(x, z);
    return n.dist > n.width / 2 + clear && !this.path.inJunction(x, z, clear) && !this.streets.contains(x, z, clear);
  }

  private buildMarkingsAndKerbs(): void {
    const dashes: THREE.Matrix4[] = [], kerbs: THREE.Matrix4[] = [], edges: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const place = (list: THREE.Matrix4[], x: number, y: number, z: number, yaw: number) =>
      list.push(m.clone().compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, yaw).clone(), new THREE.Vector3(1, 1, 1)));

    this.walk(2, (p, s, lx, lz) => {
      const yaw = Math.atan2(p.dirX, p.dirZ), hw = p.width / 2;
      // Dashed centre line: 3 m on, 7 m off. Skip where the road bends hard.
      const ahead = this.path.at(s + 6);
      const bend = Math.abs(p.dirX * ahead.dirZ - p.dirZ * ahead.dirX);
      if (s % 10 < 2 && bend < 0.15 && !this.path.inJunction(p.x, p.z, 2)) place(dashes, p.x, 0.045, p.z, yaw);
      for (const side of [1, -1]) {
        const ex = p.x + lx * side * (hw - 0.6), ez = p.z + lz * side * (hw - 0.6);
        const kx = p.x + lx * side * (hw + 0.1), kz = p.z + lz * side * (hw + 0.1);
        // Kerb/edge pieces are dropped where they'd poke into the road at bends
        if (this.path.nearest(kx, kz).dist > hw - 0.05 && !this.path.inJunction(kx, kz, -0.05) && !this.streets.contains(kx, kz, 0.3)) place(kerbs, kx, 0.08, kz, yaw);
        if (this.path.nearest(ex, ez).dist > hw - 0.7 && bend < 0.15 && !this.path.inJunction(ex, ez, 0.5) && !this.streets.contains(ex, ez, 0.5)) place(edges, ex, 0.045, ez, yaw);
      }
    });
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[]) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.receiveShadow = true;
      this.group.add(im);
    };
    const paint = new THREE.MeshBasicMaterial({ color: 0xeeeeee });
    inst(new THREE.PlaneGeometry(0.15, 3).rotateX(-Math.PI / 2), paint, dashes);
    inst(new THREE.PlaneGeometry(0.1, 2.05).rotateX(-Math.PI / 2), paint, edges);
    inst(new THREE.BoxGeometry(0.25, 0.16, 2.05), new THREE.MeshStandardMaterial({ color: 0x9a968d }), kerbs);
  }

  // ---------------------------------------------------------------- buildings
  /** Real OSM footprints. Any that would sit on our (approximate-width) roads are dropped. */
  private buildRealBuildings(): void {
    const { group, footprints } = buildRealBuildings(this.data.buildings ?? [], (ring) =>
      ring.some(([x, z]) => !this.clearOfRoad(x, z, 0.3)));
    this.group.add(group);
    for (const ring of footprints) {
      const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
      for (let x = Math.floor(Math.min(...xs) / 2) - 1; x <= Math.floor(Math.max(...xs) / 2) + 1; x++)
        for (let z = Math.floor(Math.min(...zs) / 2) - 1; z <= Math.floor(Math.max(...zs) / 2) + 1; z++) this.occupied.add(`${x},${z}`);
    }
  }

  private isOccupied(x: number, z: number): boolean {
    return this.occupied.has(`${Math.floor(x / 2)},${Math.floor(z / 2)}`);
  }

  /** Procedural houses and shops, only where no real building exists. */
  private buildBuildings(): void {
    type Lot = { x: number; z: number; yaw: number; w: number; d: number; h: number; colour: number };
    const houses: Lot[] = [], shops: Lot[] = [], roofs: Lot[] = [], awnings: Lot[] = [];
    const taken: { x: number; z: number; r: number }[] = [];
    const free = (x: number, z: number, r: number) => taken.every((t) => (t.x - x) ** 2 + (t.z - z) ** 2 > (t.r + r) ** 2);
    const nearStop = (s: number) => this.stops.some((st) => Math.abs(st.s - s) < 140);
    const BRICK = [0xa0573c, 0x8e4a35, 0xb86b4b, 0xc9a27c, 0xe4d8c0, 0xd9cdb4, 0x9b8f7f, 0xf0ece2];
    const SHOP = [0xd9c9a8, 0xb35a3c, 0x7d8f99, 0xe8e0cc, 0xa66a4a, 0xcbbf9e];

    for (const side of [1, -1]) {
      let s = 5;
      while (s < this.path.length) {
        const p = this.path.at(s);
        const lx = p.dirZ * side, lz = -p.dirX * side;
        const main = p.width >= 13;
        const isShop = main && (nearStop(s) || rnd() < 0.3);
        const w = isShop ? 7 + rnd() * 5 : 5.5 + rnd() * 2.5;
        const d = isShop ? 12 + rnd() * 6 : 9 + rnd() * 4;
        const setback = isShop ? 0 : 2 + rnd() * 3;
        const off = p.width / 2 + FOOTPATH + setback + d / 2;
        const x = p.x + lx * off, z = p.z + lz * off;
        const r = Math.min(w, d) / 2;
        // Footprint corners must stay off the road/footpath
        const ok = [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0, -0.5], [0, 0.5]].every(([a, b]) => {
          const qx = x + p.dirX * a * w + lx * b * d, qz = z + p.dirZ * a * w + lz * b * d;
          return this.clearOfRoad(qx, qz, FOOTPATH - 0.3) && !this.isOccupied(qx, qz);
        });
        if (ok && free(x, z, r) && rnd() > 0.06) {
          taken.push({ x, z, r });
          const yaw = Math.atan2(p.dirX, p.dirZ);
          if (isShop) {
            const h = 6.5 + Math.floor(rnd() * 3) * 3;
            shops.push({ x, z, yaw, w, d, h, colour: SHOP[Math.floor(rnd() * SHOP.length)] });
            const ao = p.width / 2 + FOOTPATH - 1.3; // awning over the footpath
            awnings.push({ x: p.x + lx * ao, z: p.z + lz * ao, yaw, w: w - 0.2, d: 2.6, h: 3.4, colour: 0x3c3c3c });
          } else {
            const h = rnd() < 0.55 ? 3.4 : 6.2;
            const colour = BRICK[Math.floor(rnd() * BRICK.length)];
            houses.push({ x, z, yaw, w, d, h, colour });
            roofs.push({ x, z, yaw, w: w + 0.4, d: d + 0.4, h, colour: rnd() < 0.6 ? 0x8a3b2a : 0x55595e });
          }
        }
        s += w + (isShop ? 0.1 : 0.6 + rnd() * 1.2);
      }
    }

    const facade = (shop: boolean) => facadeTexture(shop);
    const plain = new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.9 });
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mkMats = (shop: boolean) => {
      const f = new THREE.MeshStandardMaterial({ map: facade(shop), roughness: 0.85 });
      return [f, f, plain, plain, f, f]; // +x -x +y -y +z -z
    };
    this.addLots(box, mkMats(false), houses, (l) => l.h, true);
    this.addLots(box, mkMats(true), shops, (l) => l.h, true);
    this.addLots(roofPrism(), new THREE.MeshStandardMaterial({ roughness: 0.8 }), roofs, () => 2.4, true, (l) => l.h + 0.15);
    this.addLots(new THREE.BoxGeometry(1, 0.15, 1), new THREE.MeshStandardMaterial({ roughness: 0.7 }), awnings, () => 1, false, (l) => l.h);
  }

  private addLots(
    geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[],
    lots: { x: number; z: number; yaw: number; w: number; d: number; h: number; colour: number }[],
    height: (l: (typeof lots)[number]) => number, shadow: boolean, baseY: (l: (typeof lots)[number]) => number = () => 0,
  ): void {
    const im = new THREE.InstancedMesh(geo, mat, lots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    // After rotating by yaw: local z runs along the street (width), local x away from it (depth)
    lots.forEach((l, i) => {
      m.compose(new THREE.Vector3(l.x, baseY(l), l.z), q.setFromAxisAngle(up, l.yaw), new THREE.Vector3(l.d, height(l), l.w));
      im.setMatrixAt(i, m);
      im.setColorAt(i, c.setHex(l.colour));
    });
    im.castShadow = shadow;
    im.receiveShadow = true;
    this.group.add(im);
  }

  // ---------------------------------------------------------------- street furniture
  private buildStreetFurniture(): void {
    const poles: THREE.Matrix4[] = [], arms: THREE.Matrix4[] = [], lamps: THREE.Matrix4[] = [], trees: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    let i = 0;
    // Timber power poles with street lights, every ~38 m, alternating sides
    this.walk(38, (p, _s, lx, lz) => {
      const side = i++ % 2 ? 1 : -1, off = p.width / 2 + 0.7;
      const x = p.x + lx * side * off, z = p.z + lz * side * off;
      if (!this.clearOfRoad(x, z, 0.4)) return;
      const yaw = Math.atan2(lx * side, lz * side); // arm points toward the road
      poles.push(m.clone().makeTranslation(x, 0, z));
      q.setFromAxisAngle(up, yaw);
      arms.push(m.clone().compose(new THREE.Vector3(x - lx * side * 1.2, 8.2, z - lz * side * 1.2), q.clone(), one));
      lamps.push(m.clone().compose(new THREE.Vector3(x - lx * side * 2.4, 8.05, z - lz * side * 2.4), q.clone(), one));
    }, 10);
    // Street trees on the footpath
    this.walk(9, (p, _s, lx, lz) => {
      for (const side of [1, -1]) {
        if (rnd() < 0.55) continue;
        const off = p.width / 2 + 1.6 + rnd() * 0.6;
        const x = p.x + lx * side * off, z = p.z + lz * side * off;
        if (!this.clearOfRoad(x, z, 1.1)) continue;
        const sc = 0.7 + rnd() * 0.6;
        trees.push(m.clone().compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(up, rnd() * 6).clone(), new THREE.Vector3(sc, sc, sc)));
      }
    });

    const timber = new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 1 });
    this.inst(new THREE.CylinderGeometry(0.13, 0.17, 10, 6).translate(0, 5, 0), timber, poles, true);
    this.inst(new THREE.BoxGeometry(0.08, 0.08, 2.6), new THREE.MeshStandardMaterial({ color: 0x777777 }), arms, false);
    this.inst(new THREE.BoxGeometry(0.35, 0.15, 0.7), new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xfff2c0, emissiveIntensity: 0.4 }), lamps, false);
    this.inst(new THREE.CylinderGeometry(0.15, 0.22, 2.6, 5).translate(0, 1.3, 0), new THREE.MeshStandardMaterial({ color: 0x6b5440 }), trees, false);
    this.inst(new THREE.IcosahedronGeometry(2.1, 0).scale(1, 0.8, 1).translate(0, 3.6, 0), new THREE.MeshStandardMaterial({ color: 0x4a6b35, roughness: 1, flatShading: true }), trees, true);
  }

  private buildStops(): void {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.4 });
    const signMat = new THREE.MeshStandardMaterial({ map: stopSignTexture(), roughness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fb8c8, transparent: true, opacity: 0.35, roughness: 0.1 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x2c2f33 });
    const zone = new THREE.MeshBasicMaterial({ color: 0xe0b020 });
    for (const st of this.stops) {
      const p = this.path.at(st.s), hw = p.width / 2;
      const lx = p.dirZ, lz = -p.dirX, yaw = Math.atan2(p.dirX, p.dirZ);
      const g = new THREE.Group();
      g.position.set(p.x + lx * (hw + 0.8), 0, p.z + lz * (hw + 0.8));
      g.rotation.y = yaw;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3), poleMat); pole.position.y = 1.5;
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.5), signMat); sign.position.set(0, 2.7, 0);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.2, 4), glass); back.position.set(2.6, 1.2, -5);
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 4.2), roof); top.position.set(1.9, 2.35, -5);
      top.castShadow = true;
      const label = textSprite(st.name);
      label.position.set(0, 4.2, 0);
      g.add(pole, sign, back, top, label);
      // Yellow "bus zone" kerbside line in the left lane
      const paint = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 22).rotateX(-Math.PI / 2), zone);
      paint.position.set(-1.4, 0.046, -6);
      g.add(paint);
      this.group.add(g);
    }
  }

  private inst(geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], shadow: boolean): void {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.castShadow = shadow;
    this.group.add(im);
  }
}

// ---------------------------------------------------------------- procedural textures/geometry
function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** White-based facade (tinted per instance): windows, door/shopfront, cornice. */
function facadeTexture(shop: boolean): THREE.CanvasTexture {
  return canvas(128, 128, (g) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, 128, 6);
    if (shop) {
      g.fillStyle = '#2a3540'; g.fillRect(8, 82, 112, 46);        // shop window
      g.fillStyle = '#bcc6cc'; g.fillRect(10, 84, 50, 30);
      g.fillStyle = '#2a3540'; for (const x of [16, 56, 96]) g.fillRect(x, 22, 18, 30);
    } else {
      g.fillStyle = '#2c3440'; g.fillRect(18, 74, 34, 34); g.fillRect(76, 66, 22, 62); // window + door
      g.fillRect(22, 18, 26, 30); g.fillRect(76, 18, 26, 30);
      g.fillStyle = '#e9e4d8'; g.fillRect(14, 108, 42, 4);
    }
  });
}

function stopSignTexture(): THREE.CanvasTexture {
  return canvas(64, 96, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 96);
    g.fillStyle = '#0a7a3c'; g.fillRect(4, 4, 56, 56);
    g.fillStyle = '#fff'; g.font = 'bold 36px sans-serif'; g.textAlign = 'center'; g.fillText('B', 32, 46);
    g.fillStyle = '#111'; g.font = 'bold 14px sans-serif'; g.fillText('445', 32, 84);
  });
}

function textSprite(text: string): THREE.Sprite {
  const tex = canvas(512, 64, (g) => {
    g.fillStyle = 'rgba(10,40,25,0.85)'; g.fillRect(0, 0, 512, 64);
    g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text.length > 34 ? text.slice(0, 33) + '…' : text, 256, 34);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sp.scale.set(8, 1, 1);
  return sp;
}

/** Unit gable roof: ridge along local z, spans x ∈ [-0.5,0.5], y ∈ [0,1]. */
function roofPrism(): THREE.BufferGeometry {
  const s = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
  return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
