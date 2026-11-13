/** A route centre-line in local metres with fast nearest-point queries. */
/** junction: radius of open asphalt at a corner (0 if the road just runs straight) */
export interface PathPoint { x: number; z: number; width: number; junction: number }
export interface PathSample { x: number; z: number; dirX: number; dirZ: number; width: number }
export interface Nearest { dist: number; s: number; side: number; width: number }

const CELL = 40;

export class RoutePath {
  readonly pts: PathPoint[];
  readonly cum: number[] = [0];  // arc length at each point
  readonly length: number;
  private grid = new Map<string, number[]>(); // cell -> segment indices

  constructor(raw: number[][]) {
    this.pts = raw.map(([x, z, w]) => ({ x, z, width: w, junction: 0 }));
    // Corners become intersection areas so a 12 m bus can swing through them, like a real one does
    for (let i = 1; i < this.pts.length - 1; i++) {
      const a = this.pts[i - 1], b = this.pts[i], c = this.pts[i + 1];
      const turn = Math.abs(Math.atan2((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)));
      if (turn > 0.35) b.junction = b.width / 2 + Math.min(9, 3 + turn * 5);
    }
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.length = this.cum[this.cum.length - 1];
    // Index each segment into every cell its bounding box (plus road margin) touches
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i], b = this.pts[i + 1], m = 22;
      for (let cx = Math.floor((Math.min(a.x, b.x) - m) / CELL); cx <= Math.floor((Math.max(a.x, b.x) + m) / CELL); cx++)
        for (let cz = Math.floor((Math.min(a.z, b.z) - m) / CELL); cz <= Math.floor((Math.max(a.z, b.z) + m) / CELL); cz++) {
          const k = `${cx},${cz}`;
          (this.grid.get(k) ?? this.grid.set(k, []).get(k)!).push(i);
        }
    }
  }

  /** Nearest point on the path. Returns Infinity distance if nothing within ~20 m. */
  nearest(x: number, z: number): Nearest {
    const segs = this.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    let best: Nearest = { dist: Infinity, s: 0, side: 0, width: 11 };
    if (!segs) return best;
    for (const i of segs) {
      const a = this.pts[i], b = this.pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
      const px = a.x + dx * t, pz = a.z + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best.dist) {
        // side > 0: left of travel direction (the kerb side in Sydney)
        best = { dist: d, s: this.cum[i] + Math.sqrt(l2) * t, side: Math.sign(dz * (x - a.x) - dx * (z - a.z)), width: a.width };
      }
    }
    return best;
  }

  /** True if (x,z) is inside a corner's intersection area, grown by pad metres. */
  inJunction(x: number, z: number, pad = 0): boolean {
    const segs = this.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!segs) return false;
    for (const i of segs) for (const p of [this.pts[i], this.pts[i + 1]]) {
      if (p.junction && (x - p.x) ** 2 + (z - p.z) ** 2 < (p.junction + pad) ** 2) return true;
    }
    return false;
  }

  /** Position and direction at arc length s. */
  at(s: number): PathSample {
    s = Math.max(0, Math.min(this.length, s));
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.cum[mid] <= s) lo = mid; else hi = mid; }
    const a = this.pts[lo], b = this.pts[hi];
    const seg = this.cum[hi] - this.cum[lo] || 1, t = (s - this.cum[lo]) / seg;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dirX: (b.x - a.x) / seg, dirZ: (b.z - a.z) / seg, width: a.width };
  }
}
