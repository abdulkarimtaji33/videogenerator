// The niche-aware pipeline (replaces the character-only story flow for new projects):
//   idea -> brief (subject mode, anchors, style) -> facts -> hook -> SEO packaging -> script -> script review
//        -> anchor reference images -> shots (images + video prompts) -> [full mode] clips -> assembly.
// Every stage writes projects.stage so the UI can show progress. See the product-improvement plan, section 1.3.

import fs from "fs";
import path from "path";
import { z } from "zod";
import { gatherVerifiedFacts } from "./facts";
import { generateHooks, recordHookUse, recentHookTypes } from "./hooks/engine";
import type { HookType } from "./hooks/library";
import { enqueue } from "./jobs/queue";
import { query } from "./db";
import { checkBlocked, pickProfile } from "./niche/profiles";
import type { AnchorSpec, CreativeBrief, NicheProfile, Script, ScriptShot, SeoPackage, VerifiedFact, VideoFormat } from "./niche/types";
import { generateText } from "./openai";
import { makeImage } from "./images";
import { STORAGE_ROOT } from "./pipeline";
import { anchorImagePrompt, briefPrompt, buildVideoPrompt, expandBeatsPrompt, outlinePrompt, scriptPrompt, shortRoles, shotImagePrompt } from "./prompts";
import { reviewAndFixScript } from "./script/review";
import { parseSeo, seoCheck, seoPrompt } from "./seo/seo";
import { mapWithConcurrency } from "./concurrency";
import { localizeScript, maxSpokenWords } from "./script/localize";
import { parseJsonLoose } from "./jsonLoose";
import { isLanguage, type LanguageId } from "./providers/voices";

const SHOT_SECONDS = 8;
const IMAGE_CONCURRENCY = Number(process.env.SHOT_CONCURRENCY || 3);

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";
export const imageSizeFor = (format: VideoFormat): ImageSize => (format === "short" ? "1024x1536" : "1536x1024");

type Ask = (system: string, user: string) => Promise<string>;

// ---------- JSON helpers ----------

function parseJson(raw: string): unknown {
  return parseJsonLoose(raw);
}

/** Calls the model and parses its JSON (repairing small mistakes); on a parse or schema failure asks again, telling the model what was wrong. */
export async function jsonStep<T>(ask: Ask, system: string, user: string, schema: z.ZodType<T>): Promise<T> {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await ask(system, attempt === 0 ? user : `${user}\n\nYour previous reply was invalid (${lastError}). Reply again with ONLY the corrected JSON.`);
    try {
      return schema.parse(parseJson(raw));
    } catch (e) {
      lastError = e instanceof Error ? e.message.slice(0, 300) : String(e);
    }
  }
  throw new Error(`The model did not return valid JSON: ${lastError}`);
}

const AnchorSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(["character", "subject", "place", "object"]),
  name: z.string().min(1),
  lockedFeatures: z.string().default(""),
  needsReference: z.boolean().default(true),
  gender: z.enum(["male", "female", "neutral"]).nullish().transform((v) => v ?? undefined),
});

const BriefSchema = z.object({
  promise: z.string().min(10),
  audience: z.string().default("general audience"),
  subjectMode: z.enum(["subject", "place", "character", "cast", "mixed", "none"]),
  anchors: z.array(AnchorSchema).max(4).default([]),
  styleBible: z.string().min(20),
  tone: z.string().default("calm, curious"),
  avoid: z.array(z.string()).default([]),
});

// Models often write null for "nothing here" (for example loopOpened: null on a shot that opens no loop), so every
// optional field accepts null and treats it as missing.
const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish().transform((v) => (v == null ? undefined : (v as z.infer<T>)));
const ShotSchema = z.object({
  index: opt(z.number()),
  role: z.string().nullish().transform((v) => v || "body"),
  link: opt(z.string()),
  narration: z.string().nullish().transform((v) => v ?? ""),
  visual: z.string().min(10),
  anchorKeys: z.array(z.string()).nullish().transform((v) => v ?? []),
  continuesPrevious: z.boolean().nullish().transform((v) => v ?? false),
  beat: opt(z.number()),
  loopOpened: opt(z.string()),
  loopClosed: opt(z.string()),
  factIds: opt(z.array(z.number())),
});
const ShotsEnvelope = z.object({ shots: z.array(ShotSchema).min(1) });
const OutlineSchema = z
  .array(
    z.object({
      beat: z.number(),
      claim: z.string(),
      factIds: z.array(z.number()).nullish().transform((v) => v ?? []),
      link: opt(z.string()),
      loopOpened: opt(z.string()),
      loopClosed: opt(z.string()),
      sideStory: opt(z.boolean()),
      rehook: opt(z.boolean()),
    })
  )
  .min(1);

