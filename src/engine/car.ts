/**
 * The car. Small enough to read in one go, with enough physics to feel like
 * driving: the body turns where the wheels point, the tyres can only pull it
 * sideways so hard, and past that it slides.
 */
import { BRAKE, DRAG, DT, ENGINE, GRIP, MAX_SPEED, OVERSTEER, STEER_RATE, TURN_RADIUS } from "./config";

export interface Car {
  x: number;
  y: number;
  /** Direction the nose points, radians. */
  heading: number;
  /** Velocity in the world. */
  vx: number;
  vy: number;
  /** Where the steering actually is, -1 (left) .. 1 (right). It follows the command at a limited rate. */
  steer: number;
  /** Speed along the nose and across it, kept for the senses, the sound and the tyre marks. */
  speed: number;
  slip: number;
}

export function makeCar(x: number, y: number, heading: number): Car {
  return { x, y, heading, vx: 0, vy: 0, steer: 0, speed: 0, slip: 0 };
}

/**
 * One fixed step. `steerCmd` is -1 .. 1. `pedal` is -1 .. 1: above -0.3 it is
 * the accelerator, below it the brake, so a foot resting in the middle still
 * rolls the car forward.
 */
export function stepCar(car: Car, steerCmd: number, pedal: number): void {
  const want = steerCmd < -1 ? -1 : steerCmd > 1 ? 1 : steerCmd;
  const maxMove = STEER_RATE * DT;
  const move = want - car.steer;
  car.steer += move > maxMove ? maxMove : move < -maxMove ? -maxMove : move;

  // Turn the body. Slow: as tight as the steering allows. Fast: only a little
  // more than the tyres can hold, which is what keeps a slide catchable.
  const fwd = car.speed;
  const geometric = fwd / TURN_RADIUS;
  const byGrip = fwd > 1 ? (GRIP * OVERSTEER) / fwd : geometric;
  car.heading += car.steer * (geometric < byGrip ? geometric : byGrip) * DT;

  const cos = Math.cos(car.heading);
  const sin = Math.sin(car.heading);
  let along = car.vx * cos + car.vy * sin;
  let across = -car.vx * sin + car.vy * cos;

  const p = pedal < -1 ? -1 : pedal > 1 ? 1 : pedal;
  if (p > -0.3) {
    along += ((p + 0.3) / 1.3) * ENGINE * (1 - along / MAX_SPEED) * DT;
  } else {
    along -= ((-0.3 - p) / 0.7) * BRAKE * DT;
    if (along < 0) along = 0;
  }
  along -= along * DRAG * DT;

  // The tyres remove sideways speed, but only so fast. What is left is the slide,
  // and sliding scrubs speed off.
  const hold = GRIP * DT;
  if (across > hold) {
    across -= hold;
    along -= along * 0.9 * DT;
  } else if (across < -hold) {
    across += hold;
    along -= along * 0.9 * DT;
  } else {
    across = 0;
  }

  car.speed = along;
  car.slip = across;
  car.vx = along * cos - across * sin;
  car.vy = along * sin + across * cos;
  car.x += car.vx * DT;
  car.y += car.vy * DT;
}
