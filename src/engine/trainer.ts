/**
 * The learning loop: a field of cars drives the track, each with its own
 * network; when they are all out (or one has finished) they are ranked by how
 * far they got and the next generation is bred from the best.
 */
import {
  DT,
  GRID_OFFSET,
  LAYERS,
  PACE,
  PACE_SLACK,
  POPULATION,
  STALL_TIME,
  TARGET_LAPS,
  WALL_REACH,
  WRONG_WAY,
} from "./config";
import { makeCar, stepCar, type Car } from "./car";
import { breed, randomGenome } from "./evolve";
import { forward, makeActivations } from "./net";
import { Rng } from "./rng";
import { sense } from "./sensors";
import { locate, pointAt, type Place, type Track } from "./track";

export type Out = "wall" | "stall" | "slow" | "wrong";

/** One car in the field, with its brain and its score. */
export interface Driver {
  car: Car;
  genome: Float32Array;
  /** Live activity of every neuron, layer by layer. */
  act: Float32Array[];
  alive: boolean;
  out: Out | null;
  /** When it went out, in seconds since the start of the generation. */
  outAt: number;
  /** Nearest centre-line sample, carried from step to step. */
  near: number;
  s: number;
  side: number;
  /** Distance driven past the start line; negative while still on the grid. */
  progress: number;
  /** Furthest it has been. This is the score. */
  best: number;
  lastGain: number;
  laps: number;
  lapStart: number;
  finishedAt: number;
}

/** The side of the road the field starts on; the other side is kept for a rival in the race. */
export const GRID_SIDE = 8;

export function gridPose(track: Track, side: number): { x: number; y: number; heading: number; near: number } {
  const p = pointAt(track, -GRID_OFFSET);
  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  return { x: p.x + sin * side, y: p.y - cos * side, heading: p.angle, near: p.i };
}

export function makeDriver(track: Track, genome: Float32Array, side = GRID_SIDE): Driver {
  const g = gridPose(track, side);
  return {
    car: makeCar(g.x, g.y, g.heading),
    genome,
    act: makeActivations(LAYERS),
    alive: true,
    out: null,
    outAt: 0,
    near: g.near,
    s: track.length - GRID_OFFSET,
    side,
    progress: -GRID_OFFSET,
    best: -GRID_OFFSET,
    lastGain: 0,
    laps: 0,
    lapStart: 0,
    finishedAt: 0,
  };
}

const place: Place = { i: 0, s: 0, side: 0 };

/**
 * Senses, thinks, drives one step, then works out where the car now is on the
 * road. Returns the lap time if this step crossed the line, else 0.
 */
export function driveStep(track: Track, d: Driver, time: number): number {
  sense(track, d.car, d.act[0]);
  const out = forward(LAYERS, d.genome, d.act);
  stepCar(d.car, out[0], out[1]);
  return follow(track, d, time);
}

/** Updates a driver's place on the road after its car has moved. */
export function follow(track: Track, d: Driver, time: number): number {
  locate(track, d.car.x, d.car.y, d.near, place);
  let delta = place.s - d.s;
  if (delta < -track.length / 2) delta += track.length;
  else if (delta > track.length / 2) delta -= track.length;
  d.near = place.i;
  d.s = place.s;
  d.side = place.side;
  d.progress += delta;
  if (d.progress > d.best + 0.5) {
    d.best = d.progress;
    d.lastGain = time;
  }
  // Forward progress only: a lap counts when the furthest point reached passes the line.
  if (d.best >= (d.laps + 1) * track.length) {
    d.laps++;
    const lap = time - d.lapStart;
    d.lapStart = time;
    return lap;
  }
  return 0;
}

export interface GenerationRecord {
  /** Best distance, in laps. */
  best: number;
  /** Average distance of the field, in laps. */
  mean: number;
  /** Time the winner took for all laps, or 0 if nobody finished. */
  finish: number;
}

export interface StepEvents {
  /** Drivers that went out this step. */
  out: number[];
  /** A lap was completed this step by this driver (-1 if none) in this time. */
  lapBy: number;
  lapTime: number;
  /** This step saw the first clean lap ever on this track. */
  firstLap: boolean;
  /** The generation ended this step and the next one is on the grid. */
  bred: boolean;
}

export class Trainer {
  readonly track: Track;
  readonly rng: Rng;
  drivers: Driver[] = [];
  /** 1 for the first generation. */
  generation = 1;
  /** Seconds since the current generation started. */
  time = 0;
  history: GenerationRecord[] = [];
  /** Generation that produced the first clean lap, or 0. */
  firstLapGeneration = 0;
  /** Generation in which a car first finished every lap, or 0. */
  finishedGeneration = 0;
  bestLap = 0;
  bestFinish = 0;
  /** Generations since the best score last improved. */
  stalled = 0;
  /** Size of the random nudges being applied; grows when learning stalls. */
  sigma = BASE_SIGMA;
  /** Index of the car that is furthest along right now. */
  leader = 0;
  /** The best driver of the last finished generation. */
  champion: Float32Array | null = null;
  /** The furthest any champion has got, in laps. */
  championLaps = 0;
  alive = POPULATION;
  readonly events: StepEvents = { out: [], lapBy: -1, lapTime: 0, firstLap: false, bred: false };
  private bestScore = -Infinity;
  private genomes: Float32Array[];

  constructor(track: Track, seed: number, size = POPULATION) {
    this.track = track;
    this.rng = new Rng(seed);
    this.genomes = [];
    for (let i = 0; i < size; i++) this.genomes.push(randomGenome(this.rng));
    this.line();
  }

