/**
 * Tracks. A track is stored as a short closed list of whole-number control
 * points; everything else (centre line, edges, wall index, speed profile) is
 * rebuilt from those points the same way every time, which is what lets a
 * track travel in a link.
 */
import {
  BRAKE,
  CTRL_SPACING,
  GAP_ARC,
  GRIP,
  HALF_WIDTH,
  MARGIN,
  MAX_LENGTH,
  MAX_SPEED,
  MIN_LENGTH,
  RELAX_GAP,
  RELAX_RADIUS,
  SAMPLE_SPACING,
  VALID_GAP,
  VALID_RADIUS,
} from "./config";
import { WallGrid } from "./grid";

export interface Pt {
  x: number;
  y: number;
}

export interface Track {
  /** Size of the sheet of paper the track lies on. */
  w: number;
  h: number;
  /** Control points, x0 y0 x1 y1 ... The start line is at the first one. */
  ctrl: Int16Array;
  /** Number of centre-line samples. Sample 0 is the start line. */
  n: number;
  x: Float64Array;
  y: Float64Array;
  /** Unit direction of travel at each sample. */
  tx: Float64Array;
  ty: Float64Array;
  /** Distance along the road to each sample (n + 1 entries, the last is the length). */
  cum: Float64Array;
  length: number;
  /** Signed bend at each sample: 1 / radius, positive when turning right on screen. */
  kappa: Float64Array;
  /** Left and right edges of the road. */
  lx: Float64Array;
  ly: Float64Array;
  rx: Float64Array;
  ry: Float64Array;
  walls: WallGrid;
  /** The speed a careful driver would hold at each sample. */
  safe: Float64Array;
}

/** Why a drawing could not become a track, and where on the paper the trouble is. */
export interface Fault {
  kind: "short" | "flat" | "tight" | "pinch" | "long";
  x: number;
  y: number;
}

export type StrokeResult = { ok: true; track: Track } | { ok: false; fault: Fault };

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- building a track from control points ----------