const ROLES = new Set(["hook", "foreshadow", "body", "rehook", "side_story", "payoff", "loop", "bridge"]);

/** Cleans the model's shots into valid ScriptShots: 1-based indexes, known roles, but/therefore links, valid anchor keys. */
export function normalizeShots(raw: z.infer<typeof ShotSchema>[], brief: CreativeBrief, hook: { line: string; visual: string }, fixHook = true): ScriptShot[] {
  const known = new Set(brief.anchors.map((a) => a.key));
  const shots: ScriptShot[] = raw.map((s, i) => ({
    index: i + 1,
    role: (ROLES.has(s.role) ? s.role : "body") as ScriptShot["role"],
    link: i === 0 ? null : s.link === "but" ? "but" : "therefore",
    narration: s.narration.trim(),
    visual: s.visual.trim(),
    anchorKeys: s.anchorKeys.filter((k) => known.has(k)),
    continuesPrevious: i === 0 ? false : s.continuesPrevious,
    loopOpened: s.loopOpened,
    loopClosed: s.loopClosed,
    factIds: s.factIds,
    beat: s.beat,
  }));
  // A Short's structure is prescribed (hook, [foreshadow], body..., payoff, loop), so roles are set by position;
  // models often get the order wrong. Long videos keep the model's roles (re-hooks, side story, bridge).
  if (brief.format === "short") {
    const roles = shortRoles(shots.length);
    shots.forEach((s, i) => (s.role = roles[i]));
  }
  // A long video's structure is prescribed too: hook first, re-hooks at one and two thirds, a side story in the
  // middle, then payoff and a closing bridge. Roles in between are body. (The review's rewrite cannot change roles.)
  if (brief.format === "long" && shots.length >= 6) {
    const n = shots.length;
    shots.forEach((s, i) => (s.role = "body"));
    shots[Math.round(n / 3)].role = "rehook";
    shots[Math.round(n / 2)].role = "side_story";
    shots[Math.round((2 * n) / 3)].role = "rehook";
    shots[n - 2].role = "payoff";
    shots[n - 1].role = "bridge";
  }
  if (fixHook && shots.length) {
    shots[0].role = "hook";
    shots[0].visual = hook.visual; // the first clip must open on the hook's visual (cold open)
    const n = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    if (!n(shots[0].narration).startsWith(n(hook.line))) shots[0].narration = `${hook.line} ${shots[0].narration}`.trim();
  }
  // A shot with anchors keeps at least the main anchor on screen when the model forgot to tag it.
  if (brief.anchors.length === 1) for (const s of shots) if (!s.anchorKeys.length) s.anchorKeys = [brief.anchors[0].key];
  return shots;
}

export function shotCountFor(format: VideoFormat, lengthSeconds: number): number {
  const n = Math.ceil(lengthSeconds / SHOT_SECONDS);
  return format === "short" ? Math.min(8, Math.max(4, n)) : Math.max(24, n);
}

/** Short: one call. Long: a beat outline, then the shots of a few beats at a time. */
export async function generateScript(args: {
  idea: string;
  brief: CreativeBrief;
  profile: NicheProfile;
  facts: VerifiedFact[];
  hook: { type: string; line: string; visual: string };
  format: VideoFormat;
  lengthSeconds: number;
  ask?: Ask;
}): Promise<Script> {
  const ask = args.ask ?? generateText;
  const shotCount = shotCountFor(args.format, args.lengthSeconds);
  if (args.format === "short") {
    const p = scriptPrompt({ ...args, shotCount });
    const env = await jsonStep(ask, p.system, p.user, ShotsEnvelope);
    return { format: "short", promise: args.brief.promise, hook: args.hook, shots: normalizeShots(env.shots, args.brief, args.hook) };
  }
  // Long form
  const beatCount = Math.max(4, Math.round(shotCount / 8));
  const o = outlinePrompt({ idea: args.idea, brief: args.brief, facts: args.facts, hook: args.hook, beatCount });
  const outline = await jsonStep(ask, o.system, o.user, OutlineSchema);
  const perBeat = Math.max(4, Math.round(shotCount / outline.length));
  const all: z.infer<typeof ShotSchema>[] = [];
  const GROUP = 2;
  for (let i = 0; i < outline.length; i += GROUP) {
    const beats = outline.slice(i, i + GROUP);
    const wanted = i + GROUP >= outline.length ? Math.max(2, shotCount - all.length) : perBeat * beats.length;
    const p = expandBeatsPrompt({
      idea: args.idea,
      brief: args.brief,
      facts: args.facts,
      hook: args.hook,
      beats,
      startIndex: all.length + 1,
      shotsForBeats: wanted,
      previousNarration: all.length ? all[all.length - 1].narration : "",
    });
    const env = await jsonStep(ask, p.system, p.user, ShotsEnvelope);
    all.push(...env.shots);
  }
  return { format: "long", promise: args.brief.promise, hook: args.hook, shots: normalizeShots(all, args.brief, args.hook) };
}

