/**
 * The page: draw a track, watch a field of cars learn it, race the best one.
 * All the thinking is in src/engine; this file is pointer input, the frame
 * loop, and keeping the words on the page in step with what is happening.
 */
import {
  DT,
  MAX_SPEED,
  POPULATION,
  PRESETS,
  Race,
  Rng,
  TARGET_LAPS,
  Trainer,
  WALL_REACH,
  WORLD_AREA,
  aimSteer,
  driveSolo,
  driveStep,
  makeDriver,
  paperFor,
  randomStroke,
  trackFromStroke,
  type Driver,
  type Fault,
  type Pt,
  type Track,
} from "./engine";
import { Sound } from "./game/audio";
import { drawBrain, drawChart, howDiagrams } from "./game/panels";
import { drawCard, readShare, seconds, shareText, shareUrl, verdict, type Outcome } from "./game/share";
import { ACCENT, INK, Stage, YOU, blend, trackArt, type Box, type Camera, type TrackArt } from "./game/stage";
import { bestLap, saveBestLap, trackKey } from "./game/storage";

type Phase = "draw" | "build" | "learn" | "visit" | "race";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const stage = new Stage($<HTMLCanvasElement>("stage"));
const sound = new Sound();
const params = new URLSearchParams(location.search);
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
const touch = matchMedia("(pointer: coarse)").matches;
/** ?auto lets a simple aim-at-the-road driver take the visitor's car, for recordings. */
const auto = params.has("auto");

const el = {
  slot: $("slot"),
  prompt: $("prompt"),
  count: $("count"),
  toast: $("toast"),
  minimap: $<HTMLCanvasElement>("minimap"),
  steer: $("steer"),
  gen: $("gen"),
  status: $("status"),
  chart: $<HTMLCanvasElement>("chart"),
  brain: $<HTMLCanvasElement>("brain"),
  brainCaption: $("brain-caption"),
  race: $<HTMLButtonElement>("race"),
  lap: $("lap"),
  gap: $("gap"),
  result: $("result"),
  how: $("how"),
};

// ---------- state ----------

let phase: Phase = "draw";
let slot: Box = { x: 0, y: 0, w: 100, h: 100 };
let track: Track | null = null;
let art: TrackArt | null = null;
let trainer: Trainer | null = null;
let speed = 1;
let speedChosen = false;
/** The driver that will be raced, and the line it takes. */
let rookie: { genome: Float32Array; generations: number; bestLap: number; line: number[] } | null = null;
/** True when the rookie came in a link rather than being trained here. */
let visiting = false;
/** One car driving alone, when there is nothing else to show: a visit, or training at rest. */
let solo: Driver | null = null;
let resting = false;

// drawing
let stroke: Pt[] = [];
let drawing = false;
let ghostAt = 0.6;
let ghostPath: Pt[] = [];
let refused: { stroke: Pt[]; fault: Fault; at: number } | null = null;
let buildAt = 0;
let preview: { points: Pt[]; at: number } | null = null;

// learning
let stepDebt = 0;
let markTick = 0;
const prevX = new Float32Array(POPULATION + 2);
const prevY = new Float32Array(POPULATION + 2);
let prevValid = false;
const wrecks: { x: number; y: number; heading: number; at: number }[] = [];
const confetti: { x: number; y: number; vx: number; vy: number; spin: number; angle: number; at: number; colour: string }[] = [];
let chartDirty = true;

// racing
let race: Race | null = null;
let raceClock = 0;
let raceStarted = false;
let raceOverAt = 0;
let camFrom: Camera | null = null;
let camAngle = 0;
let passYou: number[] = [];
let passAi: number[] = [];
let outcome: Outcome | null = null;
const keys = { left: false, right: false, push: false };
const fingers = new Map<number, number>();

let now = 0;

// ---------- layout ----------

function measure(): void {
  stage.resize();
  const r = el.slot.getBoundingClientRect();
  slot = { x: r.left, y: r.top, w: Math.max(40, r.width), h: Math.max(40, r.height) };
  if (phase === "draw" && !drawing) {
    const paper = paperFor(slot.w / slot.h, WORLD_AREA);
    if (paper.w !== stage.paper.w || paper.h !== stage.paper.h) {
      stage.setPaper(paper.w, paper.h);
      ghostPath = PRESETS[1].stroke(paper.w, paper.h).map((p) => ({
        x: paper.w / 2 + (p.x - paper.w / 2) * 0.86,
        y: paper.h / 2 + (p.y - paper.h / 2) * 0.86,
      }));
      stroke = [];
      refused = null;
    }
  }
  chartDirty = true;
}

