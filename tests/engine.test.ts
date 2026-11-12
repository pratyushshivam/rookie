import { describe, expect, it } from "vitest";
import {
  DT,
  GENOME_SIZE,
  GRID_OFFSET,
  HALF_WIDTH,
  LAYERS,
  MIN_LENGTH,
  PRESETS,
  RAY_ANGLES,
  RAY_RANGE,
  Rng,
  TARGET_LAPS,
  Trainer,
  WallGrid,
  driveSolo,
  findFault,
  follow,
  forward,
  locate,
  makeActivations,
  makeCar,
  makeDriver,
  pointAt,
  randomStroke,
  sense,
  stepCar,
  trackFromStroke,
  weightCount,
  type Track,
} from "../src/engine";
import { LAPTOP, PHONE, SQUARE, box, circle, figureEight, overshoot, shaky, star } from "./fixtures";

function must(stroke: { x: number; y: number }[], paper = SQUARE): Track {
  const made = trackFromStroke(stroke, paper.w, paper.h);
  if (!made.ok) throw new Error(`refused: ${made.fault.kind}`);
  return made.track;
}

const oval = must(PRESETS[0].stroke(SQUARE.w, SQUARE.h));

describe("random numbers", () => {
  it("gives the same sequence for the same seed, and a different one for another", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const seqA = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(seqA);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("draws bell-shaped numbers with mean 0 and spread 1", () => {
    const rng = new Rng(7);
    const xs = Array.from({ length: 20000 }, () => rng.gauss());
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    const spread = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(spread - 1)).toBeLessThan(0.03);
  });
});

describe("a stroke becomes a track", () => {
  it("turns a circle into a closed, evenly sampled, fault-free road", () => {
    const t = must(circle(SQUARE.w / 2, SQUARE.h / 2, 260));
    expect(findFault(t)).toBeNull();
    expect(t.length).toBeGreaterThan(MIN_LENGTH);
    // Closed and even: every gap between neighbours, including last to first, is about the same.
    const gaps = Array.from({ length: t.n }, (_, i) => t.cum[i + 1] - t.cum[i]);
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(1.08);
    // The edges are one road-width apart everywhere.
    for (let i = 0; i < t.n; i += 7) {
      expect(Math.hypot(t.lx[i] - t.rx[i], t.ly[i] - t.ry[i])).toBeCloseTo(2 * HALF_WIDTH, 6);
    }
    // And the whole road is on the paper.
    for (let i = 0; i < t.n; i++) {
      for (const [x, y] of [[t.lx[i], t.ly[i]], [t.rx[i], t.ry[i]]]) {
        expect(x).toBeGreaterThan(0);
        expect(y).toBeGreaterThan(0);
        expect(x).toBeLessThan(t.w);
        expect(y).toBeLessThan(t.h);
      }
    }
  });

  it("keeps the direction the loop was drawn in", () => {
    const signedArea = (t: Track): number => {
      let a = 0;
      for (let i = 0; i < t.n; i++) a += t.x[i] * t.y[(i + 1) % t.n] - t.x[(i + 1) % t.n] * t.y[i];
      return a;
    };
    const one = circle(450, 450, 250);
    expect(Math.sign(signedArea(must(one)))).toBe(-Math.sign(signedArea(must([...one].reverse()))));
  });

  it("grows a drawing that is too small instead of refusing it", () => {
    const t = must(circle(300, 300, 40));
    expect(t.length).toBeGreaterThan(MIN_LENGTH);
  });

  it("repairs an overshoot, a figure of eight, a star, an open box and two laps of scribble", () => {
    for (const paper of [SQUARE, PHONE, LAPTOP]) {
      for (const stroke of [
        overshoot(paper.w, paper.h),
        figureEight(paper.w, paper.h),
        star(paper.w, paper.h),
        box(paper.w, paper.h),
        circle(paper.w / 2, paper.h / 2, 220, 2),
      ]) {
        const t = must(stroke, paper);
        expect(findFault(t)).toBeNull();
      }
    }
  });

  it("refuses a tap and a straight line, and says where", () => {
    const tap = trackFromStroke([{ x: 100, y: 100 }, { x: 102, y: 101 }, { x: 103, y: 101 }], SQUARE.w, SQUARE.h);
    expect(tap.ok).toBe(false);
    if (!tap.ok) expect(tap.fault.kind).toBe("short");
    const line = trackFromStroke(
      Array.from({ length: 40 }, (_, i) => ({ x: 100 + i * 15, y: 300 + i * 2 })),
      SQUARE.w,
      SQUARE.h,
    );
    expect(line.ok).toBe(false);
    if (!line.ok) {
      expect(line.fault.kind).toBe("flat");
      expect(line.fault.x).toBeGreaterThan(100);
    }
  });

  it("accepts nearly every shaky hand-drawn loop, on every paper shape", () => {
    let ok = 0;
    const total = 90;
    for (let n = 0; n < total; n++) {
      const paper = [SQUARE, PHONE, LAPTOP][n % 3];
      if (trackFromStroke(shaky(paper.w, paper.h, n + 1), paper.w, paper.h).ok) ok++;
    }
    expect(ok / total).toBeGreaterThanOrEqual(0.95);
  });

  it("puts the start line on a straight", () => {
    const t = must(PRESETS[1].stroke(LAPTOP.w, LAPTOP.h), LAPTOP);
    const ahead = Math.round(120 / (t.length / t.n));
    let bend = 0;
    for (let i = 0; i < ahead; i++) bend = Math.max(bend, Math.abs(t.kappa[i]));
    const sharpest = Math.max(...Array.from(t.kappa, Math.abs));
    expect(bend).toBeLessThan(sharpest * 0.5);
  });

  it("finds where a point is on the road, and on which side", () => {
    const p = pointAt(oval, 400);
    const place = { i: 0, s: 0, side: 0 };
    // 10 units to the left of the direction of travel.
    locate(oval, p.x + Math.sin(p.angle) * 10, p.y - Math.cos(p.angle) * 10, -1, place);
    expect(place.s).toBeCloseTo(400, 0);
    expect(place.side).toBeCloseTo(10, 1);
    locate(oval, p.x - Math.sin(p.angle) * 10, p.y + Math.cos(p.angle) * 10, place.i, place);
    expect(place.side).toBeCloseTo(-10, 1);
  });
});

