/**
 * What a car knows about the world: how far it is to the wall along seven
 * lines fanned out in front of it, and how fast it is going. Nothing else.
 * It is never told where the track goes.
 */
import { MAX_SPEED, RAY_ANGLES, RAY_RANGE } from "./config";
import type { Car } from "./car";
import type { Track } from "./track";

/** Fills `out` with the network's inputs, each scaled to 0 .. 1. */
export function sense(track: Track, car: Car, out: Float32Array): void {
  const count = RAY_ANGLES.length;
  for (let r = 0; r < count; r++) {
    const a = car.heading + RAY_ANGLES[r];
    out[r] = track.walls.raycast(car.x, car.y, Math.cos(a), Math.sin(a), RAY_RANGE) / RAY_RANGE;
  }
  const v = car.speed / MAX_SPEED;
  out[count] = v < 0 ? 0 : v > 1 ? 1 : v;
}
