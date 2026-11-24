import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { srtFromWordFiles, srtFromWords, srtTime } from "../src/youtube/captions";
import { tmpDir } from "./helpers";

describe("SRT captions", () => {
  it("formats hh:mm:ss,mmm timestamps", () => {
    expect(srtTime(0)).toBe("00:00:00,000");
    expect(srtTime(61.5)).toBe("00:01:01,500");
    expect(srtTime(3723.0456)).toBe("01:02:03,046");
    expect(srtTime(-2)).toBe("00:00:00,000");
  });

  it("groups words into numbered cues of at most N words", () => {
    const words = Array.from({ length: 8 }, (_, i) => ({ word: `w${i}`, start: i * 0.5, end: i * 0.5 + 0.4 }));
    const srt = srtFromWords(words, 6);
    expect(srt).toBe(["1", "00:00:00,000 --> 00:00:02,900", "w0 w1 w2 w3 w4 w5", "", "2", "00:00:03,000 --> 00:00:03,900", "w6 w7", ""].join("\n"));
  });

  it("closes a cue at the end of a sentence", () => {
    const srt = srtFromWords([
      { word: "Saturn", start: 0, end: 0.4 },
      { word: "floats.", start: 0.4, end: 0.9 },
      { word: "But", start: 1, end: 1.2 },
      { word: "why?", start: 1.2, end: 1.6 },
    ]);
    expect(srt.split("\n\n").length).toBe(2);
    expect(srt).toContain("Saturn floats.");
    expect(srt).toContain("2\n00:00:01,000 --> 00:00:01,600\nBut why?");
  });

  it("returns an empty string for no words", () => {
    expect(srtFromWords([])).toBe("");
  });

  it("offsets word files by clip start plus the narration delay and skips missing files", () => {
    const dir = tmpDir("srt");
    fs.writeFileSync(path.join(dir, "words-shot-1.json"), JSON.stringify([{ word: "One", start: 0.1, end: 0.5 }]));
    fs.writeFileSync(path.join(dir, "words-shot-3.json"), JSON.stringify([{ word: "Three", start: 0, end: 0.5 }]));
    const srt = srtFromWordFiles(dir, ["shot-1", "shot-2", "shot-3"], [8, 6, 8], 0.25);
    expect(srt).toContain("00:00:00,350 --> 00:00:00,750\nOne");
    // shot-3 starts at 8 + 6 = 14 s, plus the 0.25 s delay
    expect(srt).toContain("00:00:14,250 --> 00:00:14,750\nThree");
  });
});