/** Most words one 8 s shot can carry: the voice measured about 2.4 words a second, with a short pause at the start. */
export const MAX_SHOT_WORDS = Math.floor((SHOT_SECONDS - 0.5) * 2.4);

const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;

/** Cuts text to at most maxWords, at the last whole sentence that fits, else at a word with a full stop. */
export function trimToWords(text: string, maxWords: number): string {
  if (wordCount(text) <= maxWords) return text;
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [];
  let out = "";
  for (const s of sentences) {
    if (wordCount(out + s) > maxWords) break;
    out += s;
  }
  if (out.trim()) return out.trim();
  const cut = text.split(/\s+/).slice(0, maxWords).join(" ").replace(/[,;:\-–]+$/, "");
  return /[.!?]$/.test(cut) ? cut : `${cut}.`;
}

/**
 * Makes every shot's narration fit its 8 seconds. Models ignore word limits, and the review's rewrite step cannot
 * always fix it (shot 1 must start with the hook line), so this is deterministic: one model call per long shot to
 * shorten it, then a hard trim if it is still too long. Shot 1 falls back to the hook line alone.
 */
export async function fitNarration(script: Script, hookLine: string, ask: Ask = generateText): Promise<{ script: Script; changed: number[] }> {
  const changed: number[] = [];
  const shots = [...script.shots];
  // A hook longer than one shot can carry would be cut mid-sentence, so the hook itself is shortened to whole sentences first.
  const origHook = hookLine;
  hookLine = trimToWords(hookLine, MAX_SHOT_WORDS);
  const hookCut = hookLine !== origHook;
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    if (wordCount(s.narration) <= MAX_SHOT_WORDS) continue;
    let text = s.narration;
    try {
      const keep = i === 0 ? ` The line MUST begin with this exact sentence: "${hookLine}"` : "";
      const reply = await ask(
        "You shorten narration lines for a video. Reply with ONLY the shortened line, plain text, no quotes.",
        `Shorten this to at most ${MAX_SHOT_WORDS - 2} words, keep the meaning and the plain, spoken style.${keep}\n\n${s.narration}`
      );
      const short = reply.trim().replace(/^["“]|["”]$/g, "");
      if (short && wordCount(short) < wordCount(text)) text = short;
    } catch {
      /* fall through to the hard trim */
    }
    if (wordCount(text) > MAX_SHOT_WORDS) {
      text = i === 0 && wordCount(hookLine) <= MAX_SHOT_WORDS ? hookLine : trimToWords(text, MAX_SHOT_WORDS);
    }
    shots[i] = { ...s, narration: text };
    changed.push(s.index);
  }
  const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (shots.length && (hookCut || changed.includes(shots[0].index)) && !squash(shots[0].narration).startsWith(squash(hookLine))) {
    shots[0] = { ...shots[0], narration: hookLine };
    if (!changed.includes(shots[0].index)) changed.push(shots[0].index);
  }
  return { script: { ...script, hook: hookCut ? { ...script.hook, line: hookLine } : script.hook, shots }, changed };
}

// ---------- the run ----------

async function setStage(projectId: number, stage: string, error: string | null = null) {
  await query("UPDATE projects SET stage = ?, error_message = ? WHERE id = ?", [stage, error, projectId]);
}

