/** What gets shared: a line of text, a link that carries the track and the driver, and a picture. */
import { encodeShare, decodeShare, type Shared, type Track } from "../engine";
import { ACCENT, INK, PAPER, ROAD, SHEET, YOU, type TrackArt } from "./stage";

export interface Outcome {
  /** Total race time for each, 0 if they did not finish. */
  you: number;
  rookie: number;
  yourBest: number;
  rookieBest: number;
  generations: number;
}

export function seconds(t: number, digits = 2): string {
  return t > 0 ? `${t.toFixed(digits)} s` : "–";
}

/** Who won and by how much, in a few words. */
export function verdict(o: Outcome): { won: boolean; head: string; sub: string } {
  const margin = Math.abs(o.you - o.rookie);
  if (o.you > 0 && (o.rookie === 0 || o.you < o.rookie)) {
    return {
      won: true,
      head: "You won",
      sub: o.rookie > 0 ? `by ${seconds(margin)}. It learned from nothing, though.` : "Your rookie never made it home.",
    };
  }
  return {
    won: false,
    head: "Your rookie won",
    sub: o.you > 0 ? `by ${seconds(margin)}. You taught it too well.` : "It was home before you finished.",
  };
}

export function shareText(o: Outcome, url: string): string {
  const gens = `${o.generations} generation${o.generations === 1 ? "" : "s"}`;
  const v = verdict(o);
  const line = v.won
    ? `I drew a race track, an AI learned to drive it in ${gens}, and I still beat it by ${seconds(Math.abs(o.you - o.rookie))}.`
    : `I drew a race track, an AI learned to drive it in ${gens}, and then it beat me${o.you > 0 ? ` by ${seconds(Math.abs(o.you - o.rookie))}` : ""}.`;
  return `${line}\nIts best lap: ${seconds(o.rookieBest)}. Race it on my track:\n${url}`;
}

/** The link for a track and its driver. Everything is after the #, which browsers never send to a server. */
export function shareUrl(base: string, s: Shared): string {
  return `${base.split("#")[0]}#r=${encodeShare(s)}`;
}

export function readShare(hash: string): Shared | null {
  const m = /[#&]r=([A-Za-z0-9_-]+)/.exec(hash);
  return m ? decodeShare(m[1]) : null;
}

/** The picture: the track with the marks worn into it, and the result in words. 1200 x 630. */
export function drawCard(
  track: Track,
  art: TrackArt,
  marks: HTMLCanvasElement | null,
  line: number[],
  o: Outcome | null,
  generations: number,
  bestLap: number,
): HTMLCanvasElement {
  const W = 1200;
  const H = 630;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // The sheet with the track, on the right.
  const box = { x: 560, y: 48, w: 592, h: 534 };
  const turned = track.h > track.w * 1.1;
  const pw = turned ? track.h : track.w;
  const ph = turned ? track.w : track.h;
  const k = Math.min(box.w / pw, box.h / ph);
  ctx.save();
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  if (turned) ctx.rotate(-Math.PI / 2);
  ctx.scale(k, k);
  ctx.translate(-track.w / 2, -track.h / 2);
  ctx.fillStyle = SHEET;
  ctx.fillRect(0, 0, track.w, track.h);
  ctx.fillStyle = ROAD;
  ctx.fill(art.road, "evenodd");
  if (marks) ctx.drawImage(marks, 0, 0, track.w, track.h);
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 3.4;
  ctx.setLineDash([7, 7]);
  ctx.stroke(art.kerbs);
  ctx.setLineDash([]);
  ctx.fillStyle = INK;
  ctx.fill(art.line);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5 / k;
  ctx.lineJoin = "round";
  ctx.stroke(art.left);
  ctx.stroke(art.right);
  if (line.length > 4) {
    ctx.beginPath();
    for (let i = 0; i < line.length; i += 2) {
      if (i === 0) ctx.moveTo(line[0], line[1]);
      else ctx.lineTo(line[i], line[i + 1]);
    }
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2 / k;
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(21,20,15,0.3)";
  ctx.lineWidth = 1 / k;
  ctx.strokeRect(0, 0, track.w, track.h);
  ctx.restore();

  // Words, on the left.
  const font = (weight: number, size: number): string => `${weight} ${size}px "Geist", system-ui, sans-serif`;
  const x = 64;
  ctx.fillStyle = INK;
  ctx.textBaseline = "alphabetic";
  ctx.font = font(600, 34);
  ctx.letterSpacing = "-1px";
  ctx.fillText("Rookie", x, 92);
  const mark = ctx.measureText("Rookie").width;
  ctx.fillStyle = ACCENT;
  ctx.beginPath();
  ctx.arc(x + mark + 7, 88, 3.6, 0, Math.PI * 2);
  ctx.fill();

  const v = o ? verdict(o) : null;
  const head = v ? (v.won ? ["I beat", "my rookie"] : ["My rookie", "beat me"]) : ["Meet", "my rookie"];
  ctx.fillStyle = INK;
  ctx.font = font(600, 84);
  ctx.letterSpacing = "-4.5px";
  ctx.fillText(head[0], x - 4, 232);
  ctx.fillText(head[1], x - 4, 316);
  ctx.letterSpacing = "0px";

  ctx.font = font(400, 23);
  ctx.fillStyle = "rgba(21,20,15,0.62)";
  const gens = `${generations} generation${generations === 1 ? "" : "s"}`;
  ctx.fillText(`A track I drew. An AI that learned to drive`, x, 366);
  ctx.fillText(`it from nothing, in ${gens}.`, x, 396);

  const rows: [string, string, string][] = o
    ? [
        ["You", seconds(o.you), YOU],
        ["Rookie", seconds(o.rookie), ACCENT],
        ["Its best lap", seconds(o.rookieBest), ""],
      ]
    : [
        ["Trained for", gens, ""],
        ["Its best lap", seconds(bestLap), ACCENT],
      ];
  let y = 456;
  ctx.font = font(500, 23);
  for (const [name, value, colour] of rows) {
    ctx.strokeStyle = "rgba(21,20,15,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - 30.5);
    ctx.lineTo(500, y - 30.5);
    ctx.stroke();
    let tx = x;
    if (colour) {
      ctx.fillStyle = colour;
      ctx.fillRect(x, y - 15, 13, 13);
      tx += 24;
    }
    ctx.fillStyle = "rgba(21,20,15,0.62)";
    ctx.textAlign = "left";
    ctx.fillText(name, tx, y);
    ctx.fillStyle = INK;
    ctx.textAlign = "right";
    ctx.fillText(value, 500, y);
    ctx.textAlign = "left";
    y += 46;
  }
  ctx.font = font(400, 18);
  ctx.fillStyle = "rgba(21,20,15,0.62)";
  ctx.fillText("pratyushshivam.github.io/rookie", x, 590);
  return canvas;
}