describe("sensors", () => {
  // A square room, 200 by 200, with its corner at (100, 100).
  const room = new Float64Array([100, 100, 300, 100, 300, 100, 300, 300, 300, 300, 100, 300, 100, 300, 100, 100]);
  const grid = new WallGrid(room, 400, 400);

  it("reads exact distances in a square room", () => {
    expect(grid.raycast(200, 200, 1, 0, 500)).toBeCloseTo(100, 9);
    expect(grid.raycast(200, 200, 0, -1, 500)).toBeCloseTo(100, 9);
    expect(grid.raycast(150, 200, -1, 0, 500)).toBeCloseTo(50, 9);
    expect(grid.raycast(200, 200, Math.SQRT1_2, Math.SQRT1_2, 500)).toBeCloseTo(100 * Math.SQRT2, 9);
    // 3-4-5 triangle: from the middle, heading (0.6, 0.8), the bottom wall is 125 away.
    expect(grid.raycast(200, 200, 0.6, 0.8, 500)).toBeCloseTo(125, 9);
  });

  it("returns the range when no wall is that close", () => {
    expect(grid.raycast(200, 200, 1, 0, 60)).toBe(60);
  });

  it("agrees with testing every wall on a real track", () => {
    const rng = new Rng(3);
    const seg = oval.walls.seg;
    for (let n = 0; n < 400; n++) {
      const p = pointAt(oval, rng.range(0, oval.length));
      const a = rng.range(0, Math.PI * 2);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let brute = RAY_RANGE;
      for (let k = 0; k < seg.length; k += 4) {
        const ex = seg[k + 2] - seg[k];
        const ey = seg[k + 3] - seg[k + 1];
        const den = dx * ey - dy * ex;
        if (den === 0) continue;
        const t = ((seg[k] - p.x) * ey - (seg[k + 1] - p.y) * ex) / den;
        const u = ((seg[k] - p.x) * dy - (seg[k + 1] - p.y) * dx) / den;
        if (t >= 0 && u >= 0 && u <= 1 && t < brute) brute = t;
      }
      expect(oval.walls.raycast(p.x, p.y, dx, dy, RAY_RANGE)).toBeCloseTo(brute, 9);
    }
  });

  it("gives a car on the centre line equal readings left and right on a straight, and its speed", () => {
    const stadium = must(
      [
        ...Array.from({ length: 30 }, (_, i) => ({ x: 200 + i * 20, y: 200 })),
        ...circle(780, 400, 200, 1, 60).slice(46, 60),
        ...circle(780, 400, 200, 1, 60).slice(0, 16),
        ...Array.from({ length: 30 }, (_, i) => ({ x: 780 - i * 20, y: 600 })),
        ...circle(200, 400, 200, 1, 60).slice(16, 46),
      ],
      LAPTOP,
    );
    const place = { i: 0, s: 0, side: 0 };
    // Find the straightest sample and stand there.
    let at = 0;
    for (let i = 0; i < stadium.n; i++) if (Math.abs(stadium.kappa[i]) < Math.abs(stadium.kappa[at])) at = i;
    const car = makeCar(stadium.x[at], stadium.y[at], Math.atan2(stadium.ty[at], stadium.tx[at]));
    car.speed = 150;
    const input = new Float32Array(RAY_ANGLES.length + 1);
    sense(stadium, car, input);
    locate(stadium, car.x, car.y, at, place);
    for (let r = 0; r < 3; r++) expect(input[r]).toBeCloseTo(input[RAY_ANGLES.length - 1 - r], 1);
    // The 75 degree rays hit the edges 26 units to each side: 26 / sin(75).
    expect(input[0] * RAY_RANGE).toBeCloseTo(HALF_WIDTH / Math.sin(RAY_ANGLES[6]), 0);
    expect(input[RAY_ANGLES.length]).toBeCloseTo(0.5, 6);
  });
});

