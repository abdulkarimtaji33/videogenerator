import { describe, expect, it } from "vitest";
import { critiqueEditPlan } from "../src/edit/critique";
import { sfxEvents, sfxGapViolations } from "../src/edit/filters";
import type { EditPlan } from "../src/edit/types";
import { makeShort } from "./editFixture";

const clone = (p: EditPlan): EditPlan => JSON.parse(JSON.stringify(p));
const check = (r: ReturnType<typeof critiqueEditPlan>, id: string) => r.review.checks.find((c) => c.id === id)!;

describe("critique", () => {
  it("passes a director plan and gives every check a ref", () => {
    const r = critiqueEditPlan(makeShort());
    expect(r.review.passed).toBe(true);
    for (const c of r.review.checks) expect(c.ref).toBeTruthy();
  });

  it("does not mutate its input", () => {
    const bad = clone(makeShort());
    bad.beats[0].transitionIn = "fade";
    const before = JSON.stringify(bad);
    critiqueEditPlan(bad);
    expect(JSON.stringify(bad)).toBe(before);
  });

  it("fixes a transition on the hook", () => {
    const bad = clone(makeShort());
    bad.beats[0].transitionIn = "fade";
    bad.beats[0].transitionSeconds = 0.3;
    const r = critiqueEditPlan(bad);
    expect(check(r, "hook_first").fixed).toBe(true);
    expect(r.plan.beats[0].transitionIn).toBe("cut");
  });

  it("fixes more than 3 transition kinds", () => {
    const bad = clone(makeShort());
    const kinds = ["fade", "zoomin", "smoothleft", "dip", "fadeblack"] as const;
    bad.beats.forEach((b, i) => {
      if (i > 0 && b.role !== "payoff") {
        b.transitionIn = kinds[i % kinds.length];
        b.transitionSeconds = 0.3;
      }
    });
    const r = critiqueEditPlan(bad);
    expect(check(r, "transition_kinds").ok).toBe(true);
    expect(r.plan.transitionKinds.length).toBeLessThanOrEqual(3);
  });

  it("fixes a repeated punch and a punch above 1.2", () => {
    const bad = clone(makeShort());
    bad.beats[2].punch = 1.35;
    bad.beats[3].punch = 1.12;
    bad.beats[4].punch = 1.12;
    const r = critiqueEditPlan(bad);
    expect(check(r, "punch_cap").ok).toBe(true);
    expect(check(r, "punch_repeat").ok).toBe(true);
    r.plan.beats.forEach((b, i) => i > 0 && b.punch > 1 && expect(b.punch).not.toBe(r.plan.beats[i - 1].punch));
  });

  it("fixes a static shot over 8 s", () => {
    const bad = clone(makeShort());
    bad.beats[1].punch = 1;
    bad.beats[1].end = bad.beats[1].start + 12;
    const r = critiqueEditPlan(bad);
    expect(check(r, "static_frame").ok).toBe(true);
    expect(r.plan.beats[1].punch).toBeGreaterThan(1);
  });

  it("fixes three identical layouts in a row", () => {
    const bad = clone(makeShort());
    bad.beats.forEach((b) => (b.layout = "full"));
    const r = critiqueEditPlan(bad);
    expect(check(r, "layout_variety").ok).toBe(true);
  });

  it("fixes sound effects closer than 3 s, repeated takes and double risers", () => {
    const bad = clone(makeShort());
    bad.beats[1].sfx.push({ kind: "whoosh", at: 9, gainDb: 4, take: 1 }, { kind: "whoosh", at: 9.5, gainDb: 4, take: 1 }, { kind: "riser", at: 3, gainDb: 5, take: 0 });
    const r = critiqueEditPlan(bad);
    expect(sfxGapViolations(sfxEvents(r.plan))).toEqual([]);
    expect(check(r, "sfx_density").ok).toBe(true);
    expect(sfxEvents(r.plan).filter((e) => e.kind === "riser").length).toBeLessThanOrEqual(1);
    expect(check(r, "sfx_once").ok).toBe(true);
  });

  it("restores a missing payoff impact", () => {
    const bad = clone(makeShort());
    bad.beats.forEach((b) => (b.sfx = b.sfx.filter((s) => s.kind !== "impact")));
    const r = critiqueEditPlan(bad);
    expect(check(r, "payoff_impact").ok).toBe(true);
    expect(sfxEvents(r.plan).some((e) => e.kind === "impact")).toBe(true);
  });

  it("fixes captions below y 1248, short cards, texture and a Short end card", () => {
    const bad = clone(makeShort());
    bad.captionBottomY = 1320;
    bad.beats[2].card = { type: "lower_third", text: "Saturn the ringed planet", at: 20, seconds: 0.5 };
    bad.style.grain = 9;
    bad.endCard = { seconds: 10, text: "Watch next" };
    const r = critiqueEditPlan(bad);
    expect(r.plan.captionBottomY).toBe(1248);
    expect(r.plan.beats[2].card!.seconds).toBeGreaterThanOrEqual(0.5 + 0.3 * 4);
    expect(r.plan.style.grain).toBeLessThanOrEqual(4);
    expect(r.plan.endCard).toBeNull();
    expect(r.review.passed).toBe(true);
    expect(r.review.rounds).toBeLessThanOrEqual(2);
  });

  it("warns, but still passes, when there is no music file", () => {
    const p = makeShort(undefined, { pickMusic: () => null });
    const r = critiqueEditPlan(p);
    expect(check(r, "music_bed").message).toContain("warning");
    expect(r.review.passed).toBe(true);
  });
});
