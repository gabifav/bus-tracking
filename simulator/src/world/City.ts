import * as THREE from 'three';
import type { Collider } from '../vehicles/Bus';
import { RoadNetwork, type Rect } from './RoadNetwork';

/** Small deterministic RNG so the city looks the same every launch. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BUILDING_COLOURS = [0xd8c3a5, 0xc9b79c, 0xb5835a, 0x9e9e9e, 0xe8e2d4, 0x8fa3b0, 0xa65e46, 0xcfcfcf];

/** Builds the static city meshes and answers collision queries. */
export class City implements Collider {
  readonly group = new THREE.Group();

  constructor(readonly roads: RoadNetwork, seed = 2000) {
    const rand = mulberry32(seed);
    this.buildGround();
    this.buildRoads();
    this.buildBlocks(rand);
  }

  isBlocked(x: number, z: number): boolean {
    return !this.roads.isOnRoad(x, z);
  }

  private buildGround(): void {
    const size = this.roads.extent + 400;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: 0x5f8f4a, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  private buildRoads(): void {
    const { roadsX, roadsZ, roadWidth, extent } = this.roads;
    const len = extent + roadWidth;
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x3a3a3d, roughness: 0.95 });
    const roadGeoNS = new THREE.PlaneGeometry(roadWidth, len).rotateX(-Math.PI / 2);
    const roadGeoEW = new THREE.PlaneGeometry(len, roadWidth).rotateX(-Math.PI / 2);
    for (const x of roadsX) this.addFlat(new THREE.Mesh(roadGeoNS, asphalt), x, 0, 0);
    for (const z of roadsZ) this.addFlat(new THREE.Mesh(roadGeoEW, asphalt), 0, 0.001, z);

    // Dashed centre lines (instanced), skipping intersections
    const dashLen = 3, gap = 6;
    const positions: { x: number; z: number; rot: number }[] = [];
    const half = roadWidth / 2 + 2;
    const addLine = (fixed: number, along: number[], ns: boolean) => {
      for (let i = 0; i < along.length - 1; i++) {
        for (let t = along[i] + half; t < along[i + 1] - half; t += dashLen + gap) {
          const c = t + dashLen / 2;
          positions.push(ns ? { x: fixed, z: c, rot: 0 } : { x: c, z: fixed, rot: Math.PI / 2 });
        }
      }
    };
    for (const x of roadsX) addLine(x, roadsZ, true);
    for (const z of roadsZ) addLine(z, roadsX, false);

    const dashGeo = new THREE.PlaneGeometry(0.25, dashLen).rotateX(-Math.PI / 2);
    const dashes = new THREE.InstancedMesh(dashGeo, new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }), positions.length);
    const m = new THREE.Matrix4();
    positions.forEach((p, i) => {
      m.makeRotationY(p.rot).setPosition(p.x, 0.01, p.z);
      dashes.setMatrixAt(i, m);
    });
    this.group.add(dashes);
  }

  private buildBlocks(rand: () => number): void {
    const footpath = new THREE.MeshStandardMaterial({ color: 0xb8b4ab, roughness: 0.9 });
    const grass = new THREE.MeshStandardMaterial({ color: 0x4f8a3c, roughness: 1 });
    const buildings: { rect: Rect; h: number; colour: number }[] = [];
    const trees: THREE.Vector3[] = [];
    const n = this.roads.gridSize;

    this.roads.blocks.forEach((b, idx) => {
      const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      // Kerb / footpath slab
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.15, d), footpath);
      slab.position.set(cx, 0.075, cz);
      slab.receiveShadow = true;
      this.group.add(slab);

      const i = Math.floor(idx / n), j = idx % n;
      const isPark = (i + j * 3) % 7 === 3;
      if (isPark) {
        const lawn = new THREE.Mesh(new THREE.BoxGeometry(w - 6, 0.05, d - 6), grass);
        lawn.position.set(cx, 0.17, cz);
        lawn.receiveShadow = true;
        this.group.add(lawn);
        for (let k = 0; k < 12; k++) {
          trees.push(new THREE.Vector3(cx + (rand() - 0.5) * (w - 12), 0, cz + (rand() - 0.5) * (d - 12)));
        }
        return;
      }

      // Taller towers toward the centre (a mini CBD)
      const distToCentre = Math.hypot(cx, cz) / (this.roads.extent / 2);
      const heightScale = THREE.MathUtils.lerp(70, 12, Math.min(1, distToCentre));
      // Subdivide block into a 2x2 grid of lots, inset from the footpath
      const inset = 3, lotsX = 2, lotsZ = 2;
      const lw = (w - inset * 2) / lotsX, ld = (d - inset * 2) / lotsZ;
      for (let a = 0; a < lotsX; a++) {
        for (let c = 0; c < lotsZ; c++) {
          const minX = b.minX + inset + a * lw + 0.5, minZ = b.minZ + inset + c * ld + 0.5;
          buildings.push({
            rect: { minX, maxX: minX + lw - 1, minZ, maxZ: minZ + ld - 1 },
            h: 6 + rand() * heightScale,
            colour: BUILDING_COLOURS[Math.floor(rand() * BUILDING_COLOURS.length)],
          });
        }
      }
    });

    // Buildings: one instanced mesh, unit box scaled per instance
    const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const inst = new THREE.InstancedMesh(unit, new THREE.MeshStandardMaterial({ roughness: 0.8 }), buildings.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    const m = new THREE.Matrix4(), col = new THREE.Color();
    buildings.forEach((bd, k) => {
      const r = bd.rect;
      m.makeScale(r.maxX - r.minX, bd.h, r.maxZ - r.minZ).setPosition((r.minX + r.maxX) / 2, 0.15, (r.minZ + r.maxZ) / 2);
      inst.setMatrixAt(k, m);
      inst.setColorAt(k, col.setHex(bd.colour));
    });
    this.group.add(inst);

    // Trees: trunk + canopy instanced
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.25, 0.35, 3).translate(0, 1.5, 0),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2b }), trees.length);
    const canopy = new THREE.InstancedMesh(
      new THREE.SphereGeometry(2.2, 8, 6).translate(0, 4.2, 0),
      new THREE.MeshStandardMaterial({ color: 0x2f6b2a, roughness: 1 }), trees.length);
    canopy.castShadow = true;
    trees.forEach((p, k) => {
      m.makeTranslation(p.x, 0.15, p.z);
      trunk.setMatrixAt(k, m);
      canopy.setMatrixAt(k, m);
    });
    this.group.add(trunk, canopy);
  }

  private addFlat(mesh: THREE.Mesh, x: number, y: number, z: number): void {
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }
}
