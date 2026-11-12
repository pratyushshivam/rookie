/**
 * Race bench: trains a rookie on random tracks, then lets a simple
 * aim-at-the-road driver stand in for a person, to see how close the race is.
 * `npx tsx scripts/racebench.ts [tracks] [extra generations]`.
 */
import { Race, Rng, Trainer, WORLD_AREA, aimSteer, driveSolo, paperFor, randomStroke, trackFromStroke } from "../src/engine";

const tracks = Number(process.argv[2] ?? 12);
const extra = Number(process.argv[3] ?? 0);
for (let n = 0; n < tracks; n++) {
  const rng = new Rng(500 + n);
  const { w, h } = paperFor([0.62, 1, 1.6][n % 3], WORLD_AREA);
  const made = trackFromStroke(randomStroke(rng, w, h), w, h);
  if (!made.ok) continue;
  const trainer = new Trainer(made.track, n + 1);
  while (trainer.firstLapGeneration === 0 && trainer.generation <= 40) trainer.step();
  const stopAt = trainer.generation + 1 + extra;
  while (trainer.generation < stopAt) trainer.step();
  const solo = driveSolo(made.track, trainer.champion!, 3);
  const race = new Race(made.track, trainer.champion!);
  while (!race.over && race.time < 200) race.step({ steer: aimSteer(made.track, race.player.driver), push: false });
  const fmt = (t: number[]): string => t.map((x) => x.toFixed(1)).join(" ");
  console.log(
    `#${n} len ${made.track.length.toFixed(0)} gen ${trainer.generation - 1} solo laps ${solo.laps} | rookie ${race.rookie.finish.toFixed(1)} s (${fmt(race.rookie.lapTimes)}) crashes ${race.rookie.crashes} | steady driver ${race.player.finish.toFixed(1)} s (${fmt(race.player.lapTimes)}) crashes ${race.player.crashes}`,
  );
}
