import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { parsePlan } from "../src/shorts/plan";
import { lintPlanPrompts } from "../src/shorts/promptLint";
import { alignScript } from "../src/shorts/tts";
import { buildAss, chunkWords } from "../src/shorts/captions";
import { rankNiches } from "../src/niche/scorer";

const raw = () => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "sample-plan.json"), "utf-8"));

describe("Short plan schema", () => {
  it("accepts the sample plan and fills defaults", () => {
    const p = parsePlan(raw());
    expect(p.aspect).toBe("9:16");
    expect(p.narration.mode).toBe("tts");
    expect(p.narration.voice).toBe("onyx");
    expect(p.captions.enabled).toBe(true);
    expect(p.clips[0].trimStart).toBe(0);
  });

  it("rejects bad ids, too few clips and missing hook", () => {
    expect(() => parsePlan({ ...raw(), id: "Bad ID" })).toThrow(/id/);
    expect(() => parsePlan({ ...raw(), clips: [raw().clips[0]] })).toThrow(/clips/);
    const r = raw();
    delete r.hook;
    expect(() => parsePlan(r)).toThrow(/hook/);
  });
});

describe("Veo prompt linter", () => {
  const errorsFor = (mutate: (r: any) => void) => {
    const r = raw();
    mutate(r);
    return lintPlanPrompts(parsePlan(r)).flatMap((x) => x.issues).filter((i) => i.level === "error").map((i) => i.id);
  };

  it("passes the sample plan with no errors", () => {
    expect(errorsFor(() => {})).toEqual([]);
  });
  it("rejects quotation marks", () => {
    expect(errorsFor((r) => (r.clips[0].prompt += ' A sign reads "float".'))).toContain("quotes");
  });
  it("rejects on-screen text mentions", () => {
    expect(errorsFor((r) => (r.clips[1].prompt += " A caption appears at the bottom."))).toContain("onscreen_text");
  });
  it("requires the style bible in every prompt", () => {
    expect(errorsFor((r) => (r.clips[1].prompt = r.clips[1].prompt.replace(r.styleBible, "A nice look.")))).toContain("style_bible");
  });
  it("requires 'no speech' when a separate narrator is used", () => {
    expect(errorsFor((r) => (r.clips[0].prompt = r.clips[0].prompt.replace("no speech, ", "")))).toContain("stray_speech");
  });
  it("requires the first clip to open on the hook visual", () => {
    expect(
      errorsFor((r) => (r.clips[0].prompt = r.styleBible + " A red desert canyon at noon with dust blowing past tall stone arches. Static shot. Audio: wind, no speech. No text, no logos."))
    ).toContain("hook_visual");
  });
});

describe("captions", () => {
  it("aligns script words to timings when counts differ and keeps script spelling", () => {
    const heard = [
      { word: "saturn", start: 0.2, end: 0.6 },
      { word: "is", start: 0.6, end: 0.8 },
      { word: "lighter", start: 0.8, end: 1.2 },
    ];
    const out = alignScript("Saturn is lighter than water.", heard);
    expect(out.map((w) => w.word)).toEqual(["Saturn", "is", "lighter", "than", "water."]);
    expect(out[0].start).toBeCloseTo(0.2, 1);
    expect(out[4].end).toBeCloseTo(1.2, 1);
    for (let i = 1; i < out.length; i++) expect(out[i].start).toBeGreaterThanOrEqual(out[i - 1].start);
  });

  it("chunks words at sentence ends and builds a valid ASS file", () => {
    const words = ["Saturn", "is", "lighter", "than", "water."].map((w, i) => ({ word: w, start: i * 0.4, end: i * 0.4 + 0.35 }));
    const chunks = chunkWords(words, 3);
    expect(chunks.map((c) => c.length)).toEqual([3, 2]);
    const ass = buildAss(words, { wordsPerChunk: 3, fontSize: 92, marginBottom: 600 });
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("Dialogue: 0,");
    expect(ass).toContain("SATURN");
    // One caption per chunk (the spoken word changes colour inside it), each pinned to the same position.
    const lines = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(l).toContain("\\an2\\pos(540,1248)");
  });
});

describe("niche scorer", () => {
  it("ranks space and science curiosity first", () => {
    const r = rankNiches();
    expect(r[0].id).toBe("space_science_curiosity");
    expect(r[0].total).toBeGreaterThan(r[1].total);
  });
});
