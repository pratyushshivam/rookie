/**
 * Ready-made drawings, for people who would rather not draw. Each one is a
 * stroke, and goes through exactly the same steps as a finger drawing does.
 */
import { MARGIN } from "./config";
import type { Rng } from "./rng";
import type { Pt } from "./track";

/** A loop whose distance from the middle wobbles with the angle. */
function wobble(w: number, h: number, waves: [number, number, number][], turn = 0, clockwise = true, steps = 180): Pt[] {
  const radius = (a: number): number => {
    let r = 1;
    for (const [k, amp, phase] of waves) r += amp * Math.sin(k * a + phase);
    return r;
  };
  let peak = 0;
  for (let i = 0; i < 360; i++) peak = Math.max(peak, radius((i / 360) * Math.PI * 2));
  const rx = w / 2 - MARGIN - 8;
  const ry = h / 2 - MARGIN - 8;
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = turn + ((clockwise ? i : -i) / steps) * Math.PI * 2;
    const r = radius(a) / peak;
    pts.push({ x: w / 2 + Math.cos(a) * rx * r, y: h / 2 + Math.sin(a) * ry * r });
  }
  return pts;
}

export interface Preset {
  name: string;
  stroke: (w: number, h: number) => Pt[];
}

export const PRESETS: Preset[] = [
  { name: "Oval", stroke: (w, h) => wobble(w, h, [[4, 0.06, Math.PI / 2]], -Math.PI / 2) },
  { name: "Peanut", stroke: (w, h) => wobble(w, h, w > h ? [[2, 0.3, Math.PI / 2]] : [[2, 0.3, -Math.PI / 2]], -Math.PI / 2) },
  { name: "Clover", stroke: (w, h) => wobble(w, h, [[3, 0.3, 0.4], [2, 0.08, 1]], -Math.PI / 2, false) },
];

/** A different loop for every seed: a few random waves, drawn with a slightly shaky hand. */
export function randomStroke(rng: Rng, w: number, h: number): Pt[] {
  const waves: [number, number, number][] = [];
  for (let k = 2; k <= 5; k++) waves.push([k, rng.range(0.04, 0.34) / Math.sqrt(k - 1), rng.range(0, Math.PI * 2)]);
  const pts = wobble(w, h, waves, rng.range(0, Math.PI * 2), rng.next() < 0.5, 150);
  for (const p of pts) {
    p.x += rng.range(-3, 3);
    p.y += rng.range(-3, 3);
  }
  return pts;
}
