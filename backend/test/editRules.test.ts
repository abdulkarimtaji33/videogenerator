import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import * as R from "../src/edit/rules";
import { STYLES, styleForNiche } from "../src/edit/styles";
import { pickMusic, pickSfx, sfxFile } from "../src/edit/audioLib";
import { buildAss, captionY } from "../src/shorts/captions";

describe("edit rules (research numbers)", () => {
  it("holds the research constants", () => {
    expect(R.CAPTION_BOTTOM_MAX_Y).toBe(1248);
    expect(R.MAX_CPS).toBe(20);
    expect([...R.PUNCH_LEVELS]).toEqual([1, 1.12, 1, 1.2]);
    expect(R.PUNCH_MAX).toBe(1.2);
    expect(R.LUFS_TARGET).toBe(-14);
    expect(R.TRUE_PEAK_DB).toBe(-1);
    expect(R.MAX_TRANSITION_KINDS).toBe(3);
    expect(R.STATIC_MAX_S).toBe(8);
    expect(R.SFX_MIN_GAP_S).toBe(3);
    expect(R.SFX_OFFSET_FRAMES).toBe(1);
    expect(R.VIGNETTE_PCT).toBe(0.12);
    expect(R.textHold(4)).toBeCloseTo(1.7);
  });
  it("styles map niches and keep texture subtle", () => {
    expect(styleForNiche("space_science_curiosity").id).toBe("space");
    expect(styleForNiche("unknown thing").id).toBe("default");
    for (const s of Object.values(STYLES)) {
      expect(s.grain).toBeLessThanOrEqual(R.GRAIN_MAX);
      expect(s.vignette).toBeLessThanOrEqual(0.25);
    }
  });
});

describe("captions on 9:16", () => {
  it("pins the bottom edge at y 1248 whatever the margin", () => {
    expect(captionY({ width: 1080, height: 1920, marginBottom: 600 })).toBe(1248);
    expect(captionY({ width: 1080, height: 1920, marginBottom: 672 })).toBe(1248);
    expect(captionY({ width: 1080, height: 1920, marginBottom: 900 })).toBe(1020);
    expect(captionY({ width: 1920, height: 1080, marginBottom: 110 })).toBe(970);
  });
  it("colours exactly one keyword per group in the accent, without bounce", () => {
    const w = ["Saturn", "weighs", "ninety", "times"].map((word, i) => ({ word, start: i * 0.4, end: i * 0.4 + 0.35 }));
    const ass = buildAss(w, { wordsPerChunk: 4, fontSize: 92, marginBottom: 672, keywords: new Set(["ninety"]), accent: "&H0000FF00&" });
    const lines = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(lines.join("").match(/&H0000FF00&/g)?.length).toBe(1);
    for (const l of lines) {
      expect(l).not.toContain("\\t(");
      expect(l).not.toContain("fscx");
    }
  });
});

describe("audio library", () => {
  it("returns null for empty or missing folders and rotates takes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "audio-"));
    expect(pickMusic("calm", 0, root)).toBeNull();
    expect(pickSfx("whoosh", undefined, root)).toBeNull();
    expect(sfxFile("pop", 1, root)).toBeNull();
    fs.mkdirSync(path.join(root, "sfx", "whoosh"), { recursive: true });
    for (const n of [1, 2, 3]) fs.writeFileSync(path.join(root, "sfx", "whoosh", `w${n}.wav`), "x");
    const a = pickSfx("whoosh", undefined, root)!;
    const b = pickSfx("whoosh", a.take, root)!;
    expect(b.take).not.toBe(a.take);
    expect(sfxFile("whoosh", 4, root)).toContain("w2.wav");
  });
  it("finds the bundled pack", () => {
    expect(pickMusic("wonder", 0)?.file).toMatch(/wonder/);
    expect(pickSfx("impact")?.file).toMatch(/impact/);
  });
});
