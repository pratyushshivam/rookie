import { describe, expect, it } from "vitest";
import {
  GENOME_SIZE,
  PRESETS,
  Race,
  Rng,
  TARGET_LAPS,
  Trainer,
  aimSteer,
  decodeShare,
  encodeShare,
  randomGenome,
  randomStroke,
  trackFromStroke,
  type Track,
} from "../src/engine";
import { LAPTOP, PHONE, SQUARE, shaky } from "./fixtures";

function must(stroke: { x: number; y: number }[], paper = SQUARE): Track {
  const made = trackFromStroke(stroke, paper.w, paper.h);
  if (!made.ok) throw new Error(`refused: ${made.fault.kind}`);
  return made.track;
}

describe("links", () => {
  it("round-trips the track and every weight exactly", () => {
    const tracks = [
      must(PRESETS[2].stroke(PHONE.w, PHONE.h), PHONE),
      must(shaky(LAPTOP.w, LAPTOP.h, 3), LAPTOP),
      must(randomStroke(new Rng(8), SQUARE.w, SQUARE.h)),
    ];
    tracks.forEach((track, n) => {
      const genome = randomGenome(new Rng(n + 1));
      genome[0] = -0; // an awkward value on purpose
      genome[1] = 1e-30;
      const text = encodeShare({ track, genome, generations: 17 + n, bestLap: 9.87 });
      expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(text.length).toBeLessThan(1400);
      const back = decodeShare(text)!;
      expect(back).not.toBeNull();
      expect(back.generations).toBe(17 + n);
      expect(back.bestLap).toBeCloseTo(9.87, 9);
      expect(Array.from(back.track.ctrl)).toEqual(Array.from(track.ctrl));
      expect(back.track.w).toBe(track.w);
      expect(back.track.h).toBe(track.h);
      // Bit for bit, including the sign of zero.
      expect(new Uint8Array(back.genome.buffer)).toEqual(new Uint8Array(genome.buffer));
      // And the rebuilt road is the same road.
      expect(Array.from(back.track.x)).toEqual(Array.from(track.x));
      expect(Array.from(back.track.y)).toEqual(Array.from(track.y));
      expect(encodeShare(back)).toBe(text);
    });
  });

  it("a shared rookie drives the same race for whoever opens the link", () => {
    const track = must(PRESETS[0].stroke(SQUARE.w, SQUARE.h));
    const trainer = new Trainer(track, 99);
    while (trainer.finishedGeneration === 0 && trainer.generation <= 60) trainer.step();
    const back = decodeShare(encodeShare({ track, genome: trainer.champion!, generations: trainer.generation - 1, bestLap: trainer.bestLap }))!;
    const laps = (t: Track, g: Float32Array): number[] => {
      const race = new Race(t, g);
      while (race.rookie.finish === 0 && race.time < 120) race.step({ steer: 0, push: false });
      return race.rookie.lapTimes;
    };
    const mine = laps(track, trainer.champion!);
    expect(mine.length).toBe(TARGET_LAPS);
    expect(laps(back.track, back.genome)).toEqual(mine);
  });

  it("refuses anything that is not a whole link", () => {
    const track = must(PRESETS[0].stroke(SQUARE.w, SQUARE.h));
    const text = encodeShare({ track, genome: new Float32Array(GENOME_SIZE), generations: 1, bestLap: 0 });
    expect(decodeShare("")).toBeNull();
    expect(decodeShare("hello")).toBeNull();
    expect(decodeShare("not a link!")).toBeNull();
    expect(decodeShare(text.slice(0, -8))).toBeNull();
    expect(decodeShare("B" + text.slice(1))).toBeNull(); // another format version
    expect(decodeShare(text)).not.toBeNull();
  });
});

describe("race", () => {
  const track = must(PRESETS[1].stroke(LAPTOP.w, LAPTOP.h), LAPTOP);

  it("a steady hand finishes three laps without touching the wall", () => {
    const race = new Race(track, new Float32Array(GENOME_SIZE));
    while (race.player.finish === 0 && race.time < 120) race.step({ steer: aimSteer(track, race.player.driver), push: false });
    expect(race.player.finish).toBeGreaterThan(0);
    expect(race.player.crashes).toBe(0);
    expect(race.player.lapTimes.length).toBe(TARGET_LAPS);
    // A flying lap is quicker than the one from a standing start.
    expect(race.player.lapTimes[1]).toBeLessThan(race.player.lapTimes[0]);
  });

  it("puts a car that hits the wall back on the road, stopped, and makes it wait", () => {
    const race = new Race(track, new Float32Array(GENOME_SIZE));
    let crashed = false;
    for (let i = 0; i < 60 * 20 && !crashed; i++) crashed = race.step({ steer: 0.4, push: true }).playerCrash;
    expect(crashed).toBe(true);
    const d = race.player.driver;
    expect(d.car.speed).toBe(0);
    expect(Math.abs(d.side)).toBe(0);
    const { x, y } = d.car;
    race.step({ steer: 0, push: true });
    expect(d.car.x).toBe(x);
    expect(d.car.y).toBe(y);
    for (let i = 0; i < 60; i++) race.step({ steer: aimSteer(track, d), push: false });
    expect(Math.hypot(d.car.x - x, d.car.y - y)).toBeGreaterThan(1);
  });

  it("ends when both cars are home and knows who won", () => {
    const trainer = new Trainer(track, 4);
    while (trainer.finishedGeneration === 0 && trainer.generation <= 60) trainer.step();
    const race = new Race(track, trainer.champion!);
    while (!race.over && race.time < 200) race.step({ steer: aimSteer(track, race.player.driver), push: false });
    expect(race.over).toBe(true);
    expect(race.rookie.finish).toBeGreaterThan(0);
    expect(race.rookie.crashes).toBe(0);
    expect(race.player.finish).toBeGreaterThan(0);
    expect(Math.sign(race.gap())).toBe(race.player.finish < race.rookie.finish ? 1 : -1);
  });
});
