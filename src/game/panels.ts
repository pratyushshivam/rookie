/**
 * The two small pictures beside the track: the chart of how far each
 * generation got, and the leader's network with its neurons and weights
 * lighting up as it drives.
 */
import { LAYERS, TARGET_LAPS, type GenerationRecord } from "../engine";
import { ACCENT, INK } from "./stage";

function prepare(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w < 4 || h < 4) return null;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

const FONT = '500 11px "Geist", system-ui, sans-serif';

/**
 * Best distance per generation as a stepped line, the field's average under
 * it, and a rule at one lap. `live` is the current generation's best so far.
 */
export function drawChart(canvas: HTMLCanvasElement, history: GenerationRecord[], live: number, firstLap: number): void {
  const p = prepare(canvas);
  if (!p) return;
  const { ctx, w, h } = p;
  const top = 6;
  const bottom = h - 15;
  const left = 0.5;
  const right = w - 30;
  const points = [...history.map((r) => r.best), live];
  const peak = Math.max(1.15, ...points);
  const span = Math.min(TARGET_LAPS, peak);
  const y = (laps: number): number => bottom - (Math.min(laps, span) / span) * (bottom - top);
  const slots = Math.max(12, points.length);
  const x = (g: number): number => left + ((g + 0.5) / slots) * (right - left);

  ctx.font = FONT;
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;

  // Base line and the one-lap rule (and three laps, once it is in sight).
  ctx.strokeStyle = "rgba(21,20,15,0.3)";
  ctx.beginPath();
  ctx.moveTo(left, bottom + 0.5);
  ctx.lineTo(right, bottom + 0.5);
  ctx.stroke();
  ctx.fillStyle = "rgba(21,20,15,0.62)";
  for (const laps of span >= 2.4 ? [1, TARGET_LAPS] : [1]) {
    const yy = Math.round(y(laps)) + 0.5;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(right, yy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(laps === 1 ? "1 lap" : `${laps}`, right + 5, yy);
  }

  // Average of the whole field: are they all getting better, or just one?
  if (history.length > 1) {
    ctx.strokeStyle = "rgba(21,20,15,0.32)";
    ctx.beginPath();
    history.forEach((r, g) => (g === 0 ? ctx.moveTo(x(g), y(r.mean)) : ctx.lineTo(x(g), y(r.mean))));
    ctx.stroke();
  }

  // Best of each generation.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.beginPath();
  history.forEach((r, g) => (g === 0 ? ctx.moveTo(x(g), y(r.best)) : ctx.lineTo(x(g), y(r.best))));
  ctx.stroke();
  // The generation on the road right now is not finished: a dotted line up to where it has got.
  if (history.length > 0) {
    ctx.lineWidth = 1.2;
    ctx.setLineDash([1.5, 3]);
    ctx.beginPath();
    ctx.moveTo(x(history.length - 1), y(history[history.length - 1].best));
    ctx.lineTo(x(history.length), y(live));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  points.forEach((v, g) => {
    const now = g === points.length - 1;
    ctx.fillStyle = now || g + 1 === firstLap ? ACCENT : INK;
    ctx.beginPath();
    ctx.arc(x(g), y(v), now ? 3 : g + 1 === firstLap ? 3 : 1.8, 0, Math.PI * 2);
    ctx.fill();
  });

  // Generation numbers along the bottom: first, and the one being driven.
  ctx.fillStyle = "rgba(21,20,15,0.62)";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.fillText("1", x(0), h - 1);
  if (points.length > 2) ctx.fillText(String(points.length), x(points.length - 1), h - 1);
  ctx.textAlign = "left";
}

const INPUT_LABELS = ["left", "", "", "ahead", "", "", "right", "speed"];

/**
 * The network. Lines are weights: thick for strong, orange for negative. A
 * line darkens while a signal is passing along it; a neuron fills as it fires.
 */
export function drawBrain(canvas: HTMLCanvasElement, weights: Float32Array | null, act: Float32Array[] | null): void {
  const p = prepare(canvas);
  if (!p || !weights) return;
  const { ctx, w, h } = p;
  const wide = w > 230;
  const padL = wide ? 48 : 10;
  const padR = wide ? 58 : 44;
  const xs = [padL, w / 2 + (padL - padR) / 2, w - padR];
  const node = (layer: number, i: number): [number, number] => {
    const count = LAYERS[layer];
    const gap = Math.min(26, (h - 14) / count);
    return [xs[layer], h / 2 + (i - (count - 1) / 2) * gap];
  };
  const radius = Math.max(3, Math.min(6.5, h / 34));

  let at = 0;
  for (let l = 1; l < LAYERS.length; l++) {
    for (let j = 0; j < LAYERS[l]; j++) {
      const [x1, y1] = node(l, j);
      for (let i = 0; i < LAYERS[l - 1]; i++) {
        const wgt = weights[at++];
        const [x0, y0] = node(l - 1, i);
        const signal = act ? Math.min(1, Math.abs(act[l - 1][i] * wgt)) : 0.3;
        const strength = Math.min(1, Math.abs(wgt) / 2.2);
        ctx.strokeStyle = wgt < 0 ? `rgba(212,73,26,${0.08 + 0.85 * signal})` : `rgba(21,20,15,${0.06 + 0.8 * signal})`;
        ctx.lineWidth = 0.4 + 2.1 * strength;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      at++; // the bias
    }
  }

  ctx.font = FONT;
  ctx.textBaseline = "middle";
  for (let l = 0; l < LAYERS.length; l++) {
    for (let i = 0; i < LAYERS[l]; i++) {
      const [x, y] = node(l, i);
      const v = act ? act[l][i] : 0;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#f8f5ee";
      ctx.fill();
      ctx.fillStyle = v < 0 ? `rgba(212,73,26,${Math.min(1, -v)})` : `rgba(21,20,15,${Math.min(1, v)})`;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.stroke();
      if (wide && l === 0 && INPUT_LABELS[i]) {
        ctx.fillStyle = "rgba(21,20,15,0.62)";
        ctx.textAlign = "right";
        ctx.fillText(INPUT_LABELS[i], x - radius - 6, y);
      }
    }
  }

  // What comes out: a steering needle and a pedal bar.
  const out = act ? act[LAYERS.length - 1] : null;
  const [sx, sy] = node(LAYERS.length - 1, 0);
  const py = node(LAYERS.length - 1, 1)[1];
  const lx = sx + radius + 8;
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(21,20,15,0.62)";
  ctx.fillText("steer", lx, sy - 9);
  ctx.fillText("pedal", lx, py - 9);
  const bar = Math.min(34, w - lx - 4);
  for (const [yy, v] of [[sy + 5, out ? out[0] : 0], [py + 5, out ? out[1] : 0]] as const) {
    ctx.strokeStyle = "rgba(21,20,15,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lx, yy + 0.5);
    ctx.lineTo(lx + bar, yy + 0.5);
    ctx.stroke();
    ctx.fillStyle = ACCENT;
    ctx.fillRect(lx + bar / 2 + (v * bar) / 2 - 1.5, yy - 4, 3, 9);
    ctx.fillStyle = "rgba(21,20,15,0.3)";
    ctx.fillRect(lx + bar / 2 - 0.5, yy - 2, 1, 5);
  }
}

/** The two diagrams in "How it learns" that are easier to compute than to write out. */
export function howDiagrams(net: SVGElement | null, breedSvg: SVGElement | null): void {
  if (net) {
    const xs = [34, 110, 186];
    const pos = (l: number, i: number): [number, number] => [xs[l], 65 + (i - (LAYERS[l] - 1) / 2) * (l === 0 ? 14.5 : 18)];
    let s = "";
    let seed = 7;
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let l = 1; l < LAYERS.length; l++) {
      for (let j = 0; j < LAYERS[l]; j++) {
        for (let i = 0; i < LAYERS[l - 1]; i++) {
          const v = rand();
          const [x0, y0] = pos(l - 1, i);
          const [x1, y1] = pos(l, j);
          s += `<path d="M${x0} ${y0}L${x1} ${y1}" stroke="${v < 0 ? "#d4491a" : "#15140f"}" stroke-width="${(0.3 + Math.abs(v) * 1.5).toFixed(2)}" opacity="${(0.25 + Math.abs(v) * 0.6).toFixed(2)}"/>`;
        }
      }
    }
    for (let l = 0; l < LAYERS.length; l++) {
      for (let i = 0; i < LAYERS[l]; i++) {
        const [x, y] = pos(l, i);
        s += `<circle cx="${x}" cy="${y}" r="4.6" fill="#f8f5ee" stroke="#15140f" stroke-width="1.1"/>`;
      }
    }
    s += `<g font-family="Geist, sans-serif" font-size="9" fill="rgba(21,20,15,0.62)"><text x="34" y="127" text-anchor="middle">8 in</text><text x="110" y="127" text-anchor="middle">6 hidden</text><text x="186" y="127" text-anchor="middle">2 out</text></g>`;
    net.innerHTML = s;
  }
  if (breedSvg) {
    let s = "";
    const col = (i: number): number => 14 + (i % 25) * 8;
    // Top: this generation, ranked. Bottom: the next.
    for (let i = 0; i < 50; i++) {
      const y = 22 + Math.floor(i / 25) * 9;
      s += `<rect x="${col(i) - 3}" y="${y - 3}" width="6" height="6" rx="1.5" fill="${i < 4 ? "#d4491a" : "#15140f"}" opacity="${i < 4 ? 1 : Math.max(0.12, 0.8 - i * 0.02).toFixed(2)}"/>`;
    }
    for (let i = 0; i < 50; i++) {
      const y = 96 + Math.floor(i / 25) * 9;
      s += `<rect x="${col(i) - 3}" y="${y - 3}" width="6" height="6" rx="1.5" fill="${i < 4 ? "#d4491a" : "none"}" stroke="${i < 4 ? "none" : "#15140f"}" stroke-width="1"/>`;
    }
    // The four that go straight through, and two parents making one child.
    for (let i = 0; i < 4; i++) s += `<path d="M${col(i)} 27V91" stroke="#d4491a" stroke-width="1"/>`;
    s += `<path d="M${col(7)} 27C${col(7)} 60 ${col(14)} 56 ${col(14)} 91M${col(19)} 27C${col(19)} 60 ${col(14)} 56 ${col(14)} 91" fill="none" stroke="#15140f" stroke-width="1"/>`;
    s += `<g font-family="Geist, sans-serif" font-size="9" fill="rgba(21,20,15,0.62)"><text x="11" y="10">ranked by distance</text><text x="11" y="124">next generation</text><text x="${col(15) + 2}" y="66">mix two, nudge</text><text x="${col(4) + 1}" y="66" fill="#d4491a">kept</text></g>`;
    breedSvg.innerHTML = s;
  }
}
