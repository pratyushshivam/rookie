import { describe, expect, it } from "vitest";
import { PRESETS, Rng, randomGenome, trackFromStroke } from "../src/engine";
import { readShare, seconds, shareText, shareUrl, verdict } from "../src/game/share";
import { SQUARE } from "./fixtures";

describe("result in words", () => {
  const base = { yourBest: 9.1, rookieBest: 8.4, generations: 12 };

  it("says who won and by how much", () => {
    expect(verdict({ ...base, you: 27.2, rookie: 28 }).won).toBe(true);
    expect(verdict({ ...base, you: 27.2, rookie: 28 }).sub).toContain("0.80 s");
    expect(verdict({ ...base, you: 29, rookie: 28 }).won).toBe(false);
    // Whoever did not finish has lost.
    expect(verdict({ ...base, you: 0, rookie: 28 }).won).toBe(false);
    expect(verdict({ ...base, you: 30, rookie: 0 }).won).toBe(true);
  });

  it("writes a share text with the generations, the lap and the link", () => {
    const text = shareText({ ...base, you: 29, rookie: 28 }, "https://example.org/#r=abc");
    expect(text).toContain("12 generations");
    expect(text).toContain("beat me by 1.00 s");
    expect(text).toContain("8.40 s");
    expect(text.endsWith("https://example.org/#r=abc")).toBe(true);
    expect(shareText({ ...base, generations: 1, you: 27, rookie: 28 }, "x")).toContain("1 generation,");
    expect(seconds(0)).toBe("–");
  });

  it("puts the track and driver after the # and reads them back", () => {
    const made = trackFromStroke(PRESETS[0].stroke(SQUARE.w, SQUARE.h), SQUARE.w, SQUARE.h);
    if (!made.ok) throw new Error("preset refused");
    const genome = randomGenome(new Rng(5));
    const url = shareUrl("https://example.org/rookie/#old", { track: made.track, genome, generations: 9, bestLap: 8.5 });
    expect(url.startsWith("https://example.org/rookie/#r=")).toBe(true);
    const back = readShare(new URL(url).hash)!;
    expect(Array.from(back.genome)).toEqual(Array.from(genome));
    expect(back.generations).toBe(9);
    expect(readShare("#r=nonsense")).toBeNull();
    expect(readShare("")).toBeNull();
  });
});