function setPhase(next: Phase): void {
  phase = next;
  document.body.dataset.phase = next;
  $("pane-draw").hidden = !(next === "draw" || next === "build");
  $("pane-learn").hidden = next !== "learn";
  $("pane-visit").hidden = next !== "visit";
  $("pane-race").hidden = next !== "race";
  el.prompt.hidden = next !== "draw";
  el.minimap.hidden = next !== "race";
  el.steer.hidden = !(next === "race" && touch);
  el.count.hidden = true;
  // The column changes height on a phone, so the sheet may have moved.
  measure();
}

function say(node: HTMLElement, html: string): void {
  if (node.dataset.shown !== html) {
    node.dataset.shown = html;
    node.innerHTML = html;
  }
}

function toast(html: string): void {
  el.toast.hidden = true;
  el.toast.innerHTML = html;
  void el.toast.offsetWidth;
  el.toast.hidden = false;
}

// ---------- drawing a track ----------

const HINTS: Record<Fault["kind"], string> = {
  short: "Bigger. Go all the way round",
  flat: "Make it a loop",
  tight: "Too tight here. Give it room",
  pinch: "Too close here. Give it room",
  long: "A little simpler",
};

function toDraw(): void {
  track = null;
  art = null;
  trainer = null;
  rookie = null;
  race = null;
  solo = null;
  visiting = false;
  stroke = [];
  refused = null;
  preview = null;
  ghostAt = now + 0.5;
  wrecks.length = 0;
  el.prompt.textContent = "Draw a loop";
  el.prompt.className = "prompt";
  el.result.hidden = true;
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  setPhase("draw");
  stage.clearMarks();
  sound.hum(0, 0);
}

function accept(points: Pt[]): void {
  const made = trackFromStroke(points, stage.paper.w, stage.paper.h);
  if (!made.ok) {
    refused = { stroke: points, fault: made.fault, at: now };
    stroke = [];
    el.prompt.textContent = HINTS[made.fault.kind];
    el.prompt.className = "prompt hint";
    ghostAt = now + 2.2;
    sound.refuse();
    return;
  }
  refused = null;
  stroke = points;
  useTrack(made.track);
  buildAt = now;
  setPhase("build");
  el.prompt.hidden = true;
  sound.built();
}

function useTrack(t: Track): void {
  track = t;
  art = trackArt(t);
  stage.setPaper(t.w, t.h);
}

function startLearning(): void {
  if (!track) return;
  const seed = Number(params.get("seed")) || Math.floor(Math.random() * 2 ** 31);
  trainer = new Trainer(track, seed);
  rookie = null;
  solo = null;
  resting = false;
  visiting = false;
  stepDebt = 0;
  prevValid = false;
  wrecks.length = 0;
  if (!speedChosen) setSpeed(Number(params.get("speed") ?? 1), false);
  el.race.disabled = true;
  el.race.classList.remove("ready");
  el.race.textContent = "Race your rookie";
  el.brainCaption.textContent = "The leader’s brain, live";
  say(el.gen, "1");
  chartDirty = true;
  setPhase("learn");
}

function setSpeed(value: number, chosen: boolean): void {
  speed = value === 0 || value === 4 ? value : 1;
  if (chosen) speedChosen = true;
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
    b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === speed));
  }
}

// ---------- learning ----------

function celebrate(): void {
  if (!trainer || !track) return;
  toast(`First clean lap <b>·</b> generation ${trainer.generation}`);
  sound.firstLap();
  if (calm) return;
  const nx = track.ty[0];
  const ny = -track.tx[0];
  for (let i = 0; i < 46; i++) {
    const across = (Math.random() * 2 - 1) * 24;
    const a = Math.atan2(track.ty[0], track.tx[0]) + (Math.random() - 0.5) * 2.4;
    const v = 60 + Math.random() * 190;
    confetti.push({
      x: track.x[0] + nx * across,
      y: track.y[0] + ny * across,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      spin: (Math.random() - 0.5) * 14,
      angle: Math.random() * 6,
      at: now,
      colour: i % 3 === 0 ? ACCENT : INK,
    });
  }
}

/** Collects one tyre-mark segment per live car since the last sample. */
function sampleMarks(drivers: Driver[], segs: number[]): void {
  for (let k = 0; k < drivers.length; k++) {
    const d = drivers[k];
    if (!d.alive) continue;
    if (prevValid && d.car.speed > 8) {
      segs.push(prevX[k], prevY[k], d.car.x, d.car.y, d.car.heading, Math.abs(d.car.slip) > 22 ? 2 : 1);
    }
    prevX[k] = d.car.x;
    prevY[k] = d.car.y;
  }
  prevValid = true;
}