describe("network", () => {
  it("matches a forward pass worked out by hand", () => {
    const layers = [2, 2, 1];
    expect(weightCount(layers)).toBe(9);
    // hidden 1: weights 0.5, -1, bias 0.1.  hidden 2: weights -0.3, 0.8, bias 0.  output: weights 2, -1, bias 0.05.
    const weights = new Float32Array([0.5, -1, 0.1, -0.3, 0.8, 0, 2, -1, 0.05]);
    const act = makeActivations(layers);
    act[0].set([1, 0.5]);
    const out = forward(layers, weights, act);
    // hidden 1 = tanh(0.5 - 0.5 + 0.1) = tanh(0.1); hidden 2 = tanh(-0.3 + 0.4) = tanh(0.1)
    const hidden = Math.tanh(0.1);
    expect(act[1][0]).toBeCloseTo(hidden, 6);
    expect(act[1][1]).toBeCloseTo(hidden, 6);
    // output = tanh(2h - h + 0.05) = tanh(0.0996680 + 0.05) = 0.148560
    expect(out[0]).toBeCloseTo(0.14856, 5);
  });

  it("has the size the engine says it has", () => {
    expect(GENOME_SIZE).toBe(weightCount(LAYERS));
    expect(LAYERS[0]).toBe(RAY_ANGLES.length + 1);
    expect(LAYERS[LAYERS.length - 1]).toBe(2);
  });
});

describe("car", () => {
  it("accelerates in a straight line and never passes top speed", () => {
    const car = makeCar(0, 0, 0);
    for (let i = 0; i < 600; i++) stepCar(car, 0, 1);
    expect(car.y).toBeCloseTo(0, 6);
    expect(car.speed).toBeGreaterThan(200);
    expect(car.speed).toBeLessThan(300);
  });

  it("slides when asked to turn harder than the tyres can hold", () => {
    const car = makeCar(0, 0, 0);
    for (let i = 0; i < 300; i++) stepCar(car, 0, 1);
    let slid = 0;
    for (let i = 0; i < 40; i++) {
      stepCar(car, 1, 1);
      slid = Math.max(slid, Math.abs(car.slip));
    }
    expect(slid).toBeGreaterThan(5);
    const slow = makeCar(0, 0, 0);
    for (let i = 0; i < 20; i++) stepCar(slow, 0, 1);
    for (let i = 0; i < 40; i++) {
      stepCar(slow, 1, -0.3);
      expect(slow.slip).toBe(0);
    }
  });
});

describe("score", () => {
  it("rewards forward progress only", () => {
    const d = makeDriver(oval, new Float32Array(GENOME_SIZE));
    expect(d.best).toBe(-GRID_OFFSET);
    // Carried forwards along the road: the score follows.
    for (let s = -GRID_OFFSET; s <= 300; s += 5) {
      const p = pointAt(oval, s);
      d.car.x = p.x;
      d.car.y = p.y;
      follow(oval, d, 1);
    }
    const reached = d.best;
    expect(reached).toBeGreaterThan(295);
    // Carried backwards past the line: the score does not move, and no lap is counted.
    for (let s = 295; s >= -200; s -= 5) {
      const p = pointAt(oval, s);
      d.car.x = p.x;
      d.car.y = p.y;
      expect(follow(oval, d, 2)).toBe(0);
    }
    expect(d.best).toBe(reached);
    expect(d.progress).toBeCloseTo(-200, 0);
    expect(d.laps).toBe(0);
  });

  it("counts a lap only after driving all the way round", () => {
    const d = makeDriver(oval, new Float32Array(GENOME_SIZE));
    let laps = 0;
    for (let s = -GRID_OFFSET; s <= oval.length + 10; s += 5) {
      const p = pointAt(oval, s);
      d.car.x = p.x;
      d.car.y = p.y;
      if (follow(oval, d, s / 100) > 0) laps++;
    }
    expect(laps).toBe(1);
    expect(d.laps).toBe(1);
  });

  it("retires cars that stand still, reverse, or dawdle", () => {
    const trainer = new Trainer(oval, 1, 3);
    const [still, wall, spin] = trainer.drivers;
    still.genome.fill(0);
    still.genome[GENOME_SIZE - 1] = -5; // foot hard on the brake
    wall.genome.fill(0); // rolls straight on until the first bend
    spin.genome.fill(0);
    spin.genome[GENOME_SIZE - 1 - (LAYERS[1] + 1)] = 5; // full lock, turning on the spot
    const outs = new Map<number, string>();
    for (let i = 0; i < 60 * 30 && trainer.generation === 1; i++) {
      const drivers = trainer.drivers;
      const ev = trainer.step();
      for (const k of ev.out) outs.set(k, drivers[k].out!);
    }
    expect(["stall", "slow"]).toContain(outs.get(0));
    expect(outs.get(1)).toBe("wall");
    expect(["stall", "wrong", "slow", "wall"]).toContain(outs.get(2));
    expect(trainer.history[0].best).toBeLessThan(0.5);
  });
});

