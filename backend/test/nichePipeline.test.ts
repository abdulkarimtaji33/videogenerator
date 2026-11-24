import { describe, expect, it } from "vitest";
import { fitNarration, generateScript, jsonStep, normalizeShots, resumeState, shotCountFor, trimToWords } from "../src/nichePipeline";
import { buildVideoPrompt, shotImagePrompt } from "../src/prompts";
import { planFromProject } from "../src/projectVideo";
import { lintPrompt } from "../src/shorts/promptLint";
import { parsePlan } from "../src/shorts/plan";
import { getProfile } from "../src/niche/profiles";
import type { CreativeBrief, ScriptShot } from "../src/niche/types";
import { z } from "zod";

const brief = (format: "short" | "long" = "short"): CreativeBrief => ({
  niche: "space_science",
  format,
  lengthSeconds: 32,
  promise: "Saturn is lighter than water, so it would float in a big enough ocean.",
  audience: "curious adults",
  subjectMode: "subject",
  anchors: [{ key: "saturn", kind: "subject", name: "Saturn", lockedFeatures: "golden banded planet with thin bright rings", needsReference: true }],
  styleBible: `Photoreal cinematic space documentary look, deep blacks, soft volumetric light, anamorphic lens, ${format === "short" ? "vertical 9:16" : "horizontal 16:9"} framing.`,
  tone: "calm, curious",
  avoid: ["people"],
});

const hook = { type: "contrarian", line: "Saturn is lighter than water.", visual: "A colossal golden ringed planet floating like a beach ball on a calm dark ocean at dusk." };

const rawShot = (i: number, extra: Record<string, unknown> = {}) => ({
  role: "body",
  link: "therefore",
  narration: `Line number ${i} is short and plain.`,
  visual: `The golden ringed planet drifts on the dark water as a slow tracking shot follows its edge, scene ${i}.`,
  anchorKeys: ["saturn", "ghost"],
  continuesPrevious: true,
  ...extra,
});

