/** Drawings used by the tests: tidy ones, and the kinds of mess a real finger makes. */
import { Rng, WORLD_AREA, paperFor, type Pt } from "../src/engine";

export const SQUARE = paperFor(1, WORLD_AREA);
export const PHONE = paperFor(0.7, WORLD_AREA);
export const LAPTOP = paperFor(1.6, WORLD_AREA);

export function circle(cx: number, cy: number, r: number, turns = 1, steps = 90): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps * turns; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** A loop that carries on a fifth of the way round again, crossing its own start. */
export function overshoot(w: number, h: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 110; i++) {
    const a = (i / 90) * Math.PI * 2;
    // Spiral slightly inwards so the second pass crosses the first.
    const r = 1 - 0.0016 * i * Math.sin(a * 0.5 + 0.3);
    pts.push({ x: w / 2 + Math.cos(a) * w * 0.34 * r, y: h / 2 + Math.sin(a) * h * 0.3 * r });
  }
  return pts;
}

export function figureEight(w: number, h: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    pts.push({ x: w / 2 + Math.sin(a) * w * 0.36, y: h / 2 + Math.sin(2 * a) * h * 0.3 });
  }
  return pts;
}

/** A five-pointed star: every corner far too sharp for a road. */
export function star(w: number, h: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 0.42 : 0.2;
    pts.push({ x: w / 2 + Math.cos(a) * w * r, y: h / 2 + Math.sin(a) * h * r });
  }
  return pts;
}

/** A rectangle drawn corner to corner, with square corners, left open at the end. */
export function box(w: number, h: number): Pt[] {
  return [
    { x: w * 0.15, y: h * 0.2 },
    { x: w * 0.85, y: h * 0.2 },
    { x: w * 0.85, y: h * 0.8 },
    { x: w * 0.15, y: h * 0.8 },
    { x: w * 0.15, y: h * 0.32 },
  ];
}

/** A shaky hand: a loop with a lot of wobble and uneven speed. */
export function shaky(w: number, h: number, seed: number): Pt[] {
  const rng = new Rng(seed);
  const pts: Pt[] = [];
  const bumps = [rng.range(0.1, 0.3), rng.range(0.05, 0.25), rng.range(0, 0.15)];
  const phase = [rng.range(0, 6), rng.range(0, 6), rng.range(0, 6)];
  let a = rng.range(0, 6);
  const dir = rng.next() < 0.5 ? 1 : -1;
  const end = a + dir * Math.PI * 2 * rng.range(0.93, 1.06);
  while (dir > 0 ? a < end : a > end) {
    const r = 0.3 * (1 + bumps[0] * Math.sin(2 * a + phase[0]) + bumps[1] * Math.sin(3 * a + phase[1]) + bumps[2] * Math.sin(5 * a + phase[2]));
    pts.push({ x: w / 2 + Math.cos(a) * w * r + rng.range(-7, 7), y: h / 2 + Math.sin(a) * h * r + rng.range(-7, 7) });
    a += dir * rng.range(0.02, 0.09);
  }
  return pts;
}
