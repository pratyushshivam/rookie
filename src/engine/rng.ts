/**
 * A small seeded random generator (mulberry32). Everything random in the engine
 * comes from one of these, so the same seed always gives the same evolution.
 */
export class Rng {
  private state: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Whole number in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Normally distributed, mean 0, spread 1 (Marsaglia's polar method). */
  gauss(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    let r = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      r = u * u + v * v;
    } while (r >= 1 || r === 0);
    const k = Math.sqrt((-2 * Math.log(r)) / r);
    this.spare = v * k;
    return u * k;
  }
}

/** Turns any text into a seed. */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
