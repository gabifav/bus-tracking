import * as THREE from 'three';

export type CameraMode = 'chase' | 'far' | 'cab';

const MODES: Record<CameraMode, { back: number; up: number; look: number; lerp: number }> = {
  chase: { back: 16, up: 6.5, look: 6, lerp: 4 },
  far:   { back: 30, up: 14, look: 10, lerp: 3 },
  cab:   { back: -6.4, up: 2.3, look: 20, lerp: 30 }, // nose-mounted, offset to the driver's (right) side
};

/** Smoothly follows a target's position + heading from behind. */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private mode: CameraMode = 'chase';
  private readonly order: CameraMode[] = ['chase', 'far', 'cab'];
  private readonly desired = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private snapNext = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 2000);
  }

  cycleMode(): void {
    this.mode = this.order[(this.order.indexOf(this.mode) + 1) % this.order.length];
    this.snapNext = true;
  }

  update(dt: number, target: THREE.Vector3, heading: number, snap = false): void {
    const m = MODES[this.mode];
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const side = this.mode === 'cab' ? -0.6 : 0; // driver sits on the right (-X local)
    this.desired.set(target.x - fx * m.back + fz * side, target.y + m.up, target.z - fz * m.back - fx * side);
    const t = snap || this.snapNext ? 1 : 1 - Math.exp(-m.lerp * dt);
    this.camera.position.lerp(this.desired, t);
    this.snapNext = false;
    this.lookAt.set(target.x + fx * m.look, target.y + (this.mode === 'cab' ? 2 : 1.5), target.z + fz * m.look);
    this.camera.lookAt(this.lookAt);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