function learnFrame(dt: number): void {
  if (!trainer || !track) return;
  if (resting) {
    soloFrame(dt);
    return;
  }
  const t0 = performance.now();
  let steps: number;
  if (speed === 0) steps = 100000;
  else {
    stepDebt += (dt * speed) / DT;
    steps = Math.min(Math.floor(stepDebt), 14 * speed);
    stepDebt -= Math.floor(stepDebt);
  }
  const every = speed === 1 ? 2 : 4;
  const segs: number[] = [];
  for (let n = 0; n < steps; n++) {
    const drivers = trainer.drivers;
    const ev = trainer.step();
    for (const k of ev.out) {
      if (speed !== 0 || wrecks.length < 40) {
        const c = drivers[k].car;
        wrecks.push({ x: c.x, y: c.y, heading: c.heading, at: now });
      }
    }
    if (ev.firstLap) celebrate();
    if (ev.bred) {
      // Marks for the generation that just ended are flushed before the grid is reset.
      prevValid = false;
      markTick = 0;
      sound.generation(trainer.generation);
      chartDirty = true;
      if (!speedChosen && speed === 1 && trainer.generation >= 3) setSpeed(4, false);
      if (trainer.finishedGeneration > 0 && trainer.stalled >= 18) {
        resting = true;
        break;
      }
    } else if (++markTick % every === 0) sampleMarks(trainer.drivers, segs);
    if (speed === 0 && (n & 7) === 7 && performance.now() - t0 > 9) break;
  }
  if (segs.length) stage.addMarks(segs);
  while (wrecks.length > 160) wrecks.shift();

  // Words.
  say(el.gen, String(trainer.generation));
  document.body.dataset.gen = String(trainer.generation);
  const ready = trainer.finishedGeneration > 0 && trainer.champion !== null;
  if (ready && el.race.disabled) {
    el.race.disabled = false;
    el.race.classList.add("ready");
    document.body.dataset.ready = "1";
  }
  if (ready) say(el.status, `Best lap <b>${seconds(trainer.bestLap)}</b>${resting ? "" : " and still learning"}`);
  else if (trainer.firstLapGeneration > 0) say(el.status, `One clean lap. Now ${TARGET_LAPS} in a row`);
  else say(el.status, `${trainer.alive} of ${trainer.drivers.length} still driving`);

  const lead = trainer.drivers[trainer.leader];
  sound.hum(lead ? lead.car.speed / MAX_SPEED : 0, speed === 0 ? 0.35 : 0.8);
}

/** The single showcase car: the trained driver lapping on its own. */
function soloFrame(dt: number): void {
  if (!track || !rookie) {
    if (trainer?.champion && track) rookie = makeRookie(trainer.champion, trainer.generation - 1, trainer.bestLap);
    else return;
  }
  if (!solo) {
    solo = makeDriver(track, rookie.genome);
    prevValid = false;
  }
  stepDebt += dt / DT;
  const steps = Math.min(Math.floor(stepDebt), 8);
  stepDebt -= Math.floor(stepDebt);
  for (let n = 0; n < steps; n++) {
    driveStep(track, solo, 0);
    solo.lastGain = 0;
    if (Math.abs(solo.side) > WALL_REACH || solo.laps >= 40) {
      solo = makeDriver(track, rookie.genome);
      break;
    }
  }
  sound.hum(solo.car.speed / MAX_SPEED, 0.6);
  if (phase === "learn" && trainer) {
    say(el.status, `Best lap <b>${seconds(trainer.bestLap)}</b>. Ready when you are`);
    el.brainCaption.textContent = "Your rookie’s brain, live";
  }
}

function makeRookie(genome: Float32Array, generations: number, lap: number): NonNullable<typeof rookie> {
  const run = driveSolo(track!, genome, TARGET_LAPS);
  // Keep the last part of its drive: one flying lap, as the line to show in the race.
  const from = Math.floor((run.path.length / 2) * 0.62) * 2;
  const best = run.lapTimes.length ? Math.min(...run.lapTimes) : lap;
  return { genome: genome.slice(), generations, bestLap: lap > 0 ? Math.min(lap, best) : best, line: run.path.slice(from) };
}

// ---------- racing ----------

function startRace(): void {
  if (!track) return;
  if (trainer?.champion && !visiting) rookie = makeRookie(trainer.champion, trainer.generation - 1, trainer.bestLap);
  if (!rookie) return;
  race = new Race(track, rookie.genome);
  raceClock = 0;
  raceStarted = false;
  raceOverAt = 0;
  outcome = null;
  camFrom = { ...stage.cam };
  camAngle = cameraAngle(race.player.driver.car.heading);
  passYou = [];
  passAi = [];
  prevValid = false;
  solo = null;
  keys.left = keys.right = keys.push = false;
  fingers.clear();
  el.result.hidden = true;
  for (const id of ["you-1", "you-2", "you-3", "you-t", "ai-1", "ai-2", "ai-3", "ai-t"]) {
    $(id).textContent = "–";
    $(id).className = "";
  }
  say(el.lap, "1");
  say(el.gap, "");
  $("race-help").innerHTML = touch
    ? "Hold the <kbd>left</kbd> or <kbd>right</kbd> side of the screen to steer. Speed is looked after for you. Hold <kbd>both</kbd> to push harder than is wise."
    : "Steer with <kbd>←</kbd> and <kbd>→</kbd>. Speed is looked after for you. Hold <kbd>↑</kbd> or <kbd>space</kbd> to push harder than is wise.";
  $("race-quit").textContent = visiting ? "Back" : "Back to training";
  el.steer.classList.remove("quiet");
  setPhase("race");
  el.count.hidden = false;
  el.count.className = "count";
  el.count.textContent = "3";
}

