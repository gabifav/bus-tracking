import type { Bus } from '../vehicles/Bus';

/**
 * Procedural diesel engine and air-brake sounds (Web Audio, no samples).
 * Browsers only allow audio after a user gesture, so it starts on the first key press.
 */
export class BusAudio {
  private ctx?: AudioContext;
  private master?: GainNode;
  private oscA?: OscillatorNode;
  private oscB?: OscillatorNode;
  private filter?: BiquadFilterNode;
  private engineGain?: GainNode;
  private noise?: AudioBuffer;
  private muted = false;
  private braking = 0; // seconds the brake has been held while moving

  constructor() {
    const start = () => { this.init(); window.removeEventListener('keydown', start); };
    window.addEventListener('keydown', start);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  private init(): void {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.15;
    this.oscA = ctx.createOscillator(); this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator(); this.oscB.type = 'square';
    const bGain = ctx.createGain(); bGain.gain.value = 0.35;
    this.oscA.connect(this.filter);
    this.oscB.connect(bGain).connect(this.filter);
    this.filter.connect(this.engineGain).connect(this.master);
    this.oscA.start(); this.oscB.start();

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  update(bus: Bus): void {
    const ctx = this.ctx;
    if (!ctx || !this.oscA || !this.oscB || !this.filter || !this.engineGain) return;
    const t = ctx.currentTime;
    // 6-cylinder four-stroke: 3 firing pulses per revolution
    const f = (bus.rpm / 60) * 3;
    const load = bus.isShifting ? 0 : bus.throttle;
    this.oscA.frequency.setTargetAtTime(f, t, 0.05);
    this.oscB.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.filter.frequency.setTargetAtTime(250 + load * 900 + bus.rpm * 0.15, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.1 + load * 0.18, t, 0.1);

    // Air-brake "psssh" when the bus comes to rest after braking
    if (Math.abs(bus.speed) > 0.5 && bus.brakePressure > 0.3) this.braking += 1 / 60;
    if (Math.abs(bus.speed) < 0.05 && this.braking > 0.5) { this.hiss(); this.braking = 0; }
    if (Math.abs(bus.speed) > 0.5 && bus.brakePressure < 0.05) this.braking = 0;
  }

  private hiss(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    src.connect(hp).connect(g).connect(this.master!);
    src.start(t); src.stop(t + 1);
  }
}
