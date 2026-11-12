/** localStorage that never throws (private windows, blocked storage). */

const PREFIX = "rookie.";

export function load(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* the page works without it */
  }
}

/** A short name for a track, made from its control points, to file best laps under. */
export function trackKey(ctrl: Int16Array): string {
  let h = 2166136261;
  for (let i = 0; i < ctrl.length; i++) {
    h ^= ctrl[i] & 0xffff;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** The visitor's best lap on a track, in seconds, or 0. Only the latest forty tracks are kept. */
export function bestLap(key: string): number {
  const all = readLaps();
  return all[key] ?? 0;
}

export function saveBestLap(key: string, seconds: number): void {
  const all = readLaps();
  delete all[key];
  all[key] = Math.round(seconds * 1000) / 1000;
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - 40))) delete all[old];
  save("laps", JSON.stringify(all));
}

function readLaps(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(load("laps") ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "number" && v > 0 && Number.isFinite(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}