describe("learning", () => {
  it("evolves identically from the same seed, differently from another", () => {
    const run = (seed: number): { history: number[]; champion: number[] } => {
      const trainer = new Trainer(oval, seed);
      while (trainer.generation <= 4) trainer.step();
      return { history: trainer.history.map((r) => r.best), champion: Array.from(trainer.champion!) };
    };
    const a = run(11);
    expect(run(11)).toEqual(a);
    expect(run(12)).not.toEqual(a);
  });

  it("keeps the best driver unchanged from one generation to the next", () => {
    const trainer = new Trainer(oval, 5);
    while (trainer.generation === 1) trainer.step();
    expect(Array.from(trainer.drivers[0].genome)).toEqual(Array.from(trainer.champion!));
    const first = trainer.history[0].best;
    while (trainer.generation <= 6) trainer.step();
    // The same car on the same track drives the same distance, so the best can never get worse.
    for (let g = 1; g < trainer.history.length; g++) {
      if (trainer.history[g - 1].finish === 0) expect(trainer.history[g].best).toBeGreaterThanOrEqual(trainer.history[g - 1].best - 1e-9);
    }
    expect(Math.min(3, trainer.history[5].best)).toBeGreaterThanOrEqual(Math.min(3, first));
  });

  const fixtures: [string, () => Track][] = [
    ["oval, square paper", () => oval],
    ["peanut, laptop paper", () => must(PRESETS[1].stroke(LAPTOP.w, LAPTOP.h), LAPTOP)],
    ["peanut, phone paper", () => must(PRESETS[1].stroke(PHONE.w, PHONE.h), PHONE)],
    ["clover, phone paper", () => must(PRESETS[2].stroke(PHONE.w, PHONE.h), PHONE)],
    ["clover, laptop paper", () => must(PRESETS[2].stroke(LAPTOP.w, LAPTOP.h), LAPTOP)],
    ["figure of eight", () => must(figureEight(SQUARE.w, SQUARE.h))],
    ["star", () => must(star(LAPTOP.w, LAPTOP.h), LAPTOP)],
    ["open box", () => must(box(PHONE.w, PHONE.h), PHONE)],
    ["shaky hand 1", () => must(shaky(SQUARE.w, SQUARE.h, 4))],
    ["shaky hand 2", () => must(shaky(PHONE.w, PHONE.h, 9), PHONE)],
    ["random drawing 1", () => must(randomStroke(new Rng(21), LAPTOP.w, LAPTOP.h), LAPTOP)],
    ["random drawing 2", () => must(randomStroke(new Rng(22), PHONE.w, PHONE.h), PHONE)],
  ];

  it.each(fixtures)("reaches a clean lap within 40 generations: %s", (_name, make) => {
    const track = make();
    const trainer = new Trainer(track, 2026);
    while (trainer.firstLapGeneration === 0 && trainer.generation <= 40) trainer.step();
    expect(trainer.firstLapGeneration).toBeGreaterThan(0);
    expect(trainer.firstLapGeneration).toBeLessThanOrEqual(40);
    // Keep going until one car finishes every lap, then check that driver alone.
    while (trainer.finishedGeneration === 0 && trainer.generation <= 60) trainer.step();
    expect(trainer.finishedGeneration).toBeGreaterThan(0);
    const solo = driveSolo(track, trainer.champion!, TARGET_LAPS);
    expect(solo.laps).toBe(TARGET_LAPS);
    expect(solo.lapTimes.length).toBe(TARGET_LAPS);
    expect(Math.min(...solo.lapTimes)).toBeCloseTo(trainer.bestLap, 0);
  });

  it("is fast enough to simulate many generations a second", () => {
    const trainer = new Trainer(oval, 1);
    const t0 = performance.now();
    let steps = 0;
    while (steps < 6000) {
      trainer.step();
      steps++;
    }
    const perStep = (performance.now() - t0) / steps;
    // One step of the whole field has to fit many times into a 16 ms frame.
    expect(perStep).toBeLessThan(2);
    expect(DT).toBeCloseTo(1 / 60, 9);
  });
});