export function buildTrack(ctrl: Int16Array, w: number, h: number): Track {
  const K = ctrl.length >> 1;
  const SUB = 8;
  const dense: number[] = [];
  // A closed uniform cubic B-spline: smooth bend everywhere, built from + - * only.
  for (let i = 0; i < K; i++) {
    const a = ((i - 1 + K) % K) * 2;
    const b = i * 2;
    const c = ((i + 1) % K) * 2;
    const d = ((i + 2) % K) * 2;
    for (let j = 0; j < SUB; j++) {
      const t = j / SUB;
      const t2 = t * t;
      const t3 = t2 * t;
      const w0 = (1 - 3 * t + 3 * t2 - t3) / 6;
      const w1 = (3 * t3 - 6 * t2 + 4) / 6;
      const w2 = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
      const w3 = t3 / 6;
      dense.push(
        w0 * ctrl[a] + w1 * ctrl[b] + w2 * ctrl[c] + w3 * ctrl[d],
        w0 * ctrl[a + 1] + w1 * ctrl[b + 1] + w2 * ctrl[c + 1] + w3 * ctrl[d + 1],
      );
    }
  }
  const m = dense.length >> 1;
  let total = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    total += Math.hypot(dense[2 * j] - dense[2 * i], dense[2 * j + 1] - dense[2 * i + 1]);
  }

  // Walk the dense curve and drop a sample every `step` units.
  const n = Math.max(24, Math.round(total / SAMPLE_SPACING));
  const step = total / n;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  let at = 0;
  let walked = 0;
  for (let k = 0; k < n; k++) {
    const want = k * step;
    for (;;) {
      const j = (at + 1) % m;
      const len = Math.hypot(dense[2 * j] - dense[2 * at], dense[2 * j + 1] - dense[2 * at + 1]);
      if (walked + len >= want || at >= m - 1) {
        const f = len > 0 ? Math.min(1, Math.max(0, (want - walked) / len)) : 0;
        x[k] = dense[2 * at] + (dense[2 * j] - dense[2 * at]) * f;
        y[k] = dense[2 * at + 1] + (dense[2 * j + 1] - dense[2 * at + 1]) * f;
        break;
      }
      walked += len;
      at++;
    }
  }

  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  const cum = new Float64Array(n + 1);
  const kappa = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n;
    const q = (i + 1) % n;
    const dx = x[q] - x[p];
    const dy = y[q] - y[p];
    const len = Math.hypot(dx, dy) || 1;
    tx[i] = dx / len;
    ty[i] = dy / len;
    cum[i + 1] = cum[i] + Math.hypot(x[q] - x[i], y[q] - y[i]);
    const ax = x[i] - x[p];
    const ay = y[i] - y[p];
    const bx = x[q] - x[i];
    const by = y[q] - y[i];
    const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    kappa[i] = turn / (0.5 * (Math.hypot(ax, ay) + Math.hypot(bx, by)) || 1);
  }
  const length = cum[n];

  const lx = new Float64Array(n);
  const ly = new Float64Array(n);
  const rx = new Float64Array(n);
  const ry = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lx[i] = x[i] + ty[i] * HALF_WIDTH;
    ly[i] = y[i] - tx[i] * HALF_WIDTH;
    rx[i] = x[i] - ty[i] * HALF_WIDTH;
    ry[i] = y[i] + tx[i] * HALF_WIDTH;
  }
  const seg = new Float64Array(n * 8);
  for (let i = 0; i < n; i++) {
    const q = (i + 1) % n;
    seg.set([lx[i], ly[i], lx[q], ly[q], rx[i], ry[i], rx[q], ry[q]], i * 8);
  }

  // The careful driver's speed: what the tyres hold in each bend, then a pass
  // backwards so there is always room to brake for the bend ahead.
  const safe = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let bend = 0;
    for (let k = -2; k <= 2; k++) bend = Math.max(bend, Math.abs(kappa[(i + k + n) % n]));
    safe[i] = Math.min(MAX_SPEED, Math.sqrt((GRIP * 0.86) / Math.max(bend, 1e-6)));
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const q = (i + 1) % n;
      const reach = Math.sqrt(safe[q] * safe[q] + 2 * BRAKE * 0.7 * (cum[i + 1] - cum[i]));
      if (reach < safe[i]) safe[i] = reach;
    }
  }

  return { w, h, ctrl, n, x, y, tx, ty, cum, length, kappa, lx, ly, rx, ry, walls: new WallGrid(seg, w, h), safe };
}

// ---------- where is a point on the track ----------

export interface Place {
  /** Sample at the start of the nearest stretch of centre line. */
  i: number;
  /** Distance along the road from the start line, 0 .. length. */
  s: number;
  /** Distance from the centre line; positive is left of the direction of travel. */
  side: number;
}

/**
 * Nearest point of the centre line to (px, py), searching only the stretch
 * around `hint` (a car never jumps far between two steps). Pass -1 to search
 * the whole track.
 */
export function locate(track: Track, px: number, py: number, hint: number, out: Place): Place {
  const { n, x, y, cum } = track;
  const from = hint < 0 ? 0 : hint - 4;
  const to = hint < 0 ? n - 1 : hint + 8;
  let best = Infinity;
  for (let k = from; k <= to; k++) {
    const i = ((k % n) + n) % n;
    const j = (i + 1) % n;
    const ex = x[j] - x[i];
    const ey = y[j] - y[i];
    const len2 = ex * ex + ey * ey || 1;
    let t = ((px - x[i]) * ex + (py - y[i]) * ey) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = x[i] + ex * t;
    const qy = y[i] + ey * t;
    const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
    if (d2 < best) {
      best = d2;
      out.i = i;
      out.s = cum[i] + Math.sqrt(len2) * t;
      // Cross product of the road direction with the offset: which side we are on.
      const cross = ex * (py - qy) - ey * (px - qx);
      out.side = cross > 0 ? -Math.sqrt(d2) : Math.sqrt(d2);
    }
  }
  return out;
}

