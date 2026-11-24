import { describe, expect, it } from "vitest";
import { lintHook, readingGrade } from "../src/hooks/lint";
import { HOOK_TEMPLATES, HOOK_TYPES } from "../src/hooks/library";
import { rankHooks } from "../src/hooks/engine";

const GOOD_VISUAL = "A huge golden ringed planet floating like a beach ball on a calm endless dark ocean at dusk.";

describe("hook linter", () => {
  it("passes a specific, visual, claim-stating hook", () => {
    const r = lintHook({ line: "Saturn is lighter than water.", visual: GOOD_VISUAL, format: "short", title: "Saturn would float on water", type: "contrarian", recentTypes: [] });
    expect(r.passed).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(85);
  });

  it("rejects greetings and filler openers", () => {
    for (const line of ["Hey guys, today we look at Saturn.", "Welcome back to the channel, Saturn floats.", "So, did you know Saturn floats?"]) {
      const r = lintHook({ line, visual: GOOD_VISUAL, format: "short" });
      expect(r.passed, line).toBe(false);
      expect(r.checks.find((c) => c.id === "no_greeting")?.ok).toBe(false);
    }
  });

  it("rejects meta-promises that do not state the fact", () => {
    for (const line of [
      "Soon, Saturn's secret will make you rethink planet weights.",
      "In one minute, you'll see Saturn do the impossible.",
      "At the end, you'll know why mornings last forever on Venus.",
      "Find out what you feel in those first eight minutes.",
    ]) {
      const r = lintHook({ line, visual: GOOD_VISUAL, format: "short" });
      expect(r.checks.find((c) => c.id === "states_claim")?.ok, line).toBe(false);
      expect(r.passed, line).toBe(false);
    }
  });

  it("flags people, labels and split screens in the visual", () => {
    const people = lintHook({ line: "Saturn is lighter than water.", visual: "A student looks shocked at a floating Saturn model on their desk, textbook open.", format: "short" });
    expect(people.checks.find((c) => c.id === "visual_no_people")?.ok).toBe(false);
    expect(people.checks.find((c) => c.id === "visual_first")?.ok).toBe(false);
    const split = lintHook({ line: "Saturn is lighter than water.", visual: "A split screen with Saturn floating on one side and a rock sinking beside it.", format: "short" });
    expect(split.checks.find((c) => c.id === "visual_single_scene")?.ok).toBe(false);
  });

  it("penalises a hook type used in the last three videos", () => {
    const r = lintHook({ line: "Saturn is lighter than water.", visual: GOOD_VISUAL, format: "short", type: "contrarian", recentTypes: ["curiosity_gap", "contrarian", "numbered"] });
    expect(r.checks.find((c) => c.id === "rotation")?.ok).toBe(false);
  });

  it("limits Shorts hooks to 12 words and long hooks to 28", () => {
    const long13 = "Saturn is so light that if you had a bathtub big enough it floats";
    expect(lintHook({ line: long13, visual: GOOD_VISUAL, format: "short" }).checks.find((c) => c.id === "length")?.ok).toBe(false);
    expect(lintHook({ line: long13, visual: GOOD_VISUAL, format: "long" }).checks.find((c) => c.id === "length")?.ok).toBe(true);
  });

  it("requires the hook to share a key word with the title", () => {
    const r = lintHook({ line: "Saturn is lighter than water.", visual: GOOD_VISUAL, format: "short", title: "Why the Moon turns red" });
    expect(r.checks.find((c) => c.id === "matches_title")?.ok).toBe(false);
  });

  it("estimates reading grade sensibly", () => {
    expect(readingGrade("Saturn is lighter than water.")).toBeLessThan(6);
    expect(readingGrade("Gravitational perturbations notwithstanding, planetary densities vary considerably.")).toBeGreaterThan(12);
  });

  it("ranks the better hook first", () => {
    const ranked = rankHooks(
      [
        { type: "curiosity_gap", line: "Soon, Saturn's secret will make you rethink planet weights.", visual: GOOD_VISUAL },
        { type: "contrarian", line: "Saturn is lighter than water.", visual: GOOD_VISUAL },
      ],
      { format: "short", title: "Saturn would float on water", recentTypes: [] }
    );
    expect(ranked[0].line).toBe("Saturn is lighter than water.");
  });
});

describe("hook library", () => {
  it("has 24 templates and every template type exists", () => {
    expect(HOOK_TEMPLATES.length).toBe(24);
    for (const t of HOOK_TEMPLATES) expect(HOOK_TYPES[t.type], t.id).toBeDefined();
    expect(HOOK_TEMPLATES.filter((t) => t.format === "short").length).toBe(12);
    expect(HOOK_TEMPLATES.filter((t) => t.format === "long").length).toBe(12);
  });
});