function cameraAngle(heading: number): number {
  return -heading - Math.PI / 2;
}

function raceCamera(): Camera {
  const car = race!.player.driver.car;
  const zoom = Math.max(0.85, Math.min(1.8, Math.min(slot.w, slot.h) / 600));
  return { x: car.x, y: car.y, angle: camAngle, zoom, ax: slot.x + slot.w / 2, ay: slot.y + slot.h * 0.66 };
}

function steerInput(): { steer: number; push: boolean } {
  let left = keys.left;
  let right = keys.right;
  for (const side of fingers.values()) {
    if (side < 0) left = true;
    else right = true;
  }
  const both = left && right;
  document.querySelector(".steer-left")?.classList.toggle("down", left);
  document.querySelector(".steer-right")?.classList.toggle("down", right);
  return { steer: both ? 0 : left ? -1 : right ? 1 : 0, push: keys.push || both };
}

function raceFrame(dt: number): void {
  if (!race || !track) return;
  raceClock += dt;
  const COUNT = 0.75;
  if (!raceStarted) {
    const n = 3 - Math.floor(raceClock / COUNT);
    if (n >= 1) {
      if (el.count.textContent !== String(n)) sound.beep(false);
      el.count.textContent = String(n);
      if (raceClock < 0.05) sound.beep(false);
    } else {
      raceStarted = true;
      stepDebt = 0;
      el.count.textContent = "Go";
      el.count.className = "count go";
      sound.beep(true);
      setTimeout(() => (el.count.hidden = true), 650);
      setTimeout(() => el.steer.classList.add("quiet"), 5000);
    }
  }

  if (raceStarted) {
    stepDebt += dt / DT;
    const steps = Math.min(Math.floor(stepDebt), 8);
    stepDebt -= Math.floor(stepDebt);
    const input = auto ? { steer: aimSteer(track, race.player.driver), push: false } : steerInput();
    const segsYou: number[] = [];
    const segsAi: number[] = [];
    for (let n = 0; n < steps && !race.over; n++) {
      const ev = race.step(input);
      const you = race.player;
      const ai = race.rookie;
      if (ev.playerCrash) sound.crash();
      if (ev.playerLap > 0) {
        sound.lap();
        fillLap("you", you.lapTimes, you.finish);
      }
      if (ev.rookieLap > 0) fillLap("ai", ai.lapTimes, ai.finish);
      // When each car passed each 25 units of road, for the gap in seconds.
      while (you.driver.best >= passYou.length * 25) passYou.push(race.time);
      while (ai.driver.best >= passAi.length * 25) passAi.push(race.time);
      if (++markTick % 2 === 0) {
        const cars = [you.driver, ai.driver];
        for (let k = 0; k < 2; k++) {
          const c = cars[k].car;
          const held = (k === 0 ? you : ai).held > 0;
          if (prevValid && c.speed > 8 && !held && Math.hypot(c.x - prevX[k], c.y - prevY[k]) < 40) {
            (k === 0 ? segsYou : segsAi).push(prevX[k], prevY[k], c.x, c.y, c.heading, Math.abs(c.slip) > 22 ? 2 : 1.5);
          }
          prevX[k] = c.x;
          prevY[k] = c.y;
        }
        prevValid = true;
      }
      if (ev.over) finishRace();
    }
    if (segsYou.length) stage.addMarks(segsYou, "42,92,143");
    if (segsAi.length) stage.addMarks(segsAi, "212,73,26");

    const you = race.player;
    say(el.lap, String(Math.min(TARGET_LAPS, you.driver.laps + 1)));
    const shared = Math.min(passYou.length, passAi.length) - 1;
    if (shared > 2 && !race.over) {
      const gap = passYou[shared] - passAi[shared];
      say(el.gap, Math.abs(gap) < 0.05 ? "Level" : gap < 0 ? `<b>${(-gap).toFixed(1)} s</b> ahead` : `${gap.toFixed(1)} s behind`);
    }
    sound.hum(you.driver.car.speed / MAX_SPEED, you.finish > 0 ? 0.3 : 1);
  } else sound.hum(0.05 + 0.1 * Math.abs(Math.sin(raceClock * 5)), 0.8);

  // The camera rides behind the visitor's car, turning a little later than the car does.
  const want = cameraAngle(race.player.driver.car.heading);
  let turn = want - camAngle;
  while (turn > Math.PI) turn -= 2 * Math.PI;
  while (turn < -Math.PI) turn += 2 * Math.PI;
  camAngle += turn * Math.min(1, dt * 5);

  if (raceOverAt > 0 && now > raceOverAt && el.result.hidden) showResult();
}