/** Position and direction on the centre line at distance `s` from the start line. */
export function pointAt(track: Track, s: number): { x: number; y: number; angle: number; i: number } {
  const { n, cum, x, y, length } = track;
  const want = ((s % length) + length) % length;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= want) lo = mid;
    else hi = mid;
  }
  const j = (lo + 1) % n;
  const f = (want - cum[lo]) / (cum[lo + 1] - cum[lo] || 1);
  const dx = x[j] - x[lo];
  const dy = y[j] - y[lo];
  return { x: x[lo] + dx * f, y: y[lo] + dy * f, angle: Math.atan2(dy, dx), i: lo };
}

// ---------- checking a finished track ----------

/** The first thing wrong with a track, or null if it can be raced. */
export function findFault(track: Track): Fault | null {
  const { n, x, y, kappa, length, cum } = track;
  if (length < MIN_LENGTH * 0.92) return { kind: "short", x: x[0], y: y[0] };
  if (length > MAX_LENGTH) return { kind: "long", x: x[0], y: y[0] };
  let worst = 0;
  let worstAt = -1;
  for (let i = 0; i < n; i++) {
    // Average over a few samples: one noisy sample is not a hairpin.
    const k = Math.abs((kappa[(i - 1 + n) % n] + kappa[i] + kappa[(i + 1) % n]) / 3);
    if (k > worst) {
      worst = k;
      worstAt = i;
    }
  }
  if (worst > 1 / VALID_RADIUS) return { kind: "tight", x: x[worstAt], y: y[worstAt] };

  const gap2 = VALID_GAP * VALID_GAP;
  for (let i = 0; i < n; i += 2) {
    for (let j = i + 2; j < n; j += 2) {
      const along = cum[j] - cum[i];
      if (along < GAP_ARC || length - along < GAP_ARC) continue;
      const dx = x[i] - x[j];
      const dy = y[i] - y[j];
      if (dx * dx + dy * dy < gap2) return { kind: "pinch", x: (x[i] + x[j]) / 2, y: (y[i] + y[j]) / 2 };
    }
  }
  return null;
}

// ---------- from a finger stroke to control points ----------

function pathLength(p: Pt[], closed: boolean): number {
  let len = 0;
  for (let i = 1; i < p.length; i++) len += dist(p[i - 1], p[i]);
  if (closed && p.length > 1) len += dist(p[p.length - 1], p[0]);
  return len;
}

/** Evenly spaced points along a path. A closed path gets exactly `count` points. */
function resample(p: Pt[], closed: boolean, spacing: number, count?: number): Pt[] {
  const src = closed ? [...p, p[0]] : p;
  const total = pathLength(src, false);
  const n = count ?? Math.max(closed ? 3 : 2, Math.round(total / spacing) + (closed ? 0 : 1));
  const step = total / (closed ? n : n - 1);
  const out: Pt[] = [];
  let seg = 0;
  let walked = 0;
  for (let k = 0; k < n; k++) {
    const want = k * step;
    while (seg < src.length - 2 && walked + dist(src[seg], src[seg + 1]) < want) {
      walked += dist(src[seg], src[seg + 1]);
      seg++;
    }
    const len = dist(src[seg], src[seg + 1]);
    const f = len > 0 ? Math.min(1, (want - walked) / len) : 0;
    out.push({ x: src[seg].x + (src[seg + 1].x - src[seg].x) * f, y: src[seg].y + (src[seg + 1].y - src[seg].y) * f });
  }
  return out;
}

function smooth(p: Pt[], passes: number, amount = 0.5): Pt[] {
  let cur = p;
  const n = p.length;
  for (let pass = 0; pass < passes; pass++) {
    const next: Pt[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = cur[(i - 1 + n) % n];
      const b = cur[i];
      const c = cur[(i + 1) % n];
      next[i] = {
        x: b.x + ((a.x + c.x) / 2 - b.x) * amount,
        y: b.y + ((a.y + c.y) / 2 - b.y) * amount,
      };
    }
    cur = next;
  }
  return cur;
}

function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * A drawn line often overshoots its own start or crosses itself. Keep the
 * biggest piece of it that makes one simple loop.
 */