describe("normalizeShots", () => {
  it("numbers shots, fixes the hook shot, defaults links and drops unknown anchors", () => {
    const shots = normalizeShots([rawShot(1, { role: "wrong", link: "and then" }), rawShot(2, { link: "and then" }), rawShot(3)] as any, brief(), hook);
    expect(shots.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(shots[0].role).toBe("hook");
    expect(shots[0].link).toBeNull();
    expect(shots[0].continuesPrevious).toBe(false);
    expect(shots[0].visual).toBe(hook.visual);
    expect(shots[0].narration.startsWith(hook.line)).toBe(true);
    expect(shots[1].link).toBe("therefore"); // "and then" is not allowed, so it is replaced
    expect(shots[2].anchorKeys).toEqual(["saturn"]);
  });

  it("sets a long video's roles by position: hook, re-hooks at one and two thirds, side story in the middle, payoff, bridge", () => {
    const n = 30;
    // The model labels everything wrongly (payoff first, bridge in the middle, no re-hooks).
    const raw = Array.from({ length: n }, (_, i) => rawShot(i + 1, { role: i === 3 ? "payoff" : i === 10 ? "bridge" : "body" }));
    const shots = normalizeShots(raw as any, brief("long"), hook);
    const at = (role: string) => shots.map((s, i) => (s.role === role ? i + 1 : -1)).filter((i) => i > 0);
    expect(shots[0].role).toBe("hook");
    expect(at("rehook")).toEqual([Math.round(n / 3) + 1, Math.round((2 * n) / 3) + 1]);
    expect(at("side_story")).toEqual([Math.round(n / 2) + 1]);
    expect(shots[n - 2].role).toBe("payoff");
    expect(shots[n - 1].role).toBe("bridge");
    expect(at("payoff")).toHaveLength(1);
    expect(at("bridge")).toHaveLength(1);
    // The payoff comes after every body shot, so the review's payoff check passes.
    const lastBody = Math.max(...shots.map((s, i) => (s.role === "body" ? i : -1)));
    expect(shots.findIndex((s) => s.role === "payoff")).toBeGreaterThan(lastBody);
  });

  it("tags the only anchor on shots where the model forgot", () => {
    const shots = normalizeShots([rawShot(1, { anchorKeys: [] }), rawShot(2, { anchorKeys: [] })] as any, brief(), hook);
    expect(shots.every((s) => s.anchorKeys.includes("saturn"))).toBe(true);
  });
});

describe("shotCountFor", () => {
  it("clamps Shorts to 4-8 shots and gives long videos at least 24", () => {
    expect(shotCountFor("short", 15)).toBe(4);
    expect(shotCountFor("short", 32)).toBe(4);
    expect(shotCountFor("short", 60)).toBe(8);
    expect(shotCountFor("long", 120)).toBe(24);
    expect(shotCountFor("long", 600)).toBe(75);
  });
});

describe("video and image prompts", () => {
  const shot: ScriptShot = { index: 2, role: "body", link: "therefore", narration: "x", visual: "The pale golden cloud bands of the ringed planet bob on dark water in a slow tracking shot", anchorKeys: ["saturn"], continuesPrevious: true };

  it("builds a video prompt that passes the prompt lint (style bible, no speech, no text, audio line)", () => {
    const first: ScriptShot = { ...shot, index: 1, role: "hook", continuesPrevious: false, visual: hook.visual };
    const plan = parsePlan({
      id: "t-1", niche: "space", topic: "saturn", title: "Saturn would float", flow: "veoframe", aspect: "9:16", targetSeconds: 32,
      hook, styleBible: brief().styleBible,
      clips: [first, shot].map((s) => ({ id: `shot-${s.index}`, type: "ai_video", seconds: 8, narration: "words here", prompt: buildVideoPrompt({ shot: s, brief: brief(), continuing: s.continuesPrevious }) })),
    });
    for (const [i, c] of plan.clips.entries()) {
      const errors = lintPrompt(plan, c, i).filter((x) => x.level === "error");
      expect(errors, JSON.stringify(errors)).toEqual([]);
    }
  });

  it("starts a continuing shot from the start frame and states the orientation", () => {
    const p = buildVideoPrompt({ shot, brief: brief(), continuing: true });
    expect(p).toContain("Continuing the same shot from the start frame");
    expect(p).toMatch(/vertical 9:16/);
    expect(buildVideoPrompt({ shot, brief: brief("long"), continuing: false })).toMatch(/horizontal 16:9/);
  });

  it("names only the anchors present in the shot image prompt", () => {
    const b = brief();
    b.anchors.push({ key: "ocean", kind: "place", name: "the dark ocean", lockedFeatures: "calm glassy dark water", needsReference: true });
    expect(shotImagePrompt({ ...shot, anchorKeys: ["saturn"] }, b)).toContain("Saturn");
    expect(shotImagePrompt({ ...shot, anchorKeys: ["saturn"] }, b)).not.toContain("the dark ocean (");
    expect(shotImagePrompt({ ...shot, anchorKeys: [] }, b)).not.toContain("reference image");
  });
});

describe("jsonStep", () => {
  const schema = z.object({ ok: z.boolean() });
  it("retries once with the problem and then succeeds", async () => {
    const calls: string[] = [];
    const ask = async (_s: string, u: string) => {
      calls.push(u);
      return calls.length === 1 ? "not json" : '```json\n{"ok":true}\n```';
    };
    expect(await jsonStep(ask, "sys", "user", schema)).toEqual({ ok: true });
    expect(calls[1]).toContain("previous reply was invalid");
  });
  it("throws a readable error after two bad replies", async () => {
    await expect(jsonStep(async () => "nope", "s", "u", schema)).rejects.toThrow(/did not return valid JSON/);
  });
});

describe("resumeState (continue after an interruption while making pictures)", () => {
  const saved = (stage: string, extra: Record<string, unknown> = {}) => ({
    stage,
    brief_json: JSON.stringify(brief("long")),
    script_json: JSON.stringify({ format: "long", promise: "p", hook, shots: [{ index: 1, role: "hook", link: null, narration: "n", visual: "v", anchorKeys: [], continuesPrevious: false }] }),
    review_json: JSON.stringify({ enabled: true, passed: true, rounds: 0, checks: [] }),
    ...extra,
  });

  it("resumes from the saved brief and final script while pictures are being made", () => {
    for (const stage of ["anchors", "shots"]) {
      const r = resumeState(saved(stage));
      expect(r?.brief.format).toBe("long");
      expect(r?.script.shots).toHaveLength(1);
    }
  });

  it("starts again from the idea at any other stage (a re-plan, a failed run, a finished plan)", () => {
    for (const stage of ["queued", "brief", "script", "review", "plan failed", "plan ready", "queued for video"]) expect(resumeState(saved(stage))).toBeNull();
  });

  it("starts again when the saved data is missing or unreadable", () => {
    expect(resumeState(saved("anchors", { script_json: null }))).toBeNull();
    expect(resumeState(saved("anchors", { review_json: null }))).toBeNull();
    expect(resumeState(saved("anchors", { brief_json: "{not json" }))).toBeNull();
    expect(resumeState(saved("anchors", { script_json: JSON.stringify({ shots: [] }) }))).toBeNull();
    expect(resumeState(null)).toBeNull();
  });
});

describe("fitNarration with a hook longer than one shot can carry", () => {
  const longHook = "It's the Ides of March, forty-four BCE. A pool of blood spreads on marble as senators scatter, and the Republic trembles.";
  const mkLong = (first: string) => ({ format: "long" as const, promise: "p", hook: { ...hook, line: longHook }, shots: [{ index: 1, role: "hook" as const, link: null, narration: first, visual: "v", anchorKeys: [], continuesPrevious: false }, { index: 2, role: "body" as const, link: "but" as const, narration: "Short line.", visual: "v", anchorKeys: [], continuesPrevious: false }] });

  it("shortens the hook itself to whole sentences, so shot 1 still starts with the hook line", async () => {
    const r = await fitNarration(mkLong(longHook), longHook, async () => { throw new Error("down"); });
    expect(r.script.hook.line).toBe("It's the Ides of March, forty-four BCE.");
    expect(r.script.shots[0].narration.startsWith(r.script.hook.line)).toBe(true);
    expect(r.changed).toContain(1);
  });
});

describe("fitNarration", () => {
  const long = "Ever felt lost in a place built like a maze? Two little robots face a giant scrap labyrinth on a quest to get home.";
  const mk = (narr: string[]) => ({ format: "short" as const, promise: "p", hook, shots: narr.map((n, i) => ({ index: i + 1, role: "body" as const, link: i ? ("but" as const) : null, narration: n, visual: "v", anchorKeys: [], continuesPrevious: false })) });

  it("leaves lines that already fit alone", async () => {
    const r = await fitNarration(mk(["Short line one.", "Short line two."]), hook.line, async () => { throw new Error("must not be called"); });
    expect(r.changed).toEqual([]);
  });

  it("uses the model's shorter line when it is short enough", async () => {
    const r = await fitNarration(mk([long]), "Ever felt lost in a place built like a maze?", async () => "Ever felt lost in a place built like a maze? Two robots must get home.");
    expect(r.script.shots[0].narration).toBe("Ever felt lost in a place built like a maze? Two robots must get home.");
    expect(r.changed).toEqual([1]);
  });

  it("falls back to the hook line alone for shot 1 when the model ignores the limit", async () => {
    const r = await fitNarration(mk([long]), "Ever felt lost in a place built like a maze?", async () => long);
    expect(r.script.shots[0].narration).toBe("Ever felt lost in a place built like a maze?");
  });

  it("trims other shots at a whole sentence, and survives a failing model", async () => {
    const text = "Junkyards look endless. But these robots spot a hidden path where others see only piles of scrap and rust and old wheels and more.";
    const r = await fitNarration(mk(["Short opener.", text]), hook.line, async () => { throw new Error("down"); });
    expect(r.script.shots[1].narration).toBe("Junkyards look endless.");
    expect(trimToWords("one two three four five six", 3)).toBe("one two three.");
  });
});

describe("generateScript with messy model output", () => {
  it("accepts null for every optional field (a real model reply that broke the first live run)", async () => {
    const messy = [0, 1, 2, 3].map((i) => ({
      index: i + 1, role: "body", link: i ? "therefore" : null, narration: `Line ${i + 1} is short and plain.`,
      visual: `The golden ringed planet drifts on dark water, slow tracking shot number ${i + 1}.`,
      anchorKeys: ["saturn"], continuesPrevious: false, beat: null, loopOpened: null, loopClosed: null, factIds: null,
    }));
    const ask = async () => JSON.stringify({ shots: messy });
    const script = await generateScript({ idea: "Saturn floats", brief: brief(), profile: getProfile("space_science")!, facts: [], hook, format: "short", lengthSeconds: 32, ask });
    expect(script.shots).toHaveLength(4);
    expect(script.shots[1].loopOpened).toBeUndefined();
    expect(script.shots[2].factIds).toBeUndefined();
  });
});

describe("generateScript", () => {
  it("writes a Short in one call and forces the hook onto shot 1", async () => {
    const shots = [0, 1, 2, 3].map((i) => rawShot(i + 1, { role: i === 3 ? "loop" : "body" }));
    const ask = async () => JSON.stringify({ shots });
    const script = await generateScript({ idea: "Saturn floats", brief: brief(), profile: getProfile("space_science")!, facts: [], hook, format: "short", lengthSeconds: 32, ask });
    expect(script.shots).toHaveLength(4);
    expect(script.shots[0].narration.startsWith(hook.line)).toBe(true);
    expect(script.format).toBe("short");
  });

  it("writes a long video from an outline, expanding two beats at a time", async () => {
    const calls: string[] = [];
    const ask = async (system: string) => {
      calls.push(system.slice(0, 40));
      if (system.includes("outline")) {
        return JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ beat: i + 1, claim: `claim ${i + 1}`, factIds: [], link: i ? "therefore" : null })));
      }
      const m = system.match(/EXACTLY (\d+) shots, numbered from index (\d+)/);
      const n = Number(m?.[1] ?? 2);
      return JSON.stringify({ shots: Array.from({ length: n }, (_, i) => rawShot(i + 1)) });
    };
    const script = await generateScript({ idea: "Fall of Rome", brief: brief("long"), profile: getProfile("history_documentary")!, facts: [], hook, format: "long", lengthSeconds: 600, ask });
    expect(script.format).toBe("long");
    expect(script.shots.length).toBeGreaterThanOrEqual(60);
    expect(script.shots.map((s) => s.index)).toEqual(script.shots.map((_, i) => i + 1));
    expect(calls.filter((c) => c.includes("outline")).length).toBe(1);
    expect(calls.length).toBeGreaterThanOrEqual(4);
  });
});

