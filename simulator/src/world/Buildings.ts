import * as THREE from 'three';

/** OSM building as exported by scripts/fetch-route.mjs: [type, heightM, levels, x0, z0, x1, z1, ...] */
export type BuildingRecord = number[];

export const enum BType { House, Apartments, Commercial, Civic, Industrial, Garage }

const PALETTE: Record<number, number[]> = {
  [BType.House]: [0xa0573c, 0x8e4a35, 0xb86b4b, 0xc9a27c, 0xe4d8c0, 0xd9cdb4, 0x9b8f7f, 0xf0ece2],
  [BType.Apartments]: [0xd8cdb8, 0xb9ada0, 0xc4a585, 0x9d9a94],
  [BType.Commercial]: [0xd9c9a8, 0xb35a3c, 0x7d8f99, 0xe8e0cc, 0xa66a4a, 0xcbbf9e],
  [BType.Civic]: [0xd8c08a, 0xcfb47c],          // Sydney sandstone
  [BType.Industrial]: [0x9aa0a5, 0xa8a49a],
  [BType.Garage]: [0xb0a89a, 0x8f8a80],
};
const ROOF_TILE = [0x8a3b2a, 0x7a3426, 0x55595e, 0x6b6f73];

/** Deterministic pseudo-random in [0,1) from an integer. */
const hash = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function heightOf(b: BuildingRecord, i: number): number {
  const [type, h, levels] = b;
  if (h > 0) return h;
  if (levels > 0) return levels * 3.1 + 0.6;
  switch (type) {
    case BType.House: return hash(i) < 0.65 ? 3.4 : 6.2;
    case BType.Apartments: return 3 * 3.1 + 0.6;
    case BType.Commercial: return 7;
    case BType.Civic: return 9;
    case BType.Industrial: return 6;
    default: return 2.6;
  }
}

/**
 * Extrudes real OSM footprints into two merged meshes per facade style
 * (walls with tiled window textures, roofs). Rectangular houses get gable roofs.
 */
export function buildRealBuildings(records: BuildingRecord[], skip: (ring: number[][]) => boolean): { group: THREE.Group; footprints: number[][][] } {
  const walls = { house: new Geo(), shop: new Geo() };
  const roofs = new Geo();
  const footprints: number[][][] = [];
  const c = new THREE.Color();

  records.forEach((b, i) => {
    const ring: number[][] = [];
    for (let k = 3; k + 1 < b.length; k += 2) ring.push([b[k], b[k + 1]]);
    if (ring.length < 3 || skip(ring)) return;
    footprints.push(ring);
    const type = b[0], h = heightOf(b, i);
    const pal = PALETTE[type] ?? PALETTE[BType.House];
    c.setHex(pal[Math.floor(hash(i + 7) * pal.length)]);
    const wall = type === BType.Commercial || type === BType.Industrial ? walls.shop : walls.house;

    // Walls: one quad per edge, UVs in metres so windows tile per bay/storey
    let u = 0;
    for (let k = 0; k < ring.length; k++) {
      const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      wall.quad([ax, 0, az], [bx, 0, bz], [bx, h, bz], [ax, h, az], [u, 0, u + len, h], c);
      u += len;
    }

    // Roof
    const rc = new THREE.Color(type === BType.House || type === BType.Garage ? ROOF_TILE[Math.floor(hash(i + 3) * ROOF_TILE.length)] : 0x6e6c68);
    if ((type === BType.House || type === BType.Civic) && ring.length === 4) {
      // Gable: ridge joins the midpoints of the two short edges
      let [A, B, C, D] = ring;
      const d = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d(A, B) + d(C, D) > d(B, C) + d(D, A)) [A, B, C, D] = [B, C, D, A];
      const pitch = Math.min(3, Math.min(d(B, C), d(D, A)) * 0.35);
      const mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, h + pitch, (p[1] + q[1]) / 2];
      const M1 = mid(A, B), M2 = mid(C, D);
      const P = (p: number[]) => [p[0], h, p[1]];
      roofs.tri(P(A), P(B), M1, rc);
      roofs.tri(P(C), P(D), M2, rc);
      roofs.quad(P(B), P(C), M2, M1, [0, 0, 1, 1], rc);
      roofs.quad(P(D), P(A), M1, M2, [0, 0, 1, 1], rc);
    } else {
      const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
      for (const [a, b2, c2] of THREE.ShapeUtils.triangulateShape(contour, [])) {
        roofs.tri([ring[a][0], h, ring[a][1]], [ring[b2][0], h, ring[b2][1]], [ring[c2][0], h, ring[c2][1]], rc);
      }
    }
  });

  const group = new THREE.Group();
  const mk = (g: Geo, mat: THREE.Material) => {
    const m = new THREE.Mesh(g.build(), mat);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  mk(walls.house, new THREE.MeshStandardMaterial({ map: windowTexture(false), vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  mk(walls.shop, new THREE.MeshStandardMaterial({ map: windowTexture(true), vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }));
  mk(roofs, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  return { group, footprints };
}

/** Accumulates non-indexed triangles with colours and UVs. */
class Geo {
  pos: number[] = []; col: number[] = []; uv: number[] = [];
  tri(a: number[], b: number[], c: number[], colour: THREE.Color, uvs = [0, 0, 0, 0, 0, 0]): void {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.col.push(colour.r, colour.g, colour.b);
    this.uv.push(...uvs);
  }
  quad(a: number[], b: number[], c: number[], d: number[], [u0, v0, u1, v1]: number[], colour: THREE.Color): void {
    // Window tile = 4 m wide × 3.1 m storey
    const U0 = u0 / 4, U1 = u1 / 4, V0 = v0 / 3.1, V1 = v1 / 3.1;
    this.tri(a, b, c, colour, [U0, V0, U1, V0, U1, V1]);
    this.tri(a, c, d, colour, [U0, V0, U1, V1, U0, V1]);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

/** One bay × one storey, white-based so vertex colours tint the wall. */
function windowTexture(shop: boolean): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#2b3440';
  if (shop) g.fillRect(6, 14, 52, 36); else g.fillRect(20, 18, 24, 30);
  g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 60, 64, 4);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