function takeLoop(p: Pt[]): Pt[] {
  const n = p.length;
  const hits: [number, number][] = [];
  for (let i = 0; i < n - 3; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      if (crosses(p[i], p[i + 1], p[j], p[j + 1])) hits.push([i, j]);
    }
  }
  if (hits.length === 0) return p;
  const endsMeet = dist(p[0], p[n - 1]) < 3 * HALF_WIDTH;
  let best: Pt[] | null = null;
  let bestSize = -1;
  for (const [i, j] of hits) {
    // The loop closed by this crossing is simple if no other crossing lies wholly inside it.
    const inner = hits.some(([a, b]) => (a !== i || b !== j) && a >= i && b <= j);
    if (!inner && j - i > bestSize) {
      bestSize = j - i;
      best = p.slice(i + 1, j + 1);
    }
    // The rest of the line (end joined back to start) is the other candidate.
    const outer = hits.some(([a, b]) => (a !== i || b !== j) && (b <= i || a >= j || (a <= i && b >= j)));
    if (endsMeet && !outer && n - (j - i) > bestSize) {
      bestSize = n - (j - i);
      best = [...p.slice(j + 1), ...p.slice(0, i + 1)];
    }
  }
  if (best) return best;
  const [i, j] = hits.reduce((m, hgt) => (hgt[1] - hgt[0] > m[1] - m[0] ? hgt : m));
  return p.slice(i + 1, j + 1);
}

function area(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return a / 2;
}

function radiusAt(a: Pt, b: Pt, c: Pt): number {
  const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  if (cross < 1e-9) return Infinity;
  return (dist(a, b) * dist(b, c) * dist(c, a)) / (2 * cross);
}

function fitToPaper(p: Pt[], w: number, h: number): void {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of p) {
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x);
    y1 = Math.max(y1, q.y);
  }
  const roomW = w - 2 * MARGIN;
  const roomH = h - 2 * MARGIN;
  const k = Math.min(1, roomW / (x1 - x0 || 1), roomH / (y1 - y0 || 1));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const halfW = ((x1 - x0) * k) / 2;
  const halfH = ((y1 - y0) * k) / 2;
  const nx = Math.min(w - MARGIN - halfW, Math.max(MARGIN + halfW, cx));
  const ny = Math.min(h - MARGIN - halfH, Math.max(MARGIN + halfH, cy));
  for (const q of p) {
    q.x = nx + (q.x - cx) * k;
    q.y = ny + (q.y - cy) * k;
  }
}

/**
 * Opens up corners that are too tight and pushes apart stretches of road that
 * are too close, a little at a time, until the loop can carry a road.
 */
function relax(input: Pt[], w: number, h: number): Pt[] {
  const SPACING = 12;
  let p = resample(input, true, SPACING);
  const skip = Math.ceil(GAP_ARC / SPACING);
  for (let iter = 0; iter < 260; iter++) {
    const n = p.length;
    let moved = false;
    const next = p.map((q) => ({ x: q.x, y: q.y }));

    for (let i = 0; i < n; i++) {
      const r = radiusAt(p[(i - 2 + n) % n], p[i], p[(i + 2) % n]);
      if (r < RELAX_RADIUS) {
        moved = true;
        for (let k = -2; k <= 2; k++) {
          const m = (i + k + n) % n;
          const a = p[(m - 1 + n) % n];
          const c = p[(m + 1) % n];
          next[m].x += ((a.x + c.x) / 2 - p[m].x) * 0.22;
          next[m].y += ((a.y + c.y) / 2 - p[m].y) * 0.22;
        }
      }
    }

    for (let i = 0; i < n; i++) {
      for (let j = i + skip; j < n; j++) {
        if (n - (j - i) < skip) continue;
        const dx = p[j].x - p[i].x;
        const dy = p[j].y - p[i].y;
        const d = Math.hypot(dx, dy);
        if (d >= RELAX_GAP) continue;
        moved = true;
        const push = ((RELAX_GAP - d) / 2) * 0.35;
        const ux = d > 1e-6 ? dx / d : 1;
        const uy = d > 1e-6 ? dy / d : 0;
        next[i].x -= ux * push;
        next[i].y -= uy * push;
        next[j].x += ux * push;
        next[j].y += uy * push;
      }
    }

    if (!moved) break;
    fitToPaper(next, w, h);
    p = resample(smooth(next, 1, 0.12), true, SPACING);
  }
  return p;
}

