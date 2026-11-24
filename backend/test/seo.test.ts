import { describe, expect, it } from "vitest";
import { buildDescription, parseSeo, seoCheck, seoPrompt } from "../src/seo/seo";
import type { CreativeBrief, SeoPackage, VerifiedFact } from "../src/niche/types";

const brief: CreativeBrief = {
  niche: "space_science",
  format: "short",
  lengthSeconds: 35,
  promise: "Saturn would float in water",
  audience: "curious adults",
  subjectMode: "subject",
  anchors: [{ key: "saturn", kind: "subject", name: "Saturn", lockedFeatures: "pale gold sphere with rings", needsReference: true }],
  styleBible: "painterly space",
  tone: "awestruck",
  avoid: [],
};

const facts: VerifiedFact[] = [
  { id: 1, claim: "Saturn's mean density is about 0.69 g/cm3.", source: "NASA Saturn Fact Sheet" },
  { id: 2, claim: "Saturn is mostly hydrogen and helium.", source: "NASA Saturn Fact Sheet" },
];

const raw = {
  mainKeyword: "Saturn floats in water",
  relatedKeywords: ["saturn density", "planet lighter than water", "saturn facts", "why saturn is light", "saturn rings"],
  titles: [
    { angle: "curiosity", title: "Saturn floats in water, and the reason is wild" },
    { angle: "stakes", title: "Saturn floats in water: what it means for planets" },
    { angle: "direct promise", title: "Saturn floats in water in 40 seconds" },
  ],
  description:
    "Saturn floats in water because it is less dense than water.\nThis Short shows why Saturn floats in water.\n\nSaturn is mostly hydrogen.\n\nSources:\n- old\n\n#Shorts #space",
  tags: ["saturn floats in water", "saturn", "planets", "space", "density", "science", "hydrogen", "gas giant", "nasa", "rings"],
  hashtags: ["#Shorts", "space", "#saturn"],
  category: "Science & Technology",
  thumbnailConcepts: [{ focalSubject: "Saturn floating on dark water", words: "IT FLOATS", anchorKey: "saturn" }],
};

describe("seoPrompt", () => {
  it("carries the rules, anchors and facts", () => {
    const p = seoPrompt({ idea: "Saturn floats", brief, hookLine: "Saturn would float in water.", facts });
    expect(p.system).toContain("70 characters");
    expect(p.system).toContain("#Shorts");
    expect(p.system).toContain("FIRST TWO LINES");
    expect(p.user).toContain("saturn (subject)");
    expect(p.user).toContain("NASA Saturn Fact Sheet");
    expect(p.user).toContain("Saturn would float in water.");
  });
  it("forbids #Shorts for long videos", () => {
    const p = seoPrompt({ idea: "x", brief: { ...brief, format: "long" }, hookLine: "h", facts: [] });
    expect(p.system).toContain("never #Shorts");
  });
});

describe("parseSeo", () => {
  it("strips code fences, sets chosenTitle and normalises hashtags", () => {
    const s = parseSeo("```json\n" + JSON.stringify(raw) + "\n```");
    expect(s.chosenTitle).toBe(raw.titles[0].title);
    expect(s.hashtags).toEqual(["#Shorts", "#space", "#saturn"]);
    expect(s.thumbnailConcepts[0].anchorKey).toBe("saturn");
  });

  it("clamps long titles to 70 characters", () => {
    const long = { ...raw, titles: [{ angle: "a", title: "Saturn floats in water " + "and the amazing reason behind it is truly wild ".repeat(3) }] };
    const s = parseSeo(JSON.stringify(long));
    expect(s.titles[0].title.length).toBeLessThanOrEqual(70);
    expect(s.chosenTitle).toBe(s.titles[0].title);
  });

  it("throws on invalid JSON or schema", () => {
    expect(() => parseSeo("nope")).toThrow();
    expect(() => parseSeo(JSON.stringify({ mainKeyword: "x" }))).toThrow();
  });
});

describe("seoCheck", () => {
  const good = (): SeoPackage => parseSeo(JSON.stringify(raw));
  const hook = "Saturn would float in water.";

  it("passes a good Short package", () => {
    const r = seoCheck(good(), hook, "short");
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("flags a title without the main phrase", () => {
    const s = good();
    s.chosenTitle = "A surprising planet fact";
    const r = seoCheck(s, hook, "short");
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.id === "main_in_title")!.ok).toBe(false);
  });

  it("flags a long title, meta words, and a description first line without the phrase", () => {
    const s = good();
    s.chosenTitle = "Saturn floats in water trailer " + "x".repeat(60);
    let r = seoCheck(s, hook, "short");
    expect(r.checks.find((c) => c.id === "title_length")!.ok).toBe(false);
    expect(r.checks.find((c) => c.id === "no_meta_words")!.ok).toBe(false);
    const t = good();
    t.description = "A nice video.\nMore text.";
    r = seoCheck(t, hook, "short");
    expect(r.checks.find((c) => c.id === "main_in_description")!.ok).toBe(false);
  });

  it("flags a title that shares nothing with the hook", () => {
    const s = good();
    s.mainKeyword = "gold";
    s.chosenTitle = "Gold bars";
    const r = seoCheck(s, hook, "short");
    expect(r.checks.find((c) => c.id === "title_matches_hook")!.ok).toBe(false);
  });

  it("treats the tag count as warn-level only", () => {
    const s = good();
    s.tags = ["saturn floats in water", "saturn"];
    const r = seoCheck(s, hook, "short");
    expect(r.checks.find((c) => c.id === "tags_count")!.ok).toBe(false);
    expect(r.ok).toBe(true);
  });

  it("requires #Shorts for shorts only", () => {
    const s = good();
    s.hashtags = ["#space"];
    s.description = "Saturn floats in water.\nMore.";
    expect(seoCheck(s, hook, "short").ok).toBe(false);
    expect(seoCheck(s, hook, "long").checks.find((c) => c.id === "shorts_hashtag")).toBeUndefined();
  });
});

describe("buildDescription", () => {
  const seo = parseSeo(JSON.stringify(raw));

  it("builds a Short description with sources, #Shorts and the synthetic note", () => {
    const d = buildDescription(seo, { facts, format: "short", syntheticNote: true });
    expect(d.split("\n")[0]).toContain("Saturn floats in water");
    expect(d).toContain("Sources:\n- NASA Saturn Fact Sheet");
    expect(d.match(/NASA Saturn Fact Sheet/g)!.length).toBe(1);
    expect(d).not.toContain("- old");
    expect(d).toContain("AI-generated");
    expect(d.trim().endsWith("#Shorts #space #saturn")).toBe(true);
    expect(d).not.toContain("Chapters:");
  });

  it("builds a long description with chapters and without #Shorts", () => {
    const d = buildDescription(seo, { facts, format: "long", chapters: "0:00 Hook\n1:10 Density" });
    expect(d).toContain("Chapters:\n0:00 Hook\n1:10 Density");
    expect(d).not.toContain("#Shorts");
    expect(d).toContain("#space");
  });
});
