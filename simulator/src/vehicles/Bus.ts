import * as THREE from 'three';
import type { DriveControls } from '../core/Input';
import { BUS_DIMENSIONS, createBusModel, type BusModel } from './BusModel';

/** Something the bus can collide with. Implemented by the world. */
export interface Collider {
  isBlocked(x: number, z: number): boolean;
}

/** Tunables kept together so they're easy to tweak or load per bus type later. */
export const BUS_SPEC = {
  maxSpeed: 19.5,        // m/s  (~70 km/h)
  maxReverse: 5,         // m/s
  engineAccel: 2.4,      // m/s² at standstill
  brakeDecel: 7.5,       // m/s²
  handbrakeDecel: 5,     // m/s²
  rollingDrag: 0.35,     // m/s²
  airDrag: 0.0025,       // per (m/s)²
  maxSteerAngle: 0.6,    // rad (~35°)
  steerRate: 1.6,        // rad/s toward target
};

/**
 * Arcade kinematic "bicycle model" bus. Position/heading live here, the
 * Three.js model just mirrors them, so physics can be swapped out later.
 */
export class Bus {
  readonly model: BusModel;
  readonly position = new THREE.Vector3();
  heading = 0;      // yaw radians; 0 faces +Z
  speed = 0;        // m/s along heading (negative = reversing)
  steerAngle = 0;   // rad, + = right
  private spawn = { x: 0, z: 0, heading: 0 };

  constructor() {
    this.model = createBusModel();
  }

  get object(): THREE.Object3D {
    return this.model.root;
  }

  get speedKmh(): number {
    return this.speed * 3.6;
  }

  setSpawn(x: number, z: number, heading: number): void {
    this.spawn = { x, z, heading };
    this.reset();
  }

  reset(): void {
    this.position.set(this.spawn.x, 0, this.spawn.z);
    this.heading = this.spawn.heading;
    this.speed = 0;
    this.steerAngle = 0;
    this.syncModel(0);
  }

  update(dt: number, c: DriveControls, world: Collider): void {
    const s = BUS_SPEC;
    const v = this.speed;

    // --- Longitudinal ---
    let accel = 0;
    if (v >= -0.3) {
      // Moving forward or (nearly) stopped
      if (c.throttle) accel += s.engineAccel * c.throttle * Math.max(0, 1 - v / s.maxSpeed);
      if (c.brake) accel -= v > 0.3 ? s.brakeDecel * c.brake : s.engineAccel * 0.6; // brake, then reverse
    } else {
      // Reversing: S drives backwards, W brakes
      if (c.brake) accel -= s.engineAccel * 0.6 * Math.max(0, 1 + v / s.maxReverse);
      if (c.throttle) accel += s.brakeDecel * c.throttle;
    }
    const resist = s.rollingDrag + s.airDrag * v * v + (c.handbrake ? s.handbrakeDecel : 0);
    const coasting = !c.throttle && !c.brake;

    let newV = v + accel * dt;
    // Resistance always opposes motion and never flips direction on its own
    const drop = resist * dt;
    if (Math.abs(newV) <= drop && (coasting || c.handbrake)) newV = 0;
    else newV -= Math.sign(newV) * Math.min(drop, Math.abs(newV));
    this.speed = THREE.MathUtils.clamp(newV, -s.maxReverse, s.maxSpeed);

    // --- Steering (less lock at speed for stability) ---
    const lock = s.maxSteerAngle / (1 + Math.abs(this.speed) / 10);
    const target = c.steer * lock;
    const step = s.steerRate * dt;
    this.steerAngle += THREE.MathUtils.clamp(target - this.steerAngle, -step, step);

    // --- Integrate (rear-axle bicycle model) ---
    const yawRate = (this.speed / BUS_DIMENSIONS.wheelbase) * Math.tan(this.steerAngle);
    const prevX = this.position.x, prevZ = this.position.z, prevH = this.heading;
    this.heading -= yawRate * dt;
    this.position.x += Math.sin(this.heading) * this.speed * dt;
    this.position.z += Math.cos(this.heading) * this.speed * dt;

    if (this.collides(world)) {
      this.position.x = prevX;
      this.position.z = prevZ;
      this.heading = prevH;
      this.speed *= -0.15; // small bounce off the kerb/building
    }

    this.syncModel(dt);
  }

  /** Samples points around the footprint against the world. */
  private collides(world: Collider): boolean {
    const { length, width } = BUS_DIMENSIONS;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx;
    const hl = length / 2, hw = width / 2;
    for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [0, hw], [0, -hw], [hl, 0], [-hl, 0]]) {
      if (world.isBlocked(this.position.x + fx * a + rx * b, this.position.z + fz * a + rz * b)) return true;
    }
    return false;
  }

  private syncModel(dt: number): void {
    const root = this.model.root;
    root.position.copy(this.position);
    root.rotation.y = this.heading;
    for (const p of this.model.frontWheels) p.rotation.y = -this.steerAngle;
    const spin = (this.speed * dt) / BUS_DIMENSIONS.wheelRadius;
    for (const w of this.model.allWheels) w.rotation.x += spin;
  }
}
