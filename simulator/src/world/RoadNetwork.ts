/**
 * Pure data description of the road grid. Rendering and collision both read
 * from this, and future systems (traffic, routes, stops) can too.
 */
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }

export class RoadNetwork {
  /** Centre-line coordinates of north–south (x) and east–west (z) roads. */
  readonly roadsX: number[] = [];
  readonly roadsZ: number[] = [];
  readonly blocks: Rect[] = [];
  readonly bounds: Rect;

  constructor(
    readonly gridSize = 5,        // blocks per side
    readonly spacing = 80,        // road centre to centre (m)
    readonly roadWidth = 14,      // kerb to kerb (m)
  ) {
    const half = (gridSize * spacing) / 2;
    for (let i = 0; i <= gridSize; i++) {
      this.roadsX.push(-half + i * spacing);
      this.roadsZ.push(-half + i * spacing);
    }
    const hw = roadWidth / 2;
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        this.blocks.push({
          minX: this.roadsX[i] + hw, maxX: this.roadsX[i + 1] - hw,
          minZ: this.roadsZ[j] + hw, maxZ: this.roadsZ[j + 1] - hw,
        });
      }
    }
    this.bounds = { minX: -half - hw, maxX: half + hw, minZ: -half - hw, maxZ: half + hw };
  }

  get extent(): number {
    return this.gridSize * this.spacing;
  }

  /** True if the point is on drivable road surface. */
  isOnRoad(x: number, z: number): boolean {
    const b = this.bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
    return !this.blocks.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
  }
}