/** Control points, in whole world units, for a closed loop of points. */
function toControl(p: Pt[]): Int16Array {
  const count = Math.max(8, Math.min(250, Math.round(pathLength(p, true) / CTRL_SPACING)));
  const even = resample(p, true, CTRL_SPACING, count);
  const ctrl = new Int16Array(count * 2);
  even.forEach((q, i) => {
    ctrl[2 * i] = Math.round(q.x);
    ctrl[2 * i + 1] = Math.round(q.y);
  });
  return ctrl;
}

/** The best place for the start line: the beginning of the straightest stretch. */
function chooseStart(track: Track): number {
  const { n, kappa, cum, length } = track;
  const ahead = Math.round(n * Math.min(0.4, 230 / length));
  const behind = Math.round(n * Math.min(0.1, 50 / length));
  let best = 0;
  let bestScore = Infinity;
  for (let i = 0; i < n; i++) {
    let bend = 0;
    for (let k = -behind; k <= ahead; k++) {
      const v = Math.abs(kappa[(i + k + n) % n]) * (k < 0 ? 0.5 : 1);
      if (v > bend) bend = v;
    }
    // Among equally straight places, prefer the one nearest where the drawing began.
    const fromStart = Math.min(cum[i], length - cum[i]) / length;
    const score = bend + fromStart * 0.002;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Turns a drawn stroke (in world units) into a track: resampled, trimmed to
 * one loop, closed, smoothed, grown if it is too small, relaxed until a road
 * fits along it, then checked. The cars drive in the direction it was drawn.
 */
export function trackFromStroke(stroke: Pt[], w: number, h: number): StrokeResult {
  const first = stroke[0] ?? { x: w / 2, y: h / 2 };
  const fail = (kind: Fault["kind"], at: Pt = first): StrokeResult => ({ ok: false, fault: { kind, x: at.x, y: at.y } });
  if (stroke.length < 3 || pathLength(stroke, false) < 140) return fail("short");

  let loop = takeLoop(resample(stroke, false, 6));
  if (loop.length < 12) return fail("short");
  loop = smooth(resample(loop, true, 8), 10);

  const round = (4 * Math.PI * Math.abs(area(loop))) / pathLength(loop, true) ** 2;
  if (round < 0.07) return fail("flat", loop[Math.floor(loop.length / 2)]);

  // A small drawing is a small idea of a track, not a mistake: grow it.
  const len = pathLength(loop, true);
  if (len < MIN_LENGTH * 1.15) {
    const k = (MIN_LENGTH * 1.15) / len;
    const cx = loop.reduce((s, q) => s + q.x, 0) / loop.length;
    const cy = loop.reduce((s, q) => s + q.y, 0) / loop.length;
    for (const q of loop) {
      q.x = cx + (q.x - cx) * k;
      q.y = cy + (q.y - cy) * k;
    }
  }
  fitToPaper(loop, w, h);
  loop = relax(loop, w, h);
  if (pathLength(loop, true) > MAX_LENGTH) return fail("long", loop[0]);

  const ctrl = toControl(loop);
  const draft = buildTrack(ctrl, w, h);
  const count = ctrl.length >> 1;
  const shift = Math.round((chooseStart(draft) / draft.n) * count) % count;
  const turned = new Int16Array(ctrl.length);
  for (let i = 0; i < count; i++) {
    const from = (i + shift) % count;
    turned[2 * i] = ctrl[2 * from];
    turned[2 * i + 1] = ctrl[2 * from + 1];
  }
  const track = buildTrack(turned, w, h);
  const fault = findFault(track);
  return fault ? { ok: false, fault } : { ok: true, track };
}

/** The sheet of paper for a screen of the given shape (width / height). */
export function paperFor(aspect: number, areaUnits: number): { w: number; h: number } {
  const a = Math.min(1.9, Math.max(0.55, aspect));
  return { w: Math.round(Math.sqrt(areaUnits * a)), h: Math.round(Math.sqrt(areaUnits / a)) };
}
