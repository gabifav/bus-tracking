import * as THREE from 'three';
import type { DriveControls } from '../core/Input';
import { BUS_DIMENSIONS, createBusModel, type BusModel } from './BusModel';

/** Something the bus can collide with. Implemented by the world. */
export interface Collider {
  isBlocked(x: number, z: number): boolean;
}

/** Tunables for a ~12 t rigid diesel city bus. Kept together so other bus types can load their own. */
export const BUS_SPEC = {
  mass: 12500,              // kg
  enginePower: 190000,      // W
  maxTractiveForce: 21000,  // N (traction / low-gear limit)
  maxBrakeDecel: 5.5,       // m/s² at full pedal
  handbrakeDecel: 4,        // m/s²
  rollingCoeff: 0.009,
  dragFactor: 3.2,          // 0.5·ρ·Cd·A
  maxSpeed: 19.5,           // m/s governor (~70 km/h)
  maxReverse: 3.5,          // m/s
  throttleRate: 1.5,        // pedal travel per second
  brakeRate: 3,             // brake pressure build per second
  maxSteerAngle: 0.62,      // rad
  steerRate: 0.9,           // rad/s when turning in
  returnRate: 1.5,          // rad/s self-centring
  gearUpshift: [0, 4, 7.5, 11.5, 15.5], // m/s at which each gear starts (5-speed auto)
  shiftTime: 0.45,          // s of torque interruption
  idleRpm: 650,
  maxRpm: 2200,
  rollStiffness: 0.012,     // rad per m/s² lateral
  pitchStiffness: 0.009,    // rad per m/s² longitudinal
};

const G = 9.81;

/**
 * Arcade-sim bus. A rear-axle bicycle model drives the yaw (so the front
 * swings wide and the rear overhang kicks out like a real bus), with
 * power-limited acceleration, an automatic gearbox, progressive brakes and
 * visual body roll and pitch. The Three.js model only mirrors this state.
 */
export class Bus {
  readonly model: BusModel;
  /** Centre of the bus footprint (derived from the rear axle). */
  readonly position = new THREE.Vector3();
  heading = 0;      // yaw radians; 0 faces +Z
  speed = 0;        // m/s along heading (negative = reversing)
  steerAngle = 0;   // rad, + = right

  // Drivetrain / feedback state, read by HUD and audio
  throttle = 0;
  brakePressure = 0;
  gear = 1;
  rpm = BUS_SPEC.idleRpm;
  longAccel = 0;
  latAccel = 0;

  reverse = false;
  private reverseHold = 0;
  private rear = new THREE.Vector2();   // rear axle x,z
  private shiftTimer = 0;
  private roll = 0; private rollVel = 0;
  private pitch = 0; private pitchVel = 0;
  private spawn = { x: 0, z: 0, heading: 0 };

  constructor() {
    this.model = createBusModel();
  }

  get object(): THREE.Object3D { return this.model.root; }
  get speedKmh(): number { return this.speed * 3.6; }
  get isShifting(): boolean { return this.shiftTimer > 0; }

  setSpawn(x: number, z: number, heading: number): void {
    this.spawn = { x, z, heading };
    this.reset();
  }

  reset(): void {
    this.heading = this.spawn.heading;
    const off = this.model.rearAxleZ;
    this.rear.set(this.spawn.x + Math.sin(this.heading) * off, this.spawn.z + Math.cos(this.heading) * off);
    this.speed = this.steerAngle = this.throttle = this.brakePressure = 0;
    this.roll = this.rollVel = this.pitch = this.pitchVel = 0;
    this.gear = 1;
    this.reverse = false;
    this.updateCentre();
    this.syncModel(0);
  }