async function fail(projectId: number, message: string) {
  await query("UPDATE projects SET status = 'error', stage = 'plan failed', error_message = ? WHERE id = ?", [message.slice(0, 500), projectId]);
}

function saveBuffer(projectId: number, filename: string, data: Buffer): string {
  const dir = path.join(STORAGE_ROOT, String(projectId));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), data);
  return path.join(String(projectId), filename).replace(/\\/g, "/");
}

/**
 * A run interrupted while it was making pictures (stage "anchors" or "shots") can continue from its saved brief and final
 * script, keeping every finished image. Returns null when the run has to start again from the idea.
 */
export function resumeState(project: any): { brief: CreativeBrief; script: Script } | null {
  if (!project || !["anchors", "shots"].includes(String(project.stage))) return null;
  if (!project.brief_json || !project.script_json || !project.review_json) return null;
  try {
    const brief = JSON.parse(project.brief_json) as CreativeBrief;
    const script = JSON.parse(project.script_json) as Script;
    if (!brief?.anchors || !Array.isArray(script?.shots) || !script.shots.length) return null;
    return { brief, script };
  } catch {
    return null;
  }
}

export async function runNichePipeline(projectId: number): Promise<void> {
  try {
    const [project] = await query<any[]>("SELECT * FROM projects WHERE id = ?", [projectId]);
    if (!project) throw new Error(`Project ${projectId} not found`);
    const idea: string = project.idea_prompt;
    const format: VideoFormat = project.format === "long" ? "long" : "short";
    const lengthSeconds: number = Number(project.length_seconds) || (format === "short" ? 32 : 600);
    const language: LanguageId = isLanguage(project.language) ? project.language : "en";

    const blocked = checkBlocked(idea);
    if (blocked.blocked) return fail(projectId, `This idea cannot be made: ${blocked.reason}`);

    // A run that was interrupted while it was making the pictures (a restart, a power cut) resumes from the saved script:
    // it keeps the finished images and makes only the missing ones. Anything earlier starts again from the idea.
    const resumed = resumeState(project);
    if (!resumed) {
      await query("DELETE FROM anchors WHERE project_id = ?", [projectId]);
      await query("DELETE FROM shots WHERE project_id = ?", [projectId]);
    }
    await query("UPDATE projects SET status = 'shots', aspect = ?, error_message = NULL WHERE id = ?", [format === "short" ? "9:16" : "16:9", projectId]);

    let brief: CreativeBrief;
    let finalScript: Script;
    if (resumed) {
      brief = resumed.brief;
      finalScript = resumed.script;
    } else {
      // 1. Brief
      await setStage(projectId, "brief");
      const profile = pickProfile(idea, project.niche || undefined);
      await query("UPDATE projects SET niche = ? WHERE id = ?", [profile.id, projectId]);
      const bp = briefPrompt({ idea, profile, format, lengthSeconds });
      const b = await jsonStep(generateText, bp.system, bp.user, BriefSchema);
      brief = { ...b, niche: profile.id, format, lengthSeconds, anchors: b.anchors as AnchorSpec[], ...(profile.visualStyle ? { visualStyle: profile.visualStyle } : {}) };
      await query("UPDATE projects SET brief_json = ? WHERE id = ?", [JSON.stringify(brief), projectId]);

      // 2. Facts
      await setStage(projectId, "facts");
      const facts = await gatherVerifiedFacts(idea, brief, profile);
      if (profile.factsRequired && facts.length < 3) {
        return fail(projectId, `Only ${facts.length} fact(s) could be verified for this topic; this niche needs at least 3. Try a more specific idea.`);
      }
      await query("UPDATE projects SET facts_json = ? WHERE id = ?", [JSON.stringify(facts), projectId]);

      // 3. Hook
      await setStage(projectId, "hook");
      const hooks = await generateHooks({ topic: idea, format, niche: profile.id, title: brief.promise, facts: facts.map((f) => f.claim) });
      const hook = { type: hooks.best.type as string, line: hooks.best.line, visual: hooks.best.visual, score: hooks.best.report.score };
      recordHookUse(hooks.best.type as HookType, hooks.best.line);
      await query("UPDATE projects SET hook_json = ? WHERE id = ?", [JSON.stringify(hook), projectId]);

      // 4. SEO packaging (titles, description, tags, thumbnail concepts)
      await setStage(projectId, "seo");
      const sp = seoPrompt({ idea, brief, hookLine: hook.line, facts });
      let seo: SeoPackage | null = null;
      try {
        seo = parseSeo(await generateText(sp.system, sp.user));
      } catch {
        seo = parseSeo(await generateText(sp.system, sp.user)); // one retry
      }
      const seoReport = seoCheck(seo, hook.line, format);
      await query("UPDATE projects SET seo_json = ?, chosen_title = ?, title = ?, description = ?, tags = ? WHERE id = ?", [
        JSON.stringify({ ...seo, check: seoReport }),
        seo.chosenTitle,
        seo.chosenTitle,
        seo.description,
        JSON.stringify(seo.tags),
        projectId,
      ]);

      // 5-6. Script and its review
      await setStage(projectId, "script");
      const script = await generateScript({ idea, brief, profile, facts, hook, format, lengthSeconds });
      await query("UPDATE projects SET script_json = ? WHERE id = ?", [JSON.stringify(script), projectId]);

      await setStage(projectId, "review");
      const reviewed = await reviewAndFixScript(script, brief, {
        generateText,
        enabled: Boolean(project.review_enabled),
        recentHookTypes: recentHookTypes(4).slice(0, -1),
      });
      // Whatever the review could not fix, make every line fit its shot (deterministic), and say so in the report.
      const fitted = await fitNarration(reviewed.script, hook.line);
      finalScript = fitted.script;
      // Urdu and Hindi: adapt every line into the spoken language (native script for the voice, Roman words for captions).
      if (language !== "en") {
        await setStage(projectId, "translating");
        finalScript = await localizeScript(finalScript, brief, language, generateText);
      }
      if (fitted.changed.length && reviewed.report.enabled) {
        reviewed.report.checks = reviewed.report.checks.map((c) => (c.id === "narration_fits" && !c.ok ? { ...c, ok: true, fixed: true, message: `Narration shortened to fit shots ${fitted.changed.join(", ")}.` } : c));
        reviewed.report.passed = reviewed.report.checks.every((c) => c.ok || c.id === "hook_type_rotates");
      }
      await query("UPDATE projects SET script_json = ?, review_json = ? WHERE id = ?", [JSON.stringify(finalScript), JSON.stringify(reviewed.report), projectId]);
    }

    // 7. Anchor reference images
    await setStage(projectId, "anchors");
    const size = imageSizeFor(format);
    const anchorPaths = new Map<string, string>();
    const doneAnchors = await query<any[]>("SELECT `key`, image_path FROM anchors WHERE project_id = ? AND image_path IS NOT NULL", [projectId]);
    const haveAnchor = new Map(doneAnchors.filter((r) => fs.existsSync(path.join(STORAGE_ROOT, r.image_path))).map((r) => [r.key as string, r.image_path as string]));
    await mapWithConcurrency(brief.anchors, IMAGE_CONCURRENCY, async (a) => {
      const prompt = anchorImagePrompt(a, brief);
      // A finished picture from an interrupted run is kept (resume): only missing ones are made.
      if (haveAnchor.has(a.key)) {
        anchorPaths.set(a.key, haveAnchor.get(a.key) as string);
        return;
      }
      await query(
        "INSERT INTO anchors (project_id, `key`, kind, name, locked_features, image_prompt, status) VALUES (?,?,?,?,?,?, 'pending') ON DUPLICATE KEY UPDATE kind = VALUES(kind), name = VALUES(name), locked_features = VALUES(locked_features), image_prompt = VALUES(image_prompt), status = 'pending'",
        [projectId, a.key, a.kind, a.name, a.lockedFeatures, prompt]
      );
      // Every anchor gets a reference image, whatever the model's needsReference hint says: without it the shot images
      // are generated from text alone and the subject drifts between shots.
      const made = await makeImage({ prompt, size, provider: project.image_provider, fallback: !!project.image_fallback });
      const rel = saveBuffer(projectId, `anchor-${a.key}.png`, made.buffer);
      anchorPaths.set(a.key, rel);
      await query("UPDATE anchors SET image_path = ?, status = 'done', image_provider_used = ?, image_ms = ? WHERE project_id = ? AND `key` = ?", [rel, made.provider, made.ms, projectId, a.key]);
    });
    // The first character anchor also fills the old character columns, so old views of the project still work.
    const firstChar = brief.anchors.find((a) => a.kind === "character") ?? brief.anchors[0];
    if (firstChar && anchorPaths.get(firstChar.key)) {
      await query("UPDATE projects SET character_description = ?, character_image_path = ? WHERE id = ?", [`${firstChar.name}: ${firstChar.lockedFeatures}`, anchorPaths.get(firstChar.key), projectId]);
    }

    // 8. Shots: rows first (so the UI shows the plan), then first-frame images
    await setStage(projectId, "shots");
    // Shot rows from an interrupted run are reused when they match this script; otherwise they are written again.
    let existing = await query<any[]>("SELECT id, shot_number, image_path FROM shots WHERE project_id = ? ORDER BY shot_number", [projectId]);
    const matches = existing.length === finalScript.shots.length && existing.every((r, i) => r.shot_number === finalScript.shots[i].index);
    if (!matches && existing.length) {
      await query("DELETE FROM shots WHERE project_id = ?", [projectId]);
      existing = [];
    }
    const shotIds: number[] = [];
    for (const [i, s] of finalScript.shots.entries()) {
      if (existing[i]) {
        shotIds.push(existing[i].id as number);
        continue;
      }
      // Same limit as fitNarration (about 2.4 words a second, measured, with a short pause at the start of each shot).
      const spoken = s.spoken || s.narration;
      const fits = s.spoken ? wordCount(s.spoken) <= maxSpokenWords(language) : wordCount(s.narration) <= MAX_SHOT_WORDS;
      const r = await query<any>(
        `INSERT INTO shots (project_id, shot_number, title, description, voiceover, image_prompt, video_prompt, duration_seconds, status,
           beat_role, beat_index, anchor_keys, continues_previous, link, narration_fits, caption_text, narration_en, speaker)
         VALUES (?,?,?,?,?,?,?,?, 'image',?,?,?,?,?,?,?,?,?)`,
        [
          projectId,
          s.index,
          s.role.replace("_", " ").replace(/^./, (c) => c.toUpperCase()),
          s.visual,
          spoken,
          shotImagePrompt(s, brief),
          buildVideoPrompt({ shot: s, brief, continuing: s.continuesPrevious }),
          SHOT_SECONDS,
          s.role,
          s.beat ?? null,
          JSON.stringify(s.anchorKeys),
          s.continuesPrevious ? 1 : 0,
          s.link,
          fits ? 1 : 0,
          s.roman ?? null,
          s.spoken ? s.narration : null,
          s.speaker ?? null,
        ]
      );
      shotIds.push(r.insertId as number);
    }
    await mapWithConcurrency(finalScript.shots, IMAGE_CONCURRENCY, async (s, i) => {
      if (existing[i]?.image_path && fs.existsSync(path.join(STORAGE_ROOT, existing[i].image_path))) return; // already made before the interruption
      const refs = s.anchorKeys.map((k) => anchorPaths.get(k)).filter(Boolean).map((p) => path.join(STORAGE_ROOT, p as string));
      const prompt = shotImagePrompt(s, brief);
      try {
        const made = await makeImage({ prompt, size, refs, provider: project.image_provider, fallback: !!project.image_fallback });
        const rel = saveBuffer(projectId, `shot-${s.index}.png`, made.buffer);
        await query("UPDATE shots SET image_path = ?, status = 'done', image_provider_used = ?, image_ms = ?, error_message = NULL WHERE id = ?", [rel, made.provider, made.ms, shotIds[i]]);
      } catch (err) {
        console.error("shot image failed:", err);
        const msg = err instanceof Error ? err.message : "";
        await query("UPDATE shots SET status = 'error', error_message = ? WHERE id = ?", [(msg && /FLUX|image/i.test(msg) ? msg : "Image generation failed. Please try again.").slice(0, 400), shotIds[i]]);
      }
    });

    const clips = finalScript.shots.length;
    await query("UPDATE projects SET status = 'done', cost_estimate_json = ? WHERE id = ?", [JSON.stringify({ clips, minutes: Math.round(clips * 2 + 5) }), projectId]);
    await setStage(projectId, "plan ready");

    // Full mode goes straight on to the video (clips, narration, captions, QA).
    if (project.run_mode !== "plan") {
      await enqueue("project.video", { projectId }, { dedupeKey: `video:${projectId}:${Date.now()}` });
    }
  } catch (err) {
    console.error("niche pipeline failed:", err);
    await fail(projectId, err instanceof Error ? err.message : "The plan could not be written. Please try again.");
  }
}
