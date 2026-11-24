// SEO packaging (docs/Viral-Video-Research-Complete.md section 2.1): one main keyword, three titles that differ in
// angle, a description whose first two lines restate the promise, tags, hashtags and thumbnail concepts.

import { z } from "zod";
import type { CreativeBrief, SeoPackage, VerifiedFact, VideoFormat } from "../niche/types";

const TITLE_MAX = 70;
const META_WORDS_RE = /\b(update|trailer|compilation|part\s*\d+|part\s+(one|two|three|four|five)|episode\s*\d+|vlog|teaser)\b/i;

export function seoPrompt(args: { idea: string; brief: CreativeBrief; hookLine: string; facts: VerifiedFact[] }): {
  system: string;
  user: string;
} {
  const { idea, brief, hookLine, facts } = args;
  const isShort = brief.format === "short";
  const system = `You are a YouTube packaging editor. You write the search and click packaging for one video. Return ONLY JSON (no prose, no code fences) with exactly these keys:
{
  "mainKeyword": "one main keyword phrase (2-4 words) people would actually search",
  "relatedKeywords": ["5 to 10 related search phrases"],
  "titles": [{"angle":"curiosity","title":"..."},{"angle":"stakes","title":"..."},{"angle":"direct promise","title":"..."}],
  "description": "...",
  "tags": ["10 to 15 tags, the main keyword first"],
  "hashtags": ["3 to 5 hashtags starting with #${isShort ? ", including #Shorts" : ", never #Shorts"}"],
  "category": "a YouTube category name, e.g. Education, Science & Technology, Entertainment, Film & Animation, News & Politics, People & Blogs",
  "thumbnailConcepts": [{"focalSubject":"...","words":"0-5 words","anchorKey":"optional anchor key"}]
}

Rules:
- The three titles differ in ANGLE (for example curiosity, stakes, direct promise), not in wording. Each title is ${TITLE_MAX} characters or fewer, has the main keyword phrase near the start, names a specific subject plus a stake or surprise, and is honest to the video.
- Never use meta words in a title: update, trailer, compilation, part N, episode N, vlog.
- The description: the FIRST TWO LINES restate the video's promise and contain the main keyword phrase; then a short 2-3 sentence summary; then a "Sources:" section listing the given sources, one per line. Do not add hashtags to the description.
- ${isShort ? "This is a Short: keep the description short." : "This is a long video: chapters are added later, do not invent timestamps."}
- thumbnailConcepts: 2 or 3 concepts, each with ONE focal subject taken from the anchors, 0 to 5 words of overlay text, and high contrast. No faces unless an anchor is a character.
- Use only facts from the list. Never invent statistics or sources.`;

  const anchors = brief.anchors.length
    ? brief.anchors.map((a) => `- ${a.key} (${a.kind}): ${a.name}. ${a.lockedFeatures}`).join("\n")
    : "(no recurring anchors)";
  const factLines = facts.length ? facts.map((f) => `- ${f.claim} [source: ${f.source}]`).join("\n") : "(none)";
  const user = `Idea: ${idea}
Niche: ${brief.niche}. Format: ${brief.format}. Audience: ${brief.audience}.
Promise: ${brief.promise}
Hook line (the title's promise must match it): ${hookLine}
Anchors:
${anchors}
Verified facts:
${factLines}`;
  return { system, user };
}

const SeoSchema = z.object({
  mainKeyword: z.string().min(1),
  relatedKeywords: z.array(z.string()).default([]),
  titles: z.array(z.object({ angle: z.string().default(""), title: z.string().min(1) })).min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).default([]),
  hashtags: z.array(z.string()).default([]),
  category: z.string().min(1),
  thumbnailConcepts: z
    .array(z.object({ focalSubject: z.string(), words: z.string().default(""), anchorKey: z.string().optional() }))
    .default([]),
});

function clampTitle(t: string): string {
  const s = t.trim();
  if (s.length <= TITLE_MAX) return s;
  const cut = s.slice(0, TITLE_MAX);
  const sp = cut.lastIndexOf(" ");
  return (sp > 40 ? cut.slice(0, sp) : cut).replace(/[\s,:;\-–—]+$/, "");
}

/** Parse the model's SEO JSON. Throws (Error or ZodError) when it is not valid JSON or fails the schema. */
export function parseSeo(raw: string): SeoPackage {
  let t = (raw ?? "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  let json: unknown;
  try {
    json = JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("SEO output is not JSON");
    json = JSON.parse(t.slice(a, b + 1));
  }
  const d = SeoSchema.parse(json);
  const titles = d.titles.map((x) => ({ angle: x.angle, title: clampTitle(x.title) }));
  return {
    mainKeyword: d.mainKeyword.trim(),
    relatedKeywords: d.relatedKeywords,
    titles,
    chosenTitle: titles[0].title,
    description: d.description,
    tags: d.tags,
    hashtags: d.hashtags.map((h) => (h.startsWith("#") ? h : `#${h.replace(/\s+/g, "")}`)),
    category: d.category,
    thumbnailConcepts: d.thumbnailConcepts,
  };
}

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
}

