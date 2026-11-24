import { describe, expect, it } from "vitest";
import { reviewAndFixScript, reviewScript } from "../src/script/review";
import type { BeatRole, CreativeBrief, Script, ScriptShot } from "../src/niche/types";

const brief = (format: "short" | "long" = "short"): CreativeBrief => ({
  niche: "space_science",
  format,
  lengthSeconds: format === "short" ? 40 : 600,
  promise: "Saturn would float in water",
  audience: "curious adults",
  subjectMode: "subject",
  anchors: [{ key: "saturn", kind: "subject", name: "Saturn", lockedFeatures: "pale gold sphere with rings", needsReference: true }],
  styleBible: "painterly space",
  tone: "awestruck",
  avoid: [],
});

function shot(index: number, role: BeatRole, narration: string, extra: Partial<ScriptShot> = {}): ScriptShot {
  return {
    index,
    role,
    link: index === 1 ? null : index % 2 ? "therefore" : "but",
    narration,
    visual: "Saturn glowing",
    anchorKeys: ["saturn"],
    continuesPrevious: false,
    ...extra,
  };
}

const shortScript = (): Script => ({
  format: "short",
  promise: "Saturn would float in water",
  hook: { type: "curiosity_gap", line: "Saturn is so light it would float in water.", visual: "Saturn on dark water" },
  shots: [
    shot(1, "hook", "Saturn is so light it would float in water."),
    shot(2, "foreshadow", "But the reason Saturn floats is stranger than the rings.", { loopOpened: "why saturn is light" }),
    shot(3, "body", "Saturn is mostly hydrogen, the lightest element there is."),
    shot(4, "payoff", "Its average density is lower than water, so it floats.", { loopClosed: "why saturn is light" }),
    shot(5, "loop", "So Saturn would float in water, if you found a big enough ocean."),
  ],
});

const longScript = (): Script => {
  const roles: BeatRole[] = ["hook", "body", "rehook", "body", "side_story", "rehook", "body", "payoff", "bridge"];
  return {
    format: "long",
    promise: "Saturn would float in water",
    hook: { type: "shocking_stat", line: "Saturn would float in water.", visual: "Saturn" },
    shots: roles.map((r, i) =>
      shot(i + 1, r, i === 0 ? "Saturn would float in water, and the proof is simple." : "Saturn fact told plainly."),
    ),
  };
};

const ok = (r: ReturnType<typeof reviewScript>, id: string) => r.checks.find((c) => c.id === id)!.ok;

describe("reviewScript", () => {
  it("passes a clean Short", () => {
    const r = reviewScript(shortScript(), brief(), { recentHookTypes: ["raise_stakes"] });
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.checks.map((c) => c.id)).toContain("short_structure");
    expect(r.checks.map((c) => c.id)).not.toContain("long_structure");
  });

  it("passes a clean long script", () => {
    const r = reviewScript(longScript(), brief("long"));
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.checks.map((c) => c.id)).toContain("long_structure");
  });

  it("flags a greeting as the first line", () => {
    const s = shortScript();
    s.hook.line = "Hey guys, Saturn would float in water.";
    s.shots[0].narration = s.hook.line;
    expect(ok(reviewScript(s, brief()), "first_line_is_hook")).toBe(false);
  });

  it("flags shot 1 that does not start with the hook line", () => {
    const s = shortScript();
    s.shots[0].narration = "Something else entirely.";
    expect(ok(reviewScript(s, brief()), "first_line_is_hook")).toBe(false);
  });

  it("flags a promise that is missing from the early narration", () => {
    const s = shortScript();
    s.hook.line = "Space is huge and strange.";
    s.shots[0].narration = "Space is huge and strange.";
    expect(ok(reviewScript(s, brief()), "promise_early")).toBe(false);
  });

  it("flags 'and then' links and narration", () => {
    const s = shortScript();
    s.shots[2].narration = "And then Saturn turns out to be hydrogen.";
    expect(ok(reviewScript(s, brief()), "no_and_then")).toBe(false);
    const t = shortScript();
    (t.shots[3] as { link: unknown }).link = null;
    expect(ok(reviewScript(t, brief()), "no_and_then")).toBe(false);
  });

  it("flags an unclosed loop", () => {
    const s = shortScript();
    delete s.shots[3].loopClosed;
    expect(ok(reviewScript(s, brief()), "loops_closed")).toBe(false);
  });

  it("flags a missing payoff and a payoff before body", () => {
    const s = shortScript();
    s.shots[3].role = "body";
    expect(ok(reviewScript(s, brief()), "payoff_present")).toBe(false);
    const t = shortScript();
    t.shots[2].role = "payoff";
    t.shots[3].role = "body";
    expect(ok(reviewScript(t, brief()), "payoff_present")).toBe(false);
  });

  it("flags narration that cannot fit an 8 s shot", () => {
    const s = shortScript();
    s.shots[2].narration = Array(30).fill("hydrogen").join(" ");
    expect(ok(reviewScript(s, brief()), "narration_fits")).toBe(false);
  });

  it("flags digits but allows digits inside names", () => {
    const s = shortScript();
    s.shots[2].narration = "Saturn has 146 moons and the probe GPT-4 agrees.";
    expect(ok(reviewScript(s, brief()), "numbers_as_words")).toBe(false);
    const t = shortScript();
    t.shots[2].narration = "The probe K2 and GPT-4 never visited Saturn.";
    expect(ok(reviewScript(t, brief()), "numbers_as_words")).toBe(true);
  });

  it("flags a recently used hook type", () => {
    const r = reviewScript(shortScript(), brief(), { recentHookTypes: ["curiosity_gap"] });
    expect(ok(r, "hook_type_rotates")).toBe(false);
  });

  it("flags first person in the hook line only", () => {
    const s = shortScript();
    s.hook.line = "I found that Saturn would float in water.";
    s.shots[0].narration = s.hook.line;
    expect(ok(reviewScript(s, brief()), "no_first_person")).toBe(false);
    const t = shortScript();
    t.shots[2].narration = "I checked and Saturn is mostly hydrogen.";
    expect(ok(reviewScript(t, brief()), "no_first_person")).toBe(true);
  });

  it("flags a bad Short structure", () => {
    const s = shortScript();
    s.shots[0].role = "body";
    expect(ok(reviewScript(s, brief()), "short_structure")).toBe(false);
    const t = shortScript();
    t.shots[4].role = "payoff";
    expect(ok(reviewScript(t, brief()), "short_structure")).toBe(false);
  });

  it("flags a bad long structure", () => {
    const s = longScript();
    s.shots[2].role = "body";
    s.shots[5].role = "body";
    s.shots[4].role = "body";
    s.shots[8].role = "body";
    const r = reviewScript(s, brief("long"));
    expect(ok(r, "long_structure")).toBe(false);
  });

  it("flags unknown anchor keys", () => {
    const s = shortScript();
    s.shots[1].anchorKeys = ["jupiter"];
    expect(ok(reviewScript(s, brief()), "anchors_known")).toBe(false);
  });
});

