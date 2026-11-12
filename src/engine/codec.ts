/**
 * A track and a trained driver, packed into text short enough for a link.
 *
 *   byte 0        format version
 *   2 + 2         paper width and height
 *   2             generations trained
 *   2             best lap, hundredths of a second
 *   1             number of control points
 *   2 + 2         first control point
 *   2 each        the others, as steps from the one before (-128 .. 127)
 *   4 each        the network's weights, 32-bit floats, bit for bit
 */
import { GENOME_SIZE } from "./evolve";
import { buildTrack, findFault, type Track } from "./track";

const VERSION = 1;
const HEAD = 10;

export interface Shared {
  track: Track;
  genome: Float32Array;
  generations: number;
  /** Seconds, to a hundredth; 0 if unknown. */
  bestLap: number;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) out += ALPHABET[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) out += ALPHABET[c & 63];
  }
  return out;
}

function fromBase64Url(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let n = 0;
  for (let i = 0; i < text.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < text.length ? ALPHABET.indexOf(text[i + k]) : 0));
    if (v.some((x) => x < 0)) return null;
    const word = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    if (n < bytes.length) bytes[n++] = word >> 16;
    if (n < bytes.length) bytes[n++] = (word >> 8) & 255;
    if (n < bytes.length) bytes[n++] = word & 255;
  }
  return bytes;
}

export function encodeShare(s: Shared): string {
  const ctrl = s.track.ctrl;
  const count = ctrl.length >> 1;
  const bytes = new Uint8Array(HEAD + 4 + (count - 1) * 2 + GENOME_SIZE * 4);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, VERSION);
  view.setUint16(1, s.track.w, true);
  view.setUint16(3, s.track.h, true);
  view.setUint16(5, Math.min(65535, s.generations), true);
  view.setUint16(7, Math.min(65535, Math.round(s.bestLap * 100)), true);
  view.setUint8(9, count);
  let at = HEAD;
  view.setInt16(at, ctrl[0], true);
  view.setInt16(at + 2, ctrl[1], true);
  at += 4;
  for (let i = 1; i < count; i++) {
    const dx = ctrl[2 * i] - ctrl[2 * i - 2];
    const dy = ctrl[2 * i + 1] - ctrl[2 * i - 1];
    if (dx < -128 || dx > 127 || dy < -128 || dy > 127) throw new Error("control points too far apart to pack");
    view.setInt8(at++, dx);
    view.setInt8(at++, dy);
  }
  for (let i = 0; i < GENOME_SIZE; i++, at += 4) view.setFloat32(at, s.genome[i], true);
  return toBase64Url(bytes);
}

/** Null for anything that is not a complete, drivable track with a driver. */
export function decodeShare(text: string): Shared | null {
  const bytes = fromBase64Url(text);
  if (!bytes || bytes.length < HEAD + 4) return null;
  const view = new DataView(bytes.buffer);
  if (view.getUint8(0) !== VERSION) return null;
  const w = view.getUint16(1, true);
  const h = view.getUint16(3, true);
  const count = view.getUint8(9);
  if (count < 8 || w < 300 || h < 300 || w > 3000 || h > 3000) return null;
  if (bytes.length !== HEAD + 4 + (count - 1) * 2 + GENOME_SIZE * 4) return null;
  const ctrl = new Int16Array(count * 2);
  let at = HEAD;
  ctrl[0] = view.getInt16(at, true);
  ctrl[1] = view.getInt16(at + 2, true);
  at += 4;
  for (let i = 1; i < count; i++) {
    ctrl[2 * i] = ctrl[2 * i - 2] + view.getInt8(at++);
    ctrl[2 * i + 1] = ctrl[2 * i - 1] + view.getInt8(at++);
  }
  for (let i = 0; i < count; i++) {
    if (ctrl[2 * i] < 0 || ctrl[2 * i] > w || ctrl[2 * i + 1] < 0 || ctrl[2 * i + 1] > h) return null;
  }
  const genome = new Float32Array(GENOME_SIZE);
  for (let i = 0; i < GENOME_SIZE; i++, at += 4) {
    genome[i] = view.getFloat32(at, true);
    if (!Number.isFinite(genome[i])) return null;
  }
  const track = buildTrack(ctrl, w, h);
  if (findFault(track)) return null;
  return { track, genome, generations: view.getUint16(5, true), bestLap: view.getUint16(7, true) / 100 };
}