export function seoCheck(
  seo: SeoPackage,
  hookLine: string,
  format: VideoFormat,
): { ok: boolean; checks: { id: string; ok: boolean; message: string }[] } {
  const main = seo.mainKeyword.trim().toLowerCase();
  const title = seo.chosenTitle ?? "";
  const checks: { id: string; ok: boolean; message: string }[] = [];

  const inTitle = main.length > 0 && title.toLowerCase().includes(main);
  checks.push({
    id: "main_in_title",
    ok: inTitle,
    message: inTitle ? "The main phrase is in the title." : `The title does not contain the main phrase "${seo.mainKeyword}".`,
  });

  const firstLine = (seo.description.split(/\r?\n/).find((l) => l.trim()) ?? "").toLowerCase();
  const inDesc = main.length > 0 && firstLine.includes(main);
  checks.push({
    id: "main_in_description",
    ok: inDesc,
    message: inDesc ? "The main phrase is in the first description line." : "The first description line lacks the main phrase.",
  });

  const inTags = main.length > 0 && seo.tags.some((t) => t.toLowerCase().includes(main));
  checks.push({
    id: "main_in_tags",
    ok: inTags,
    message: inTags ? "The main phrase is in the tags." : "No tag contains the main phrase.",
  });

  checks.push({
    id: "title_length",
    ok: title.length > 0 && title.length <= TITLE_MAX,
    message: title.length <= TITLE_MAX ? `Title is ${title.length} characters.` : `Title is ${title.length} characters (max ${TITLE_MAX}).`,
  });

  const meta = title.match(META_WORDS_RE);
  checks.push({
    id: "no_meta_words",
    ok: !meta,
    message: meta ? `The title contains the meta word "${meta[0]}".` : "The title has no meta words.",
  });

  const hookStems = new Set(words(hookLine).map((w) => w.slice(0, 5)));
  const shared = words(title).filter((w) => hookStems.has(w.slice(0, 5)));
  checks.push({
    id: "title_matches_hook",
    ok: shared.length >= 1,
    message: shared.length >= 1 ? "The title and the hook share their promise words." : "The title promise shares no key words with the hook line.",
  });

  const tagsOk = seo.tags.length >= 10 && seo.tags.length <= 15;
  checks.push({
    id: "tags_count",
    ok: tagsOk,
    message: tagsOk ? `${seo.tags.length} tags.` : `warning: ${seo.tags.length} tags (aim for 10-15).`,
  });

  if (format === "short") {
    const has = seo.hashtags.some((h) => h.toLowerCase() === "#shorts") || /#shorts\b/i.test(seo.description);
    checks.push({ id: "shorts_hashtag", ok: has, message: has ? "#Shorts is present." : "A Short needs the #Shorts hashtag." });
  }

  // tags_count is warn-level only
  const ok = checks.filter((c) => c.id !== "tags_count").every((c) => c.ok);
  return { ok, checks };
}

export function buildDescription(
  seo: SeoPackage,
  opts: { chapters?: string; facts: VerifiedFact[]; format: VideoFormat; syntheticNote?: boolean },
): string {
  // Drop any Sources block and hashtag-only lines the model already wrote; they are rebuilt below.
  const lines = seo.description.replace(/\r/g, "").split("\n");
  const srcAt = lines.findIndex((l) => /^\s*sources?\s*:?\s*$/i.test(l));
  const body = (srcAt >= 0 ? lines.slice(0, srcAt) : lines)
    .filter((l) => !/^\s*(#[\w-]+\s*)+$/.test(l))
    .join("\n")
    .trim();

  const parts: string[] = [body];

  if (opts.format === "long" && opts.chapters && opts.chapters.trim()) {
    parts.push(`Chapters:\n${opts.chapters.trim()}`);
  }

  const sources = [...new Set(opts.facts.map((f) => f.source.trim()).filter(Boolean))];
  if (sources.length) parts.push(`Sources:\n${sources.map((s) => `- ${s}`).join("\n")}`);

  if (opts.syntheticNote) parts.push("This video uses AI-generated visuals and narration.");

  let tags = seo.hashtags.filter((h) => h.toLowerCase() !== "#shorts");
  tags = tags.slice(0, opts.format === "short" ? 4 : 5);
  if (opts.format === "short") tags = ["#Shorts", ...tags];
  if (tags.length) parts.push(tags.join(" "));

  return parts.filter(Boolean).join("\n\n");
}
