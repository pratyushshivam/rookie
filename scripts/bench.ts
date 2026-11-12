/**
 * Learning bench: random tracks, one training run each, and how many
 * generations it took to get a clean lap. `npx tsx scripts/bench.ts [tracks] [generations]`.
 */
import { DT, Rng, Trainer, WORLD_AREA, paperFor, randomStroke, trackFromStroke } from "../src/engine";

const tracks = Number(process.argv[2] ?? 40);
const budget = Number(process.argv[3] ?? 40);
const ASPECTS = [0.62, 0.8, 1, 1.3, 1.7];

const firstLap: number[] = [];
const finish: number[] = [];
let refused = 0;
let failed = 0;
let simSeconds = 0;
let simToLap = 0;
const t0 = Date.now();
for (let n = 0; n < tracks; n++) {
  const rng = new Rng(1000 + n);
  const { w, h } = paperFor(ASPECTS[n % ASPECTS.length], WORLD_AREA);
  const made = trackFromStroke(randomStroke(rng, w, h), w, h);
  if (!made.ok) {
    refused++;
    console.log(`#${n} refused: ${made.fault.kind}`);
    continue;
  }
  const trainer = new Trainer(made.track, 7 + n);
  let sim = 0;
  let lapSim = 0;
  while (trainer.generation <= budget && trainer.finishedGeneration === 0) {
    trainer.step();
    sim += DT;
    if (trainer.firstLapGeneration === 0) lapSim = sim;
  }
  simSeconds += sim;
  if (trainer.firstLapGeneration === 0) {
    failed++;
    console.log(`#${n} NO LAP in ${budget} generations (best ${Math.max(...trainer.history.map((r) => r.best)).toFixed(2)} laps, length ${made.track.length.toFixed(0)})`);
  } else {
    firstLap.push(trainer.firstLapGeneration);
    simToLap += lapSim;
    if (trainer.finishedGeneration) finish.push(trainer.finishedGeneration);
  }
}
const q = (a: number[], p: number): number => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] ?? NaN;
console.log(`\n${tracks} drawings, ${refused} refused, ${failed} without a lap in ${budget} generations`);
console.log(`first clean lap: median generation ${q(firstLap, 0.5)}, 90% by ${q(firstLap, 0.9)}, worst ${q(firstLap, 1)}`);
console.log(`three laps:      median generation ${q(finish, 0.5)}, 90% by ${q(finish, 0.9)}, reached in ${finish.length} of ${firstLap.length}`);
console.log(`simulated time to first lap: mean ${(simToLap / Math.max(1, firstLap.length)).toFixed(0)} s; whole bench ${simSeconds.toFixed(0)} sim s in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