function fillLap(who: "you" | "ai", laps: number[], total: number): void {
  const best = Math.min(...laps);
  laps.forEach((t, i) => {
    const cell = $(`${who}-${i + 1}`);
    cell.textContent = t.toFixed(2);
    cell.className = t === best && laps.length > 1 ? "best" : "";
  });
  if (total > 0) $(`${who}-t`).textContent = total.toFixed(2);
}

function finishRace(): void {
  if (!race || !rookie || !track) return;
  const you = race.player;
  const ai = race.rookie;
  outcome = {
    you: you.finish,
    rookie: ai.finish,
    yourBest: you.lapTimes.length ? Math.min(...you.lapTimes) : 0,
    rookieBest: ai.lapTimes.length ? Math.min(...ai.lapTimes) : rookie.bestLap,
    generations: rookie.generations,
  };
  raceOverAt = now + 1.1;
  sound.finish(verdict(outcome).won);
}

function showResult(): void {
  if (!outcome || !track) return;
  const v = verdict(outcome);
  const key = trackKey(track.ctrl);
  const before = bestLap(key);
  const record = outcome.yourBest > 0 && (before === 0 || outcome.yourBest < before);
  if (record) saveBestLap(key, outcome.yourBest);
  $("result-kicker").textContent = `${TARGET_LAPS} laps`;
  $("result-head").textContent = v.head;
  $("result-sub").textContent = v.sub;
  $("result-you").innerHTML =
    seconds(outcome.yourBest) + (record && before > 0 ? "<small>your best here</small>" : !record && before > 0 ? `<small>best ${seconds(before)}</small>` : "");
  $("result-ai").textContent = seconds(outcome.rookieBest);
  $("result-gen").textContent = `${outcome.generations} generation${outcome.generations === 1 ? "" : "s"}`;
  $("train-more").hidden = visiting;
  $<HTMLButtonElement>("share").textContent = "Share";
  el.result.hidden = false;
  sound.hum(0, 0);
  $("again").focus({ preventScroll: true });
}

function link(): string {
  return shareUrl(location.href.split("?")[0], { track: track!, genome: rookie!.genome, generations: rookie!.generations, bestLap: rookie!.bestLap });
}

function card(): HTMLCanvasElement {
  return drawCard(track!, art!, stage.marksImage(), rookie!.line, outcome, rookie!.generations, rookie!.bestLap);
}

async function share(button: HTMLButtonElement): Promise<void> {
  if (!rookie || !track || !outcome) return;
  const url = link();
  const text = shareText(outcome, url);
  try {
    if (touch && navigator.share) {
      const blob = await new Promise<Blob | null>((done) => card().toBlob(done, "image/png"));
      const files = blob ? [new File([blob], "rookie.png", { type: "image/png" })] : [];
      const data: ShareData = navigator.canShare?.({ files }) ? { text, files } : { text };
      await navigator.share(data);
      return;
    }
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied, with the link";
  } catch {
    // The share sheet was closed, or the clipboard is not allowed: put the link in the address bar instead.
    history.replaceState(null, "", url);
    button.textContent = "Link is in the address bar";
  }
}

function saveCard(): void {
  if (!rookie || !track) return;
  card().toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "rookie.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, "image/png");
}

function backToTraining(): void {
  race = null;
  el.result.hidden = true;
  prevValid = false;
  solo = null;
  if (visiting) {
    setPhase("visit");
    return;
  }
  resting = false;
  if (trainer) trainer.stalled = 0;
  setPhase("learn");
}

// ---------- a rookie that arrived in a link ----------

function openVisit(): boolean {
  const shared = readShare(location.hash);
  if (!shared) return false;
  useTrack(shared.track);
  visiting = true;
  trainer = null;
  rookie = makeRookieFor(shared.track, shared.genome, shared.generations, shared.bestLap);
  const gens = `${shared.generations} generation${shared.generations === 1 ? "" : "s"}`;
  $("visit-text").textContent = `Someone drew this track and trained a rookie on it for ${gens}. Its best lap is ${seconds(rookie.bestLap)}. Can you beat it?`;
  setPhase("visit");
  return true;
}

