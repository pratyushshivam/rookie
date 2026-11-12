/**
 * The stage: one canvas the size of the window. It draws the sheet of paper,
 * the track as an ink drawing, the tyre marks that build up on it, and the cars.
 */
import { CAR_LENGTH, CAR_WIDTH, HALF_WIDTH, RAY_ANGLES, RAY_RANGE, type Car, type Pt, type Track } from "../engine";

export const INK = "#15140f";
export const PAPER = "#f2eee5";
export const SHEET = "#f8f5ee";
export const ROAD = "#fdfbf6";
export const ACCENT = "#d4491a";
export const YOU = "#2a5c8f";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A way of looking at the paper: which world point sits at which screen point, turned and scaled how. */
export interface Camera {
  /** World point under the anchor. */
  x: number;
  y: number;
  /** Rotation of the world on screen, radians. */
  angle: number;
  /** Screen pixels per world unit. */
  zoom: number;
  /** Screen point the world point is pinned to. */
  ax: number;
  ay: number;
}

/** Tyre marks are kept on their own canvas at this many pixels per world unit. */
const MARK_SCALE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 1.5 : 2;

export interface TrackArt {
  road: Path2D;
  left: Path2D;
  right: Path2D;
  kerbs: Path2D;
  line: Path2D;
  grid: Path2D;
}

function loop(xs: Float64Array, ys: Float64Array): Path2D {
  const p = new Path2D();
  p.moveTo(xs[0], ys[0]);
  for (let i = 1; i < xs.length; i++) p.lineTo(xs[i], ys[i]);
  p.closePath();
  return p;
}

/** The paths a track is drawn with, in world units. Built once per track. */
export function trackArt(t: Track): TrackArt {
  const left = loop(t.lx, t.ly);
  const right = loop(t.rx, t.ry);
  const road = new Path2D();
  road.addPath(left);
  road.addPath(right);

  // Kerbs sit just inside the road on the inside of every real bend.
  const kerbs = new Path2D();
  const inset = HALF_WIDTH - 3.2;
  let open = false;
  for (let k = 0; k <= t.n; k++) {
    const i = k % t.n;
    const bend = (t.kappa[(i - 1 + t.n) % t.n] + t.kappa[i] + t.kappa[(i + 1) % t.n]) / 3;
    if (Math.abs(bend) > 1 / 150 && k < t.n) {
      // Positive bend turns right, so the inside is the right-hand edge.
      const s = bend > 0 ? -1 : 1;
      const x = t.x[i] + t.ty[i] * inset * s;
      const y = t.y[i] - t.tx[i] * inset * s;
      if (open) kerbs.lineTo(x, y);
      else kerbs.moveTo(x, y);
      open = true;
    } else open = false;
  }

  // The start line: two rows of small squares across the road.
  const line = new Path2D();
  const cells = 8;
  const size = (2 * HALF_WIDTH) / cells;
  const nx = t.ty[0];
  const ny = -t.tx[0];
  for (let row = 0; row < 2; row++) {
    for (let c = 0; c < cells; c++) {
      if ((row + c) % 2) continue;
      const ox = t.x[0] + nx * (-HALF_WIDTH + c * size) + t.tx[0] * (row - 1) * size;
      const oy = t.y[0] + ny * (-HALF_WIDTH + c * size) + t.ty[0] * (row - 1) * size;
      line.moveTo(ox, oy);
      line.lineTo(ox + nx * size, oy + ny * size);
      line.lineTo(ox + nx * size + t.tx[0] * size, oy + ny * size + t.ty[0] * size);
      line.lineTo(ox + t.tx[0] * size, oy + t.ty[0] * size);
      line.closePath();
    }
  }

  // Faint dots on the paper, so movement can be read against something.
  const grid = new Path2D();
  const step = 44;
  for (let y = step / 2; y < t.h; y += step) {
    for (let x = step / 2; x < t.w; x += step) {
      grid.moveTo(x + 1, y);
      grid.arc(x, y, 1, 0, Math.PI * 2);
    }
  }
  return { road, left, right, kerbs, line, grid };
}

