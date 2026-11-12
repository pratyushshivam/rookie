/**
 * A uniform grid over the wall segments, so a sensor ray only tests the few
 * walls near its path instead of every wall on the track.
 */
export class WallGrid {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  /** Segment end points: ax, ay, bx, by for segment k at 4k. */
  readonly seg: Float64Array;
  readonly count: number;
  /** cellStart[c] .. cellStart[c + 1] indexes into cellItems. */
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;
  /** Last query that tested each segment, so a wall lying in two cells is tested once. */
  private readonly seen: Int32Array;
  private query = 0;

  constructor(seg: Float64Array, width: number, height: number, cell = 48) {
    this.seg = seg;
    this.count = seg.length / 4;
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil(width / cell));
    this.rows = Math.max(1, Math.ceil(height / cell));
    this.seen = new Int32Array(this.count);

    // Two passes: count the cells each wall's bounding box covers, then fill.
    const cells = this.cols * this.rows;
    const counts = new Int32Array(cells + 1);
    const each = (fn: (c: number, k: number) => void): void => {
      for (let k = 0; k < this.count; k++) {
        const ax = seg[4 * k];
        const ay = seg[4 * k + 1];
        const bx = seg[4 * k + 2];
        const by = seg[4 * k + 3];
        const c0 = this.clampCol(Math.floor(Math.min(ax, bx) / cell));
        const c1 = this.clampCol(Math.floor(Math.max(ax, bx) / cell));
        const r0 = this.clampRow(Math.floor(Math.min(ay, by) / cell));
        const r1 = this.clampRow(Math.floor(Math.max(ay, by) / cell));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * this.cols + c, k);
      }
    };
    each((c) => counts[c + 1]++);
    for (let c = 0; c < cells; c++) counts[c + 1] += counts[c];
    this.cellStart = counts;
    this.cellItems = new Int32Array(counts[cells]);
    const fill = counts.slice(0, cells);
    each((c, k) => {
      this.cellItems[fill[c]++] = k;
    });
  }

  private clampCol(c: number): number {
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  private clampRow(r: number): number {
    return r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
  }

  /**
   * Distance from (ox, oy) along the unit direction (dx, dy) to the nearest wall,
   * or `range` if there is none that close. Walks the grid cell by cell along the ray.
   */
  raycast(ox: number, oy: number, dx: number, dy: number, range: number): number {
    const { cell, cols, rows, seg, cellStart, cellItems, seen } = this;
    const q = ++this.query;
    let cx = Math.floor(ox / cell);
    let cy = Math.floor(oy / cell);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const invX = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
    const invY = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (cx + 1) * cell - ox : ox - cx * cell) * invX) : Infinity;
    let tMaxY = dy !== 0 ? ((dy > 0 ? (cy + 1) * cell - oy : oy - cy * cell) * invY) : Infinity;
    const tDeltaX = cell * invX;
    const tDeltaY = cell * invY;
    let best = range;
    let tEnter = 0;

    while (tEnter <= best) {
      if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) {
        const c = cy * cols + cx;
        for (let n = cellStart[c]; n < cellStart[c + 1]; n++) {
          const k = cellItems[n];
          if (seen[k] === q) continue;
          seen[k] = q;
          const ax = seg[4 * k];
          const ay = seg[4 * k + 1];
          const ex = seg[4 * k + 2] - ax;
          const ey = seg[4 * k + 3] - ay;
          const den = dx * ey - dy * ex;
          if (den === 0) continue;
          const wx = ax - ox;
          const wy = ay - oy;
          const t = (wx * ey - wy * ex) / den;
          if (t < 0 || t >= best) continue;
          const u = (wx * dy - wy * dx) / den;
          if (u >= 0 && u <= 1) best = t;
        }
      }
      if (tMaxX < tMaxY) {
        tEnter = tMaxX;
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        tEnter = tMaxY;
        tMaxY += tDeltaY;
        cy += stepY;
      }
      if (tEnter === Infinity) break;
    }
    return best;
  }
}