describe("planFromProject", () => {
  const row = (n: number, extra: Record<string, unknown> = {}) => ({
    shot_number: n, title: `Shot ${n}`, duration_seconds: 8, voiceover: `Narration for shot ${n} goes here.`,
    video_prompt: buildVideoPrompt({ shot: { index: n, role: "body", link: "therefore", narration: "", visual: `The golden ringed planet drifts in a slow push-in, scene ${n}`, anchorKeys: [], continuesPrevious: false }, brief: brief(), continuing: false }),
    image_prompt: "x", beat_index: null, ...extra,
  });

  it("builds a 9:16 Short plan using the stored brief style and hook", () => {
    const project = { id: 7, format: "short", idea_prompt: "Saturn floats", chosen_title: "Saturn would float on water", brief_json: JSON.stringify(brief()), hook_json: JSON.stringify(hook) };
    const plan = planFromProject(project, [row(1), row(2), row(3), row(4)]);
    expect(plan.aspect).toBe("9:16");
    expect(plan.hook.line).toBe(hook.line);
    expect(plan.styleBible).toBe(brief().styleBible);
    expect(plan.title).toBe("Saturn would float on water");
  });

  it("rejects a Short with more than 8 shots but allows the same shots in a long video, with chapters", () => {
    const rows = Array.from({ length: 24 }, (_, i) => row(i + 1, { beat_index: Math.floor(i / 8) + 1 }));
    expect(() => planFromProject({ id: 8, format: "short", idea_prompt: "x" }, rows)).toThrow(/at most 8 shots/);
    const plan = planFromProject({ id: 8, format: "long", idea_prompt: "A long topic about Rome", brief_json: JSON.stringify(brief("long")) }, rows);
    expect(plan.aspect).toBe("16:9");
    expect(plan.format).toBe("long");
    expect(plan.chapters.map((c) => c.clipId)).toEqual(["shot-1", "shot-9", "shot-17"]);
    expect(plan.chapters[0].title).toBe("Intro");
  });
});
