/** Grid index of road segments (side streets) for fast "is this on a road?" queries. */
export interface Street { w: number; n: string; p: number[] } // p = [x0,z0,x1,z1,...]

const CELL = 30;

export class StreetIndex {
  private segs: number[] = []; // ax, az, bx, bz, halfWidth per segment
  private grid = new Map<string, number[]>();

  constructor(streets: Street[]) {
    for (const st of streets) {
      for (let i = 0; i + 3 < st.p.length; i += 2) {
        const id = this.segs.length / 5;
        const [ax, az, bx, bz] = st.p.slice(i, i + 4), hw = st.w / 2;
        this.segs.push(ax, az, bx, bz, hw);
        for (let cx = Math.floor((Math.min(ax, bx) - hw) / CELL); cx <= Math.floor((Math.max(ax, bx) + hw) / CELL); cx++)
          for (let cz = Math.floor((Math.min(az, bz) - hw) / CELL); cz <= Math.floor((Math.max(az, bz) + hw) / CELL); cz++) {
            const k = `${cx},${cz}`;
            (this.grid.get(k) ?? this.grid.set(k, []).get(k)!).push(id);
          }
      }
    }
  }

  /** True if (x,z) is within a street's half width plus pad. */
  contains(x: number, z: number, pad = 0): boolean {
    const ids = this.grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!ids) return false;
    const s = this.segs;
    for (const id of ids) {
      const o = id * 5, ax = s[o], az = s[o + 1], dx = s[o + 2] - ax, dz = s[o + 3] - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < s[o + 4] + pad) return true;
    }
    return false;
  }
}