  update(dt: number, c: DriveControls, world: Collider): void {
    const s = BUS_SPEC;
    const v = this.speed;
    // --- Direction: only changes at a standstill. Hold S while stopped to select reverse.
    if (Math.abs(v) < 0.3) {
      if (c.throttle && !c.brake) { this.reverse = false; this.reverseHold = 0; }
      else if (c.brake && !c.throttle && !this.reverse) {
        this.reverseHold += dt;
        if (this.reverseHold > 0.5) this.reverse = true;
      } else this.reverseHold = 0;
    } else this.reverseHold = 0;
    const reversing = this.reverse;

    // --- Pedals: in reverse, S drives and W brakes
    const wantThrottle = reversing ? c.brake : c.throttle;
    const wantBrake = reversing ? c.throttle : c.brake;
    this.throttle = approach(this.throttle, wantThrottle, s.throttleRate * dt);
    this.brakePressure = approach(this.brakePressure, Math.max(wantBrake, c.handbrake ? 0.6 : 0), s.brakeRate * dt);

    // --- Gearbox (automatic)
    if (reversing) this.gear = 1;
    else {
      const up = s.gearUpshift[this.gear], down = s.gearUpshift[this.gear - 1] - 1.5;
      if (up !== undefined && v >= up) { this.gear++; this.shiftTimer = s.shiftTime; }
      else if (this.gear > 1 && v < down) this.gear--;
    }
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    const lo = s.gearUpshift[this.gear - 1], hi = s.gearUpshift[this.gear] ?? s.maxSpeed * 1.15;
    const gearFrac = THREE.MathUtils.clamp((Math.abs(v) - lo) / (hi - lo), 0, 1);
    const rpmTarget = s.idleRpm + (s.maxRpm - s.idleRpm) * (this.gear === 1 ? Math.max(gearFrac, this.throttle * 0.35) : 0.45 + 0.55 * gearFrac);
    this.rpm = approach(this.rpm, rpmTarget, 3000 * dt);

    // --- Forces
    const dir = reversing ? -1 : 1;
    const absV = Math.abs(v);
    let drive = 0;
    if (!this.isShifting) {
      drive = Math.min(s.maxTractiveForce, s.enginePower / Math.max(absV, 1)) * this.throttle;
      const limit = reversing ? s.maxReverse : s.maxSpeed;
      if (absV > limit) drive = 0; // governor
    }
    const resist = s.rollingCoeff * s.mass * G + s.dragFactor * v * v;
    const brake = this.brakePressure * s.maxBrakeDecel * s.mass + (c.handbrake ? s.handbrakeDecel * s.mass : 0);

    const driveAccel = (dir * drive) / s.mass;
    const stopAccel = (resist + brake) / s.mass; // always opposes motion
    let newV = v + driveAccel * dt;
    if (Math.abs(newV) <= stopAccel * dt && Math.abs(driveAccel) <= stopAccel) newV = 0;
    else newV -= Math.sign(newV || dir) * stopAccel * dt;
    this.longAccel = (newV - v) / Math.max(dt, 1e-4);
    this.speed = newV;

    // --- Steering: slow, heavy, self-centring; less lock at speed
    const lock = s.maxSteerAngle / (1 + Math.abs(this.speed) / 14);
    const target = c.steer * lock;
    const rate = c.steer === 0 || Math.sign(target - this.steerAngle) !== Math.sign(this.steerAngle) ? s.returnRate : s.steerRate;
    this.steerAngle = approach(this.steerAngle, target, rate * dt);

    // --- Integrate about the rear axle
    const yawRate = (this.speed / BUS_DIMENSIONS.wheelbase) * Math.tan(this.steerAngle);
    this.latAccel = this.speed * yawRate;
    const prevRear = this.rear.clone(), prevH = this.heading;
    this.heading -= yawRate * dt;
    this.rear.x += Math.sin(this.heading) * this.speed * dt;
    this.rear.y += Math.cos(this.heading) * this.speed * dt;
    this.updateCentre();

    if (this.collides(world)) {
      this.rear.copy(prevRear);
      this.heading = prevH;
      this.updateCentre();
      this.speed *= -0.1;
      this.pitchVel += 0.4 * Math.sign(this.longAccel || 1); // jolt
    }

    // --- Suspension (visual spring-damper)
    const k = 45, damp = 2 * Math.sqrt(k) * 0.35;
    const rollT = this.latAccel * s.rollStiffness, pitchT = -this.longAccel * s.pitchStiffness;
    this.rollVel += ((rollT - this.roll) * k - this.rollVel * damp) * dt;
    this.pitchVel += ((pitchT - this.pitch) * k - this.pitchVel * damp) * dt;
    this.roll += this.rollVel * dt;
    this.pitch += this.pitchVel * dt;

    this.syncModel(dt);
  }

  private updateCentre(): void {
    const off = -this.model.rearAxleZ; // centre is ahead of the rear axle
    this.position.set(this.rear.x + Math.sin(this.heading) * off, 0, this.rear.y + Math.cos(this.heading) * off);
  }

  /** Samples points around the footprint against the world. */
  private collides(world: Collider): boolean {
    const { length, width } = BUS_DIMENSIONS;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx;
    const hl = length / 2, hw = width / 2;
    for (const [a, b] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [0, hw], [0, -hw], [hl, 0], [-hl, 0], [hl / 2, hw], [hl / 2, -hw], [-hl / 2, hw], [-hl / 2, -hw]]) {
      if (world.isBlocked(this.position.x + fx * a + rx * b, this.position.z + fz * a + rz * b)) return true;
    }
    return false;
  }

  private syncModel(dt: number): void {
    const { root, body } = this.model;
    root.position.copy(this.position);
    root.rotation.y = this.heading;
    body.rotation.set(this.pitch, 0, this.roll);
    for (const p of this.model.frontWheels) p.rotation.y = -this.steerAngle;
    const spin = (this.speed * dt) / BUS_DIMENSIONS.wheelRadius;
    for (const w of this.model.allWheels) w.rotation.x += spin;
  }
}

function approach(cur: number, target: number, step: number): number {
  return cur + THREE.MathUtils.clamp(target - cur, -step, step);
}