function makeRookieFor(t: Track, genome: Float32Array, generations: number, lap: number): NonNullable<typeof rookie> {
  track = t;
  return makeRookie(genome, generations, lap);
}

// ---------- drawing a frame ----------

function minimap(): void {
  if (!race || !track) return;
  const c = el.minimap;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const size = c.clientWidth;
  if (c.width !== Math.round(size * dpr)) c.width = c.height = Math.round(size * dpr);
  const ctx = c.getContext("2d")!;
  const k = ((size - 12) / Math.max(track.w, track.h)) * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.setTransform(k, 0, 0, k, (c.width - track.w * k) / 2, (c.height - track.h * k) / 2);
  ctx.beginPath();
  for (let i = 0; i < track.n; i += 3) {
    if (i === 0) ctx.moveTo(track.x[0], track.y[0]);
    else ctx.lineTo(track.x[i], track.y[i]);
  }
  ctx.closePath();
  ctx.strokeStyle = "rgba(248,245,238,0.9)";
  ctx.lineWidth = 9 / k;
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.6 / (k / dpr);
  ctx.stroke();
  for (const [r, colour] of [[race.rookie, ACCENT], [race.player, YOU]] as const) {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(r.driver.car.x, r.driver.car.y, (4.5 * dpr) / k, 0, Math.PI * 2);
    ctx.fill();
  }
}

function render(): void {
  const racing = phase === "race" && race;
  if (racing) {
    const target = raceCamera();
    const t = Math.min(1, raceClock / 1.6);
    const ease = t * t * (3 - 2 * t);
    stage.cam = camFrom && t < 1 ? blend(camFrom, target, ease) : target;
  } else stage.cam = stage.fit(slot);

  stage.begin(racing ? slot : undefined);

  if (phase === "draw") {
    // The ghost finger: one slow loop round the words, then it waits a while.
    const t = now - ghostAt;
    if (!drawing && stroke.length === 0 && t > 0 && ghostPath.length) {
      const DRAW = 2.6;
      const HOLD = 1.1;
      const cycle = t % (DRAW + HOLD + 3.4);
      if (cycle < DRAW + HOLD || calm) {
        const f = calm ? 1 : Math.min(1, cycle / DRAW);
        const e = f * f * (3 - 2 * f);
        const upTo = Math.max(2, Math.floor(e * ghostPath.length));
        const fade = calm ? 1 : cycle < DRAW ? 1 : 1 - (cycle - DRAW) / HOLD;
        stage.stroke(ghostPath, INK, 0.5 * fade, 2.2, upTo, true);
        const tip = ghostPath[upTo - 1];
        if (!calm) {
          stage.dot(tip.x, tip.y, 13 / stage.cam.zoom, INK, 0.16 * fade);
          stage.dot(tip.x, tip.y, 5 / stage.cam.zoom, INK, 0.5 * fade);
        }
      }
    }
    if (refused) {
      const age = now - refused.at;
      const fade = Math.max(0, 1 - age / 2.6);
      stage.stroke(refused.stroke, INK, 0.35 * fade, 2.4);
      if (refused.fault.kind === "tight" || refused.fault.kind === "pinch") {
        const pulse = (age * 1.3) % 1;
        stage.ring(refused.fault.x, refused.fault.y, 26 + pulse * 30, ACCENT, (1 - pulse) * fade, 2.4);
        stage.ring(refused.fault.x, refused.fault.y, 26, ACCENT, fade, 2);
      }
      if (fade === 0) refused = null;
    }
    if (preview) {
      const f = Math.min(1, (now - preview.at) / 0.55);
      stage.stroke(preview.points, INK, 0.9, 2.6, Math.max(2, Math.floor(f * preview.points.length)));
      if (f >= 1) {
        const pts = preview.points;
        preview = null;
        accept(pts);
      }
    }
    stage.stroke(stroke, INK, 0.92, 2.6);
  }

  if (track && art && phase !== "draw") {
    const reveal = phase === "build" ? Math.min(1, (now - buildAt) / 0.9) : 1;
    stage.dots(art, reveal);
    stage.track(track, art, reveal);
    if (phase === "build") stage.stroke(stroke, INK, 0.9 * (1 - reveal), 2.6);

    for (const w of wrecks) {
      const age = now - w.at;
      if (age < 1.5) stage.car(w.x, w.y, w.heading, INK, 0.5 * (1 - age / 1.5), 1.12, true);
    }

    if (phase === "learn" && trainer && !resting) {
      const lead = trainer.drivers[trainer.leader];
      for (const d of trainer.drivers) if (d.alive && d !== lead) stage.car(d.car.x, d.car.y, d.car.heading, INK, 0.74, 1.12);
      if (lead?.alive) {
        stage.rays(lead.car, lead.act[0], ACCENT);
        stage.car(lead.car.x, lead.car.y, lead.car.heading, ACCENT, 1, 1.2);
      }
    } else if ((phase === "visit" || (phase === "learn" && resting)) && solo) {
      stage.rays(solo.car, solo.act[0], ACCENT);
      stage.car(solo.car.x, solo.car.y, solo.car.heading, ACCENT, 1, 1.2);
    } else if (racing && rookie) {
      stage.path(rookie.line, ACCENT, 0.5);
      const ai = race!.rookie;
      const me = race!.player;
      const blink = (held: number): number => (held > 0 ? 0.55 + 0.3 * Math.sin(now * 22) : 1);
      stage.car(ai.driver.car.x, ai.driver.car.y, ai.driver.car.heading, ACCENT, blink(ai.held), 1.1);
      stage.car(me.driver.car.x, me.driver.car.y, me.driver.car.heading, YOU, blink(me.held), 1.1);
    }

    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      const age = now - c.at;
      if (age > 1.5) {
        confetti.splice(i, 1);
        continue;
      }
      const drag = Math.exp(-age * 2.2);
      const x = c.x + (c.vx * (1 - drag)) / 2.2;
      const y = c.y + (c.vy * (1 - drag)) / 2.2;
      stage.car(x, y, c.angle + c.spin * age, c.colour, 1 - age / 1.5, 0.32);
    }
  }

  stage.end(racing ? slot : undefined);

  if (phase === "learn" && trainer) {
    const lead = resting ? solo : trainer.drivers[trainer.leader];
    drawBrain(el.brain, lead ? lead.genome : trainer.champion, lead ? lead.act : null);
    if (chartDirty || !resting) {
      const live = lead && !resting ? Math.max(0, lead.best) / trainer.track.length : (trainer.history.at(-1)?.best ?? 0);
      drawChart(el.chart, resting ? trainer.history.slice(0, -1) : trainer.history, live, trainer.firstLapGeneration);
      chartDirty = false;
    }
  }
  if (racing) minimap();
}