describe("reviewAndFixScript", () => {
  const never = async () => {
    throw new Error("should not be called");
  };

  it("does nothing when disabled", async () => {
    const s = shortScript();
    const out = await reviewAndFixScript(s, brief(), { generateText: never, enabled: false });
    expect(out.script).toBe(s);
    expect(out.report).toEqual({ enabled: false, passed: true, rounds: 0, checks: [] });
  });

  it("does not call the critic when the script already passes", async () => {
    const out = await reviewAndFixScript(shortScript(), brief(), { generateText: never, enabled: true });
    expect(out.report.passed).toBe(true);
    expect(out.report.rounds).toBe(0);
  });

  it("applies critic fixes and marks the check fixed", async () => {
    const s = shortScript();
    s.shots[2].narration = "Saturn has 146 moons and is mostly hydrogen.";
    let calls = 0;
    const gen = async () => {
      calls++;
      return '```json\n{"fixes":[{"shotIndex":3,"field":"narration","newText":"Saturn has many moons and is mostly hydrogen.","reason":"digits"}]}\n```';
    };
    const out = await reviewAndFixScript(s, brief(), { generateText: gen, enabled: true });
    expect(calls).toBe(1);
    expect(out.script.shots[2].narration).toContain("many moons");
    expect(s.shots[2].narration).toContain("146");
    expect(out.report.passed).toBe(true);
    expect(out.report.rounds).toBe(1);
    expect(out.report.checks.find((c) => c.id === "numbers_as_words")).toMatchObject({ ok: true, fixed: true });
  });

  it("treats bad model JSON as no fixes and never throws", async () => {
    const s = shortScript();
    s.shots[2].narration = "Saturn has 146 moons.";
    const out = await reviewAndFixScript(s, brief(), { generateText: async () => "not json at all", enabled: true });
    expect(out.report.passed).toBe(false);
    expect(out.report.rounds).toBe(1);
    expect(out.script.shots[2].narration).toBe("Saturn has 146 moons.");
    const thrown = await reviewAndFixScript(s, brief(), { generateText: never, enabled: true });
    expect(thrown.report.passed).toBe(false);
  });

  it("stops after maxRounds and keeps the best version", async () => {
    const s = shortScript();
    s.shots[2].narration = "Saturn has 146 moons.";
    let calls = 0;
    const gen = async () => {
      calls++;
      return JSON.stringify({ fixes: [{ shotIndex: 3, field: "narration", newText: `Saturn has ${100 + calls} moons.` }] });
    };
    const out = await reviewAndFixScript(s, brief(), { generateText: gen, enabled: true, maxRounds: 2 });
    expect(calls).toBe(2);
    expect(out.report.rounds).toBe(2);
    expect(out.report.passed).toBe(false);
  });
});
