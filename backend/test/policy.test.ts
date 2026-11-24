import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { query } from "../src/db";
import { policyCheck, uniquenessCheck } from "../src/qa/policy";
import { parsePlan } from "../src/shorts/plan";
import { reviewPlan } from "../src/shorts/review";

const require = createRequire(import.meta.url);
const raw = () => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "sample-plan.json"), "utf-8"));

beforeAll(async () => {
  const { migrate } = require("../scripts/migrate.js");
  await migrate({ database: "videogenerator_test" });
});

describe("plan review", () => {
  it("passes the sample plan with no errors", () => {
    const r = reviewPlan(parsePlan(raw()), { recentTypes: [] });
    expect(r.errors).toBe(0);
    expect(r.hook.passed).toBe(true);
  });

  it("flags a narration that does not start with the hook and one that is too long for its clip", () => {
    const p = raw();
    p.clips[0].narration = "Something else entirely. " + p.clips[0].narration;
    const r1 = reviewPlan(parsePlan(p), { recentTypes: [] });
    expect(r1.findings.find((f) => f.id === "narration_starts_with_hook")?.level).toBe("error");
    const q = raw();
    q.clips[1].narration = Array(40).fill("float").join(" ");
    const r2 = reviewPlan(parsePlan(q), { recentTypes: [] });
    expect(r2.findings.some((f) => f.id === "c2.too_long" && f.level === "error")).toBe(true);
  });

  it("flags missing sources and empty source strings", () => {
    const p = raw();
    p.facts = [];
    expect(reviewPlan(parsePlan(p), { recentTypes: [] }).findings.find((f) => f.id === "no_sources")?.level).toBe("warn");
    p.facts = [{ claim: "x", source: " " }];
    expect(reviewPlan(parsePlan(p), { recentTypes: [] }).findings.find((f) => f.id === "empty_source")?.level).toBe("error");
  });
});

describe("policy check", () => {
  it("passes the sample plan", () => {
    expect(policyCheck(parsePlan(raw())).some((f) => f.level === "error")).toBe(false);
  });
  it("blocks AI-persona finance and health advice", () => {
    const p = raw();
    p.title = "You should invest in crypto now";
    p.clips[0].narration = "You should invest in crypto now. Buy before it moves.";
    expect(policyCheck(parsePlan(p)).find((f) => f.id === "ai_persona_advice")?.level).toBe("error");
    const q = raw();
    q.clips[0].narration = "The best way to cure a headache is this supplement. You must take it daily.";
    expect(policyCheck(parsePlan(q)).find((f) => f.id === "ai_persona_advice")?.level).toBe("error");
  });
  it("honours the channel's banned topics and demands sources", () => {
    const p = raw();
    expect(policyCheck(parsePlan(p), { bannedTopics: ["Saturn"] }).some((f) => f.id === "banned_topic")).toBe(true);
    p.facts = [];
    expect(policyCheck(parsePlan(p)).find((f) => f.id === "sources")?.level).toBe("error");
  });
});

describe("uniqueness check", () => {
  beforeEach(async () => {
    await query("DELETE FROM uploads");
    await query("DELETE FROM shots");
    await query("DELETE FROM projects");
  });
  const store = (plan: any, title?: string) => query("INSERT INTO projects (idea_prompt, title, plan_json) VALUES (?, ?, ?)", [plan.topic, title ?? plan.title, JSON.stringify(plan)]);

  it("is clean when nothing similar exists", async () => {
    const r = await uniquenessCheck(parsePlan(raw()), null);
    expect(r.findings.every((f) => f.level === "ok")).toBe(true);
  });
  it("blocks a duplicate title or topic and near-identical narration", async () => {
    const existing = raw();
    await store(existing);
    const sameTitle = parsePlan({ ...raw(), id: "other-id" });
    expect((await uniquenessCheck(sameTitle, null)).findings.some((f) => f.id === "duplicate_topic")).toBe(true);
    const sameWords = parsePlan({ ...raw(), id: "other-id-2", title: "A different title entirely", topic: "A different topic entirely" });
    const r = await uniquenessCheck(sameWords, null);
    expect(r.findings.some((f) => f.id === "near_duplicate")).toBe(true);
    expect(r.maxSimilarity).toBeGreaterThan(0.9);
  });
  it("allows a genuinely different video but warns when the hook type repeats", async () => {
    await store(raw());
    const different = raw();
    different.id = "venus-one";
    different.title = "Venus spins backwards";
    different.topic = "Venus rotation";
    different.clips[0].narration = "Venus spins the wrong way. The Sun rises in the west there.";
    different.clips[1].narration = "One sunrise to the next takes about a hundred seventeen days.";
    const r = await uniquenessCheck(parsePlan(different), null);
    expect(r.findings.some((f) => f.level === "error")).toBe(false);
    expect(r.findings.some((f) => f.id === "hook_type_repeat")).toBe(true);
  });
});
