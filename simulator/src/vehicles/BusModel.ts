import * as THREE from 'three';

/** Dimensions shared between the visual model and the physics. */
export const BUS_DIMENSIONS = { length: 12, width: 2.5, height: 3.1, wheelbase: 6.2, wheelRadius: 0.5 };

export interface BusModel {
  root: THREE.Group;
  body: THREE.Group;             // sprung mass: rolls and pitches
  /** Local Z of the rear axle; the bus pivots about this point. */
  rearAxleZ: number;
  frontWheels: THREE.Object3D[]; // steer pivots
  allWheels: THREE.Mesh[];       // for spin animation
}

/**
 * Procedural Sydney-style rigid bus: white body, blue lower livery band,
 * dark glazing, destination sign. Local frame: +Z is forward, Y up.
 */
export function createBusModel(): BusModel {
  const { length: L, width: W, height: H, wheelRadius: R } = BUS_DIMENSIONS;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

  const floorY = 0.35;
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    body.add(mesh);
    return mesh;
  };

  const white = mat(0xf2f4f5);
  const blue = mat(0x1f5fa8);
  const glass = mat(0x1a2530, { roughness: 0.15, metalness: 0.3 });
  const black = mat(0x151515);

  // Body
  const bodyH = H - floorY;
  box(W, bodyH, L, white, 0, floorY + bodyH / 2, 0);
  // Livery band (slightly proud of the body)
  box(W + 0.02, 0.55, L + 0.02, blue, 0, floorY + 0.45, 0);
  // Side windows
  box(W + 0.03, 1.0, L - 1.8, glass, 0, floorY + 1.75, -0.3);
  // Windscreen + rear window
  box(W - 0.2, 1.5, 0.05, glass, 0, floorY + 1.55, L / 2 + 0.01);
  box(W - 0.4, 0.8, 0.05, glass, 0, floorY + 1.9, -L / 2 - 0.01);
  // Destination sign
  box(W - 0.6, 0.3, 0.06, mat(0xffb000, { emissive: 0xff8800, emissiveIntensity: 0.6 }), 0, H - 0.3, L / 2 + 0.02);
  // Roof pod (A/C unit)
  box(W - 0.6, 0.25, 3, white, 0, H + 0.12, -1.5);
  // Bumpers
  box(W, 0.3, 0.15, black, 0, floorY + 0.15, L / 2 + 0.05);
  box(W, 0.3, 0.15, black, 0, floorY + 0.15, -L / 2 - 0.05);
  // Headlights / tail lights
  const head = mat(0xffffee, { emissive: 0xffffcc, emissiveIntensity: 0.8 });
  const tail = mat(0xaa0000, { emissive: 0xff0000, emissiveIntensity: 0.5 });
  for (const s of [-1, 1]) {
    box(0.4, 0.2, 0.05, head, s * (W / 2 - 0.35), floorY + 0.55, L / 2 + 0.02);
    box(0.3, 0.3, 0.05, tail, s * (W / 2 - 0.3), floorY + 0.6, -L / 2 - 0.02);
  }
  // Front door on the kerb (left) side — Sydney drives on the left
  box(0.04, 2.1, 1.1, glass, -W / 2 - 0.01, floorY + 1.1, L / 2 - 1.2);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(R, R, 0.35, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = mat(0x222222, { roughness: 0.9 });
  const hubMat = mat(0x999999, { metalness: 0.5 });
  const hubGeo = new THREE.CylinderGeometry(R * 0.5, R * 0.5, 0.37, 8);
  hubGeo.rotateZ(Math.PI / 2);

  const frontZ = L / 2 - 2.6;
  const rearZ = frontZ - BUS_DIMENSIONS.wheelbase;
  const frontWheels: THREE.Object3D[] = [];
  const allWheels: THREE.Mesh[] = [];
  for (const z of [frontZ, rearZ]) {
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * (W / 2 - 0.15), R, z);
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.castShadow = true;
      wheel.add(new THREE.Mesh(hubGeo, hubMat));
      pivot.add(wheel);
      root.add(pivot);
      allWheels.push(wheel);
      if (z === frontZ) frontWheels.push(pivot);
    }
  }

  return { root, body, rearAxleZ: rearZ, frontWheels, allWheels };
}