export class Stage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  dpr = 1;
  width = 0;
  height = 0;
  cam: Camera = { x: 0, y: 0, angle: 0, zoom: 1, ax: 0, ay: 0 };
  paper = { w: 1000, h: 800 };
  private marks: HTMLCanvasElement | null = null;
  private marksCtx: CanvasRenderingContext2D | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    const w = Math.round(this.width * this.dpr);
    const h = Math.round(this.height * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /** A new sheet of paper: its size, and a clean layer for tyre marks. */
  setPaper(w: number, h: number): void {
    this.paper = { w, h };
    this.clearMarks();
  }

  clearMarks(): void {
    const { w, h } = this.paper;
    if (!this.marks) {
      this.marks = document.createElement("canvas");
      this.marksCtx = this.marks.getContext("2d")!;
    }
    this.marks.width = Math.round(w * MARK_SCALE);
    this.marks.height = Math.round(h * MARK_SCALE);
    const m = this.marksCtx!;
    m.setTransform(MARK_SCALE, 0, 0, MARK_SCALE, 0, 0);
    m.lineCap = "round";
  }

  /** The camera that shows the whole sheet inside a box, turned on its side if that fits better. */
  fit(box: Box): Camera {
    const { w, h } = this.paper;
    const straight = Math.min(box.w / w, box.h / h);
    const turned = Math.min(box.w / h, box.h / w);
    const turn = turned > straight * 1.25;
    return {
      x: w / 2,
      y: h / 2,
      angle: turn ? -Math.PI / 2 : 0,
      zoom: turn ? turned : straight,
      ax: box.x + box.w / 2,
      ay: box.y + box.h / 2,
    };
  }

  /** Screen point to world point, under the current camera. */
  toWorld(sx: number, sy: number): Pt {
    const { x, y, angle, zoom, ax, ay } = this.cam;
    const dx = (sx - ax) / zoom;
    const dy = (sy - ay) / zoom;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    return { x: x + dx * cos - dy * sin, y: y + dx * sin + dy * cos };
  }

  toScreen(wx: number, wy: number): Pt {
    const { x, y, angle, zoom, ax, ay } = this.cam;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = (wx - x) * zoom;
    const dy = (wy - y) * zoom;
    return { x: ax + dx * cos - dy * sin, y: ay + dx * sin + dy * cos };
  }

  private world(): void {
    const { x, y, angle, zoom, ax, ay } = this.cam;
    const k = zoom * this.dpr;
    const cos = Math.cos(angle) * k;
    const sin = Math.sin(angle) * k;
    this.ctx.setTransform(cos, sin, -sin, cos, ax * this.dpr - (cos * x - sin * y), ay * this.dpr - (sin * x + cos * y));
  }

  /**
   * Clears the window and lays down the sheet of paper. With `clip`, drawing is
   * kept inside that box and the whole box is paper: the race camera moves
   * over the sheet instead of showing all of it.
   */
  begin(clip?: Box): void {
    const { ctx, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = SHEET;
    if (clip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(clip.x * dpr, clip.y * dpr, clip.w * dpr, clip.h * dpr);
      ctx.clip();
      ctx.fill();
      this.world();
    } else {
      this.world();
      ctx.fillRect(0, 0, this.paper.w, this.paper.h);
    }
  }

  /** The hairline round the sheet. Drawn last so nothing overlaps it. */
  end(clip?: Box): void {
    const { ctx, dpr } = this;
    ctx.strokeStyle = "rgba(21,20,15,0.3)";
    if (clip) {
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.lineWidth = dpr;
      ctx.strokeRect(clip.x * dpr, clip.y * dpr, clip.w * dpr, clip.h * dpr);
    } else {
      this.world();
      ctx.lineWidth = 1 / this.cam.zoom;
      ctx.strokeRect(0, 0, this.paper.w, this.paper.h);
    }
  }

  dots(art: TrackArt, alpha = 1): void {
    const { ctx } = this;
    ctx.fillStyle = `rgba(21,20,15,${0.1 * alpha})`;
    ctx.fill(art.grid);
  }

  /**
   * The track. `reveal` runs 0 .. 1 while a new track draws itself in.
   * Tyre marks go between the road surface and its edges.
   */
  track(t: Track, art: TrackArt, reveal = 1, marks = true): void {
    const { ctx } = this;
    const px = 1 / this.cam.zoom;
    ctx.globalAlpha = Math.min(1, reveal * reveal * 1.4);
    ctx.fillStyle = ROAD;
    ctx.fill(art.road, "evenodd");
    ctx.globalAlpha = 1;
    if (marks && this.marks) ctx.drawImage(this.marks, 0, 0, this.paper.w, this.paper.h);

    if (reveal < 1) ctx.setLineDash([t.length * 1.25 * reveal, t.length * 4]);
    ctx.lineJoin = "round";
    ctx.lineCap = "butt";
    if (reveal >= 1) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 3.4;
      ctx.setLineDash([7, 7]);
      ctx.stroke(art.kerbs);
      ctx.setLineDash([]);
      ctx.fillStyle = INK;
      ctx.fill(art.line);
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1.5, 1.5 * px);
    ctx.stroke(art.left);
    ctx.stroke(art.right);
    ctx.setLineDash([]);
  }

  /** A line being drawn, or the hint of one. Points are in world units. */
  stroke(points: Pt[], color: string, alpha: number, width: number, upTo = points.length, dashed = false): void {
    if (points.length < 2 || upTo < 2) return;
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < upTo && i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width / this.cam.zoom;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (dashed) ctx.setLineDash([0.1, (width * 2.6) / this.cam.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  /** A dotted line from a flat list of x, y pairs: the rookie's line in the race. */
  path(xy: number[], color: string, alpha: number): void {
    const { ctx } = this;
    ctx.beginPath();
    for (let i = 0; i < xy.length; i += 2) {
      if (i === 0) ctx.moveTo(xy[0], xy[1]);
      else ctx.lineTo(xy[i], xy[i + 1]);
    }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 7]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  ring(x: number, y: number, radius: number, color: string, alpha: number, width = 2): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width / this.cam.zoom;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  dot(x: number, y: number, radius: number, color: string, alpha = 1): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** One car, seen from above. `outline` draws only its shape, for cars that are out. */
  car(x: number, y: number, heading: number, color: string, alpha = 1, scale = 1, outline = false): void {
    const { ctx } = this;
    const L = CAR_LENGTH * scale;
    const W = CAR_WIDTH * scale;
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    ctx.save();
    ctx.transform(cos, sin, -sin, cos, x, y);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.roundRect(-L / 2, -W / 2, L, W, W * 0.32);
    if (outline) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
      // Windscreen, so the nose can be told from the tail.
      ctx.fillStyle = "rgba(253,251,246,0.82)";
      ctx.beginPath();
      ctx.roundRect(L * 0.08, -W * 0.34, L * 0.2, W * 0.68, W * 0.12);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The leader's seven feelers, each as long as the distance it is reading. */
  rays(car: Car, readings: Float32Array, color: string, alpha = 1): void {
    const { ctx } = this;
    ctx.globalAlpha = 0.55 * alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / this.cam.zoom;
    ctx.beginPath();
    for (let r = 0; r < RAY_ANGLES.length; r++) {
      const a = car.heading + RAY_ANGLES[r];
      const d = readings[r] * RAY_RANGE;
      ctx.moveTo(car.x, car.y);
      ctx.lineTo(car.x + Math.cos(a) * d, car.y + Math.sin(a) * d);
    }
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    for (let r = 0; r < RAY_ANGLES.length; r++) {
      if (readings[r] >= 1) continue;
      const a = car.heading + RAY_ANGLES[r];
      const d = readings[r] * RAY_RANGE;
      ctx.beginPath();
      ctx.arc(car.x + Math.cos(a) * d, car.y + Math.sin(a) * d, 2.2 / Math.sqrt(this.cam.zoom), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Adds tyre marks: for each car, a pair of thin lines from where its wheels
   * were to where they are. `segs` is x0, y0, x1, y1, heading, weight per car.
   */
  addMarks(segs: number[], color = "21,20,15"): void {
    const m = this.marksCtx;
    if (!m) return;
    for (const heavy of [false, true]) {
      m.beginPath();
      let any = false;
      for (let i = 0; i < segs.length; i += 6) {
        if (segs[i + 5] > 1 !== heavy) continue;
        const nx = -Math.sin(segs[i + 4]) * CAR_WIDTH * 0.36;
        const ny = Math.cos(segs[i + 4]) * CAR_WIDTH * 0.36;
        m.moveTo(segs[i] + nx, segs[i + 1] + ny);
        m.lineTo(segs[i + 2] + nx, segs[i + 3] + ny);
        m.moveTo(segs[i] - nx, segs[i + 1] - ny);
        m.lineTo(segs[i + 2] - nx, segs[i + 3] - ny);
        any = true;
      }
      if (!any) continue;
      m.strokeStyle = `rgba(${color},${heavy ? 0.2 : 0.045})`;
      m.lineWidth = heavy ? 1.7 : 1.2;
      m.stroke();
    }
  }

  /** The marks layer, for the picture card. */
  marksImage(): HTMLCanvasElement | null {
    return this.marks;
  }
}

/** Moves one camera part of the way towards another. */
export function blend(a: Camera, b: Camera, t: number): Camera {
  let turn = b.angle - a.angle;
  while (turn > Math.PI) turn -= 2 * Math.PI;
  while (turn < -Math.PI) turn += 2 * Math.PI;
  const mix = (p: number, q: number): number => p + (q - p) * t;
  return {
    x: mix(a.x, b.x),
    y: mix(a.y, b.y),
    angle: a.angle + turn * t,
    zoom: a.zoom * Math.pow(b.zoom / a.zoom, t),
    ax: mix(a.ax, b.ax),
    ay: mix(a.ay, b.ay),
  };
}
