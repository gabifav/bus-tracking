import * as THREE from 'three';
import { Input } from './Input';
import { Bus } from '../vehicles/Bus';
import { RoadNetwork } from '../world/RoadNetwork';
import { City } from '../world/City';
import { ChaseCamera } from '../camera/ChaseCamera';
import { Hud } from '../ui/Hud';
import { BusAudio } from '../audio/BusAudio';

/** Owns the renderer, scene and main loop; wires subsystems together. */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private clock = new THREE.Clock();
  private input = new Input();
  private hud = new Hud();
  private audio = new BusAudio();
  private cam: ChaseCamera;
  private sun: THREE.DirectionalLight;
  readonly roads = new RoadNetwork();
  readonly city = new City(this.roads);
  readonly bus = new Bus();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x87b5e0);
    this.scene.fog = new THREE.Fog(0x87b5e0, 150, 600);

    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a3a, 1.1));
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -60; sc.right = sc.top = 60; sc.near = 1; sc.far = 300;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(this.city.group, this.bus.object);

    // Spawn mid-block on the centre-ish north–south road, in the left lane, facing +Z
    const x = this.roads.roadsX[Math.floor(this.roads.roadsX.length / 2)];
    const z = (this.roads.roadsZ[2] + this.roads.roadsZ[3]) / 2;
    this.bus.setSpawn(x + this.roads.roadWidth / 4, z - 20, 0);

    this.cam = new ChaseCamera(window.innerWidth / window.innerHeight);
    this.cam.update(0, this.bus.position, this.bus.heading, true);

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.cam.resize(window.innerWidth / window.innerHeight);
    });
  }

  start(): void {
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private tick(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05); // clamp after tab switches

    if (this.input.wasPressed('KeyR')) this.bus.reset();
    if (this.input.wasPressed('KeyC')) this.cam.cycleMode();
    if (this.input.wasPressed('KeyM')) this.audio.toggleMute();

    this.bus.update(dt, this.input.getDriveControls(), this.city);
    this.cam.update(dt, this.bus.position, this.bus.heading);

    // Keep the shadow frustum centred on the bus
    const p = this.bus.position;
    this.sun.position.set(p.x + 40, 80, p.z + 25);
    this.sun.target.position.copy(p);

    this.hud.update(this.bus.speedKmh, this.bus.reverse, this.bus.gear, this.bus.rpm);
    this.audio.update(this.bus);
    this.input.endFrame();
    this.renderer.render(this.scene, this.cam.camera);
  }
}