  private line(): void {
    this.drivers = this.genomes.map((g) => makeDriver(this.track, g));
    this.time = 0;
    this.alive = this.drivers.length;
    this.leader = 0;
  }

  /** Advances every car by one fixed step. */
  step(): StepEvents {
    const ev = this.events;
    ev.out.length = 0;
    ev.lapBy = -1;
    ev.lapTime = 0;
    ev.firstLap = false;
    ev.bred = false;

    const { track, drivers } = this;
    this.time += DT;
    const time = this.time;
    let finished = false;
    let lead = -1;
    let leadBest = -Infinity;
    const sweeper = PACE * time - PACE_SLACK - GRID_OFFSET;

    for (let k = 0; k < drivers.length; k++) {
      const d = drivers[k];
      if (d.alive) {
        const lap = driveStep(track, d, time);
        if (lap > 0) {
          if (ev.lapBy < 0 || lap < ev.lapTime) {
            ev.lapBy = k;
            ev.lapTime = lap;
          }
          if (this.bestLap === 0 || lap < this.bestLap) this.bestLap = lap;
          if (this.firstLapGeneration === 0) {
            this.firstLapGeneration = this.generation;
            ev.firstLap = true;
          }
          if (d.laps >= TARGET_LAPS) {
            d.finishedAt = time;
            finished = true;
          }
        }
        let out: Out | null = null;
        if (Math.abs(d.side) > WALL_REACH) out = "wall";
        else if (d.progress < -GRID_OFFSET - WRONG_WAY) out = "wrong";
        else if (time - d.lastGain > STALL_TIME) out = "stall";
        else if (d.best < sweeper) out = "slow";
        if (out && d.finishedAt === 0) {
          d.alive = false;
          d.out = out;
          d.outAt = time;
          this.alive--;
          ev.out.push(k);
        }
      }
      // The leader is the furthest car still driving, or failing that the furthest of all.
      const rank = d.best + (d.alive ? 1e7 : 0);
      if (rank > leadBest) {
        leadBest = rank;
        lead = k;
      }
    }
    this.leader = lead;

    if (finished || this.alive === 0) this.nextGeneration();
    return ev;
  }

  /** The score a driver is ranked by: distance, and for a finisher, how quickly. */
  private score(d: Driver): number {
    return d.finishedAt > 0 ? d.best + (this.track.length * 60) / d.finishedAt : d.best;
  }

  private nextGeneration(): void {
    const { drivers, track } = this;
    const order = drivers.map((_, k) => k).sort((a, b) => this.score(drivers[b]) - this.score(drivers[a]) || a - b);
    const top = drivers[order[0]];
    const topScore = this.score(top);
    let sum = 0;
    for (const d of drivers) sum += Math.max(0, d.best);
    this.history.push({
      best: Math.max(0, top.best) / track.length,
      mean: sum / drivers.length / track.length,
      finish: top.finishedAt,
    });
    this.champion = top.genome.slice();
    this.championLaps = Math.max(0, top.best) / track.length;
    if (top.finishedAt > 0) {
      if (this.finishedGeneration === 0) this.finishedGeneration = this.generation;
      if (this.bestFinish === 0 || top.finishedAt < this.bestFinish) this.bestFinish = top.finishedAt;
    }

    // Stalled? Then vary more, and after a while bring in complete newcomers.
    const gain = topScore - this.bestScore;
    if (gain > track.length * 0.004) {
      this.stalled = 0;
    } else {
      this.stalled++;
    }
    if (topScore > this.bestScore) this.bestScore = topScore;
    const base = this.finishedGeneration > 0 ? FINE_SIGMA : BASE_SIGMA;
    this.sigma = Math.min(MAX_SIGMA, base * (1 + 0.3 * this.stalled));
    const newcomers = this.finishedGeneration === 0 && this.stalled >= 3 ? 6 : 0;

    this.genomes = breed(
      order.map((k) => drivers[k].genome),
      this.rng,
      { sigma: this.sigma, newcomers },
    );
    this.generation++;
    this.line();
    this.events.bred = true;
  }
}

const BASE_SIGMA = 0.35;
const FINE_SIGMA = 0.12;
const MAX_SIGMA = 1.1;

export interface SoloRun {
  /** Laps completed without touching a wall. */
  laps: number;
  lapTimes: number[];
  /** x, y of the car every few steps. */
  path: number[];
  /** Distance covered, in laps. */
  distance: number;
}

/** Drives one network alone, for checking a champion and for drawing its line. */
export function driveSolo(track: Track, genome: Float32Array, laps: number, side = GRID_SIDE): SoloRun {
  const d = makeDriver(track, genome, side);
  const run: SoloRun = { laps: 0, lapTimes: [], path: [], distance: 0 };
  const limit = Math.ceil(((laps * track.length + PACE_SLACK) / PACE) / DT);
  for (let step = 0; step < limit; step++) {
    const time = (step + 1) * DT;
    const lap = driveStep(track, d, time);
    if (step % 3 === 0) run.path.push(d.car.x, d.car.y);
    if (lap > 0) run.lapTimes.push(lap);
    if (d.laps >= laps) break;
    if (Math.abs(d.side) > WALL_REACH || time - d.lastGain > STALL_TIME || d.progress < -GRID_OFFSET - WRONG_WAY) break;
  }
  run.laps = d.laps;
  run.distance = Math.max(0, d.best) / track.length;
  return run;
}
