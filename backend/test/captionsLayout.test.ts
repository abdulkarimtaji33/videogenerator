import { describe, expect, it } from "vitest";
import { buildAss, chunkWords, fitFontSize, maxCharsPerLine } from "../src/shorts/captions";

const toSec = (t: string) => {
  const [h, m, s] = t.split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
};
const events = (ass: string) =>
  ass
    .split("\n")
    .filter((l) => l.startsWith("Dialogue:"))
    .map((l) => {
      const p = l.split(",");
      return { a: toSec(p[1]), b: toSec(p[2]), text: p.slice(9).join(",").replace(/\{[^}]*\}/g, "") };
    })
    .sort((x, y) => x.a - y.a);

// Words as Whisper really returns them: a long word run, two words starting at the same instant, and a chunk that is too wide.
const words = [
  ["Ninety-five", 0.1, 0.6], ["times", 0.62, 0.9], ["Earth's", 0.95, 1.3], ["mass,", 1.32, 1.7],
  ["but", 1.75, 1.9], ["Saturn", 1.9, 2.3], ["still", 2.3, 2.4], ["floats.", 2.4, 3.0],
  ["Solar", 3.4, 3.6], ["system's", 3.62, 4.0], ["lightest", 4.02, 4.4], ["giant.", 4.42, 4.9],
].map(([word, start, end]) => ({ word: word as string, start: start as number, end: end as number }));

describe("caption layout (no jumping, no wrapping)", () => {
  for (const style of ["classic", "pop", "karaoke", "slam"] as const) {
    it(`${style}: no two captions are on screen at once, so none can stack and jump`, () => {
      const ev = events(buildAss(words, { wordsPerChunk: 3, fontSize: 92, marginBottom: 600, style }));
      expect(ev.length).toBeGreaterThan(0);
      for (let i = 1; i < ev.length; i++) expect(ev[i].a, `${ev[i - 1].text} vs ${ev[i].text}`).toBeGreaterThanOrEqual(ev[i - 1].b - 0.001);
    });
  }

  for (const style of ["classic", "pop", "karaoke", "slam"] as const) {
    it(`${style}: every caption is pinned to the same position, so it can never move up or down`, () => {
      const ass = buildAss(words, { wordsPerChunk: 3, fontSize: 92, marginBottom: 600, style });
      const lines = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(l).toContain("\\an2\\pos(540,1248)");
    });
  }

  it("never puts more characters on one line than fit between the margins", () => {
    const max = maxCharsPerLine(1080, 92);
    for (const chunk of chunkWords(words, 3, max)) {
      const chars = chunk.reduce((n, w) => n + w.word.length, 0) + chunk.length - 1;
      expect(chars <= max || chunk.length === 1).toBe(true);
    }
  });

  it("shrinks a tight chunk a little but never below 85% of the configured size", () => {
    expect(fitFontSize(1080, 92, 8)).toBe(92);
    expect(fitFontSize(1080, 92, 14)).toBeLessThan(92);
    expect(fitFontSize(1080, 92, 14)).toBeGreaterThanOrEqual(Math.round(92 * 0.85));
    expect(fitFontSize(1080, 92, 40)).toBe(Math.round(92 * 0.85));
  });
});
