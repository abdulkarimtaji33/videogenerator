import { describe, expect, it } from "vitest";
import { sfxGapViolations, sfxEvents, computeTimeline } from "../src/edit/filters";
import { pickKeywordWords } from "../src/edit/director";
import { makeShort, words } from "./editFixture";

describe("director", () => {
  const plan = makeShort();
  it("the hook has no transition and a 1.0 -> 1.12 punch", () => {
    expect(plan.beats[0].role).toBe("hook");
    expect(plan.beats[0].transitionIn).toBe("cut");
    expect(plan.beats[0].punch).toBe(1.12);
  });
  it("uses at most 3 transition kinds, none into the payoff", () => {
    expect(plan.transitionKinds.length).toBeLessThanOrEqual(3);
    expect(plan.transitionKinds.length).toBeGreaterThan(0);
    expect(plan.beats.find((b) => b.role === "payoff")!.transitionIn).toBe("cut");
  });
  it("never repeats a punch level and never exceeds 1.2", () => {
    plan.beats.forEach((b, i) => {
      expect(b.punch).toBeLessThanOrEqual(1.2);
      if (i > 0 && b.punch > 1) expect(b.punch).not.toBe(plan.beats[i - 1].punch);
    });
  });
  it("gives long shots an inner punch", () => {
    for (const b of plan.beats) if (b.end - b.start > 5) expect(b.punch).toBeGreaterThan(1);
  });
  it("keeps sound effects 3 s apart, one riser, an impact one frame after the payoff", () => {
    const ev = sfxEvents(plan);
    expect(sfxGapViolations(ev)).toEqual([]);
    expect(ev.filter((e) => e.kind === "riser").length).toBe(1);
    const imp = ev.filter((e) => e.kind === "impact");
    expect(imp.length).toBe(1);
    const pay = plan.beats.find((b) => b.role === "payoff")!;
    expect(imp[0].at).toBeCloseTo(pay.start + 1 / 30, 2);
    ev.forEach((e) => {
      expect(e.gainDb).toBeGreaterThanOrEqual(3);
      expect(e.gainDb).toBeLessThanOrEqual(6);
    });
  });
  it("timeline shrinks by each transition and matches beat times", () => {
    const tl = computeTimeline(plan.beats.map(() => 8), plan.beats);
    expect(plan.totalSeconds).toBeCloseTo(tl.total);
    expect(plan.totalSeconds).toBeLessThan(8 * plan.beats.length);
    plan.beats.forEach((b, i) => expect(b.start).toBeCloseTo(tl.starts[i]));
  });
  it("J-cuts continuing shots", () => {
    expect(plan.beats.some((b, i) => i > 0 && i % 2 === 0 && b.narrationOffset < 0)).toBe(true);
  });
  it("music mood follows the tone, loop on for a Short, no end card", () => {
    expect(plan.music?.mood).toBe("wonder");
    expect(plan.loop).toBe(true);
    expect(plan.endCard).toBeNull();
    expect(plan.captionBottomY).toBe(1248);
  });
  it("picks one keyword per group, preferring numbers", () => {
    const w = [{ word: "Roughly", start: 0, end: 0.3 }, { word: "95", start: 0.3, end: 0.6 }, { word: "percent.", start: 0.6, end: 1 }];
    expect(pickKeywordWords(w)).toEqual(["95"]);
    expect(pickKeywordWords(words(6)).every((k) => typeof k === "string")).toBe(true);
  });
  it("long form gets chapters, at most 3 transition kinds and an end card", () => {
    const shots = Array.from({ length: 12 }, (_, i) => ({
      shot_number: i + 1,
      beat_role: i === 3 || i === 8 ? "rehook" : i === 10 ? "payoff" : i === 11 ? "bridge" : "body",
      beat_index: Math.floor(i / 3) + 1,
      voiceover: `Part ${i} of the story`,
      duration_seconds: 8,
    }));
    const p = makeShort(undefined, { shots, words: shots.map(() => words()), format: "long" });
    expect(p.chapters.length).toBeGreaterThanOrEqual(3);
    expect(p.loop).toBe(false);
    expect(p.endCard).not.toBeNull();
    expect(p.transitionKinds.length).toBeLessThanOrEqual(3);
  });
});
