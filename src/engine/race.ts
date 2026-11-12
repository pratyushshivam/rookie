/**
 * The race: the visitor's car against the network they trained, on the same
 * track, same car, same physics. The two cars do not collide with each other.
 */
import { DT, MAX_SPEED, STALL_TIME, TARGET_LAPS, WALL_REACH } from "./config";
import { stepCar } from "./car";
import { driveStep, follow, GRID_SIDE, makeDriver, type Driver } from "./trainer";
import { pointAt, type Track } from "./track";

/** How long a car that touched the wall waits before it is put back on the road. */
export const RESET_TIME = 0.8;
/** The visitor's speed is looked after for them: this share of the careful driver's speed. */
export const AID = 0.9;

export interface RaceInput {
  /** -1 left, 1 right, 0 straight. */
  steer: number;
  /** Foot down: ignore the careful speed and take the risk. */
  push: boolean;
}

export interface Racer {
  driver: Driver;
  lapTimes: number[];
  /** Total time when all laps were done, or 0. */
  finish: number;
  /** Seconds left before a car that hit the wall is released. */
  held: number;
  crashes: number;
}

export interface RaceEvents {
  playerLap: number;
  rookieLap: number;
  playerCrash: boolean;
  rookieCrash: boolean;
  /** Set on the step the race is decided for both. */
  over: boolean;
}

function racer(track: Track, genome: Float32Array, side: number): Racer {
  return { driver: makeDriver(track, genome, side), lapTimes: [], finish: 0, held: 0, crashes: 0 };
}

/** The pedal that holds the careful speed at this point of the road. */
export function carefulPedal(track: Track, d: Driver, share: number): number {
  // Look a short way ahead, further when faster, so braking starts in time.
  const ahead = Math.round((d.car.speed * 0.12) / (track.length / track.n));
  const target = track.safe[(d.near + 1 + ahead) % track.n] * share;
  const diff = target - d.car.speed;
  return diff > 0 ? Math.min(1, 0.2 + diff / 12) : Math.max(-1, -0.3 + diff / 18);
}

/** Steering that aims at a point on the centre line ahead. Used by the demo and the tests, never by the rookie. */
export function aimSteer(track: Track, d: Driver, look = 46): number {
  const target = pointAt(track, d.s + look + d.car.speed * 0.1);
  let turn = Math.atan2(target.y - d.car.y, target.x - d.car.x) - d.car.heading;
  while (turn > Math.PI) turn -= 2 * Math.PI;
  while (turn < -Math.PI) turn += 2 * Math.PI;
  return Math.max(-1, Math.min(1, turn * 2.6));
}

export class Race {
  readonly track: Track;
  readonly laps: number;
  readonly rookie: Racer;
  readonly player: Racer;
  time = 0;
  over = false;
  readonly events: RaceEvents = { playerLap: 0, rookieLap: 0, playerCrash: false, rookieCrash: false, over: false };

  constructor(track: Track, genome: Float32Array, laps = TARGET_LAPS) {
    this.track = track;
    this.laps = laps;
    // The rookie starts exactly where it trained; the visitor gets the other side of the road.
    this.rookie = racer(track, genome, GRID_SIDE);
    this.player = racer(track, genome, -GRID_SIDE);
  }

  private putBack(r: Racer): void {
    const d = r.driver;
    const p = pointAt(this.track, d.s);
    d.car.x = p.x;
    d.car.y = p.y;
    d.car.heading = p.angle;
    d.car.vx = d.car.vy = d.car.speed = d.car.slip = d.car.steer = 0;
    d.near = p.i;
    d.side = 0;
    d.lastGain = this.time + RESET_TIME;
    r.held = RESET_TIME;
    r.crashes++;
  }

  private advance(r: Racer, lap: number): void {
    if (lap > 0 && r.finish === 0) {
      r.lapTimes.push(lap);
      if (r.driver.laps >= this.laps) r.finish = this.time;
    }
  }

  step(input: RaceInput): RaceEvents {
    const ev = this.events;
    ev.playerLap = ev.rookieLap = 0;
    ev.playerCrash = ev.rookieCrash = ev.over = false;
    if (this.over) return ev;
    this.time += DT;
    const { track, time } = this;

    const ai = this.rookie;
    if (ai.held > 0) ai.held -= DT;
    else if (ai.finish === 0) {
      const lap = driveStep(track, ai.driver, time);
      this.advance(ai, lap);
      ev.rookieLap = lap;
      const d = ai.driver;
      if (Math.abs(d.side) > WALL_REACH || time - d.lastGain > STALL_TIME || d.progress < d.best - 60) {
        this.putBack(ai);
        ev.rookieCrash = true;
      }
    } else coast(track, ai.driver, time);

    const me = this.player;
    if (me.held > 0) me.held -= DT;
    else if (me.finish === 0) {
      const d = me.driver;
      const pedal = input.push ? 1 : carefulPedal(track, d, AID);
      stepCar(d.car, input.steer, pedal);
      const lap = follow(track, d, time);
      this.advance(me, lap);
      ev.playerLap = lap;
      if (Math.abs(d.side) > WALL_REACH) {
        this.putBack(me);
        ev.playerCrash = true;
      }
    } else coast(track, me.driver, time);

    // Decided when both are home, or a while after the first if the other is far behind.
    const first = Math.min(ai.finish || Infinity, me.finish || Infinity);
    if ((ai.finish > 0 && me.finish > 0) || time - first > 20) {
      this.over = true;
      ev.over = true;
    }
    return ev;
  }

  /** Distance the visitor is ahead of the rookie along the road (negative: behind). */
  gap(): number {
    return this.player.driver.best - this.rookie.driver.best;
  }
}

/** After the flag a car rolls on down the middle of the road and slows. */
function coast(track: Track, d: Driver, time: number): void {
  stepCar(d.car, aimSteer(track, d), d.car.speed > MAX_SPEED * 0.25 ? -0.7 : -0.3);
  follow(track, d, time);
}
