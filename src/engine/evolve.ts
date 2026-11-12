/**
 * Breeding. There is no teacher and no gradient: a generation drives, the ones
 * that got furthest are kept, and the rest of the next generation is made from
 * them by mixing two parents and nudging some of the numbers at random.
 */
import { LAYERS } from "./config";
import { weightCount } from "./net";
import type { Rng } from "./rng";

export const GENOME_SIZE = weightCount(LAYERS);

/** How many of the best are carried over untouched. */
export const ELITES = 4;
const TOURNAMENT = 3;
const CROSSOVER = 0.5;
const MUTATION_RATE = 0.22;

export function randomGenome(rng: Rng): Float32Array {
  const g = new Float32Array(GENOME_SIZE);
  for (let i = 0; i < g.length; i++) g[i] = rng.gauss() * 0.9;
  return g;
}

/** Picks a few at random and returns the best of them. `ranked` is best first. */
function tournament(count: number, rng: Rng): number {
  let best = rng.int(count);
  for (let k = 1; k < TOURNAMENT; k++) {
    const c = rng.int(count);
    if (c < best) best = c;
  }
  return best;
}

export interface BreedOptions {
  /** Size of a normal nudge. */
  sigma: number;
  /** How many brand new random drivers to add at the bottom (used when learning stalls). */
  newcomers: number;
}

/**
 * The next generation. `ranked` is the current one, best first. The result has
 * the same size, with the elites first and unchanged.
 */
export function breed(ranked: Float32Array[], rng: Rng, opts: BreedOptions): Float32Array[] {
  const size = ranked.length;
  const next: Float32Array[] = [];
  for (let e = 0; e < ELITES && e < size; e++) next.push(ranked[e].slice());
  // Parents are drawn from the better half only.
  const pool = Math.max(ELITES, size >> 1);
  while (next.length < size - opts.newcomers) {
    const a = ranked[tournament(pool, rng)];
    const child = a.slice();
    if (rng.next() < CROSSOVER) {
      const b = ranked[tournament(pool, rng)];
      for (let i = 0; i < child.length; i++) if (rng.next() < 0.5) child[i] = b[i];
    }
    // Most children are nudged a normal amount, some barely, a few wildly.
    const roll = rng.next();
    const sigma = opts.sigma * (roll < 0.2 ? 0.3 : roll > 0.88 ? 3 : 1);
    let touched = false;
    for (let i = 0; i < child.length; i++) {
      if (rng.next() < MUTATION_RATE) {
        child[i] += rng.gauss() * sigma;
        touched = true;
      }
    }
    if (!touched) child[rng.int(child.length)] += rng.gauss() * sigma;
    next.push(child);
  }
  while (next.length < size) next.push(randomGenome(rng));
  return next;
}