function frame(ms: number): void {
  const t = ms / 1000;
  const dt = Math.min(0.05, Math.max(0, t - now));
  now = t;
  if (phase === "build" && now - buildAt > 1.25) startLearning();
  else if (phase === "learn") learnFrame(dt);
  else if (phase === "visit") soloFrame(dt);
  else if (phase === "race") raceFrame(dt);
  render();
  requestAnimationFrame(frame);
}

// ---------- input ----------

function pick(points: Pt[]): void {
  if (phase !== "draw" || preview) return;
  sound.unlock();
  stroke = [];
  refused = null;
  el.prompt.classList.add("quiet");
  preview = { points, at: now };
}

function buildPicks(): void {
  const row = $("picks");
  const thumb = (points: Pt[] | null, name: string, go: () => void): void => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pick";
    let inner = `<text x="50" y="60" text-anchor="middle" font-family="Geist, sans-serif" font-size="34" font-weight="500" fill="#15140f">?</text>`;
    if (points) {
      const made = trackFromStroke(points, 900, 900);
      if (made.ok) {
        const t = made.track;
        let d = "";
        for (let i = 0; i < t.n; i += 4) d += `${i ? "L" : "M"}${(t.x[i] / 9).toFixed(1)} ${(t.y[i] / 9).toFixed(1)}`;
        inner = `<path d="${d}Z" fill="none" stroke="#15140f" stroke-width="7.4" stroke-linejoin="round"/><path d="${d}Z" fill="none" stroke="#fdfbf6" stroke-width="5" stroke-linejoin="round"/>`;
      }
    }
    b.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${inner}</svg><span>${name}</span>`;
    b.addEventListener("click", go);
    row.append(b);
  };
  for (const p of PRESETS) thumb(p.stroke(900, 900), p.name, () => pick(p.stroke(stage.paper.w, stage.paper.h)));
  thumb(null, "Surprise me", () => {
    // Keep rolling until the dice give a drawing that makes a track.
    for (let n = 0; n < 20; n++) {
      const points = randomStroke(new Rng(Math.floor(Math.random() * 2 ** 31)), stage.paper.w, stage.paper.h);
      if (trackFromStroke(points, stage.paper.w, stage.paper.h).ok) {
        pick(points);
        return;
      }
    }
  });
}

const canvas = stage.canvas;

canvas.addEventListener("pointerdown", (e) => {
  sound.unlock();
  if (phase === "race") {
    fingers.set(e.pointerId, e.clientX < window.innerWidth / 2 ? -1 : 1);
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (phase !== "draw" || preview || drawing) return;
  const p = stage.toWorld(e.clientX, e.clientY);
  if (p.x < 0 || p.y < 0 || p.x > stage.paper.w || p.y > stage.paper.h) return;
  drawing = true;
  refused = null;
  stroke = [p];
  el.prompt.classList.add("quiet");
  canvas.setPointerCapture(e.pointerId);
  sound.pen();
});

canvas.addEventListener("pointermove", (e) => {
  if (!drawing) return;
  const events = e.getCoalescedEvents?.() ?? [e];
  for (const ev of events.length ? events : [e]) {
    const p = stage.toWorld(ev.clientX, ev.clientY);
    p.x = Math.min(stage.paper.w, Math.max(0, p.x));
    p.y = Math.min(stage.paper.h, Math.max(0, p.y));
    const last = stroke[stroke.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 3) stroke.push(p);
  }
});

function lift(e: PointerEvent): void {
  fingers.delete(e.pointerId);
  if (!drawing) return;
  drawing = false;
  const points = stroke;
  if (points.length < 4) {
    // A tap is not a drawing; say nothing, show the ghost again.
    stroke = [];
    el.prompt.className = "prompt";
    el.prompt.textContent = "Draw a loop";
    ghostAt = now + 0.3;
    return;
  }
  accept(points);
  if (phase === "draw") el.prompt.classList.remove("quiet");
}
canvas.addEventListener("pointerup", lift);
canvas.addEventListener("pointercancel", lift);

// In the race the whole window steers, not only the sheet.
window.addEventListener("pointerdown", (e) => {
  if (phase !== "race" || e.target === canvas || (e.target as HTMLElement).closest("button, a")) return;
  sound.unlock();
  fingers.set(e.pointerId, e.clientX < window.innerWidth / 2 ? -1 : 1);
});
window.addEventListener("pointerup", (e) => fingers.delete(e.pointerId));
window.addEventListener("pointercancel", (e) => fingers.delete(e.pointerId));

function key(e: KeyboardEvent, down: boolean): void {
  if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = down;
  else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = down;
  else if (e.key === "ArrowUp" || e.key === " " || e.key === "w" || e.key === "W") keys.push = down;
  else return;
  if (phase === "race" && el.result.hidden) e.preventDefault();
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el.how.hidden) closeHow();
  else if ((e.key === "m" || e.key === "M") && !e.repeat) toggleMute();
  else key(e, true);
});
window.addEventListener("keyup", (e) => key(e, false));
window.addEventListener("blur", () => {
  keys.left = keys.right = keys.push = false;
  fingers.clear();
});

for (const b of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
  b.addEventListener("click", () => setSpeed(Number(b.dataset.speed), true));
}
el.race.addEventListener("click", startRace);
$("redraw").addEventListener("click", toDraw);
$("home").addEventListener("click", toDraw);
$("new-track").addEventListener("click", toDraw);
$("again").addEventListener("click", startRace);
$("train-more").addEventListener("click", backToTraining);
$("race-quit").addEventListener("click", backToTraining);
$("share").addEventListener("click", (e) => void share(e.currentTarget as HTMLButtonElement));
$("save-card").addEventListener("click", saveCard);
$("visit-race").addEventListener("click", startRace);
$("visit-train").addEventListener("click", () => {
  history.replaceState(null, "", location.pathname + location.search);
  stage.clearMarks();
  startLearning();
});
$("visit-draw").addEventListener("click", toDraw);

let howFrom: HTMLElement | null = null;
function closeHow(): void {
  el.how.hidden = true;
  howFrom?.focus({ preventScroll: true });
}
for (const b of document.querySelectorAll<HTMLButtonElement>("[data-how]")) {
  b.addEventListener("click", () => {
    howFrom = b;
    el.how.hidden = false;
    el.how.querySelector<HTMLElement>(".how")?.focus({ preventScroll: true });
  });
}
$("how-close").addEventListener("click", closeHow);
el.how.addEventListener("click", (e) => {
  if (e.target === el.how) closeHow();
});

const mute = $<HTMLButtonElement>("mute");
function toggleMute(): void {
  sound.unlock();
  sound.setMuted(!sound.muted);
  mute.setAttribute("aria-pressed", String(sound.muted));
  mute.setAttribute("aria-label", sound.muted ? "Turn sound on" : "Mute sound");
}
mute.setAttribute("aria-pressed", String(sound.muted));
mute.addEventListener("click", toggleMute);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) sound.hum(0, 0);
});

// ---------- start ----------

window.addEventListener("resize", measure);
new ResizeObserver(measure).observe(el.slot);
howDiagrams(document.querySelector("#how-net"), document.querySelector("#how-breed"));
buildPicks();
measure();
if (!openVisit()) setPhase("draw");
window.addEventListener("hashchange", () => {
  if (openVisit()) el.result.hidden = true;
});
requestAnimationFrame((ms) => {
  now = ms / 1000;
  ghostAt = now + 0.7;
  requestAnimationFrame(frame);
});
