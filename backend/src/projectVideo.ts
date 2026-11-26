// "Generate the whole video" for a project (niche-aware or made by the original pipeline).
// 1. Every shot that has no clip yet is generated one after another through the provider layer (Veoframe first).
//    Shots that continue the previous one start from its last frame (see runShotVideo).
// 2. The shot clips plus each shot's narration become a plan, which the assembly stage narrates (real TTS),
//    captions, mixes, loudness-corrects and QA-checks. Short = 9:16, long = 16:9 with chapters.
// 3. The final file, QA result, thumbnails and stage are stored on the project; with auto-publish on, the upload is queued.
// Re-running skips shots that already have a clip, so a failed run resumes where it stopped.

import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { enqueue } from "./jobs/queue";
import { query } from "./db";
import { logger } from "./log";
import { makeThumbnail } from "./media/clips";
import type { SeoPackage } from "./niche/types";
import { makeImage } from "./images";
import { STORAGE_ROOT, runShotVideo } from "./pipeline";
import { buildEditPlan } from "./edit/director";
import { critiqueEditPlan } from "./edit/critique";
import type { EditReview } from "./edit/types";
import { buildShort, runPaths } from "./shorts/assemble";
import { isPlayableVideo } from "./shorts/ffmpeg";
import { narrate } from "./shorts/narrate";
import { isLanguage, narratorVoice, voiceFor, type LanguageId } from "./providers/voices";
import { compositeOverlays } from "./edit/hyperframes/composite";
import { ShortPlan, dims, parsePlan } from "./shorts/plan";
import { qaShort } from "./shorts/qa";

const SHORTS_ROOT = path.join(process.cwd(), "storage");

async function setStage(projectId: number, stage: string, error: string | null = null) {
  await query("UPDATE projects SET stage = ?, error_message = ? WHERE id = ?", [stage, error, projectId]);
}

function json<T>(raw: unknown): T | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Builds the assembly plan from the project's shots. Throws a readable error when the project cannot be assembled. */
export function planFromProject(project: any, shots: any[]): ShortPlan {
  const long = project.format === "long";
  if (shots.length < 2) throw new Error("A video needs at least 2 shots.");
  if (!long && shots.length > 8) throw new Error("A Short can have at most 8 shots. Reduce the shot count or make a long video.");
  // Urdu and Hindi: the spoken line is in the language's script, captions use its Roman words, and each speaker has a voice.
  const lang: LanguageId = isLanguage(project.language) ? project.language : "en";
  const characters = (json<{ anchors?: { key: string; kind: string; gender?: "male" | "female" | "neutral" }[] }>(project.brief_json)?.anchors ?? [])
    .filter((a) => a.kind === "character")
    .map((a) => ({ key: a.key, gender: a.gender }));
  const clips = shots.map((s) => ({
    id: `shot-${s.shot_number}`,
    type: "ai_video" as const,
    seconds: Math.min(8, Math.max(2, Number(s.duration_seconds) || 8)),
    purpose: s.title || undefined,
    prompt: String(s.video_prompt || s.image_prompt || "").padEnd(40, " "),
    narration: String(s.voiceover || "").trim(),
    captionText: lang !== "en" && s.caption_text ? String(s.caption_text).trim() : undefined,
    voice: lang !== "en" ? voiceFor(lang, s.speaker, characters) : undefined,
  }));
  const total = clips.reduce((n, c) => n + c.seconds, 0);
  if (!long && total > 60) throw new Error(`The shots add up to ${total}s; a Short must be 60s or less.`);

  const brief = json<{ styleBible?: string }>(project.brief_json);
  const hook = json<{ type: string; line: string; visual: string }>(project.hook_json);
  const seo = json<SeoPackage>(project.seo_json);
  const firstLine = hook?.line || clips[0].narration.split(/(?<=[.!?])\s+/)[0] || shots[0].title || "Video";
  const title = String(project.chosen_title || project.title || shots[0].title || project.idea_prompt || "Video").replace(/\s+/g, " ").slice(0, 90).padEnd(5, ".");

  // Long-form chapters: one per beat (45-90 s each, above YouTube's 10 s minimum), titled by the beat's opening words.
  const chapters: { title: string; clipId: string }[] = [];
  if (long) {
    const seen = new Set<number>();
    for (const s of shots) {
      const beat = Number(s.beat_index);
      if (!beat || seen.has(beat)) continue;
      seen.add(beat);
      const words = String(s.voiceover || "").split(/\s+/).filter(Boolean).slice(0, 5).join(" ").replace(/[.,;:!?]+$/, "");
      chapters.push({ title: chapters.length === 0 ? "Intro" : words || `Part ${beat}`, clipId: `shot-${s.shot_number}` });
    }
  }

  return parsePlan({
    id: `project-${project.id}`,
    niche: project.niche || "project",
    topic: String(project.idea_prompt || title).slice(0, 300),
    title,
    flow: "veoframe",
    format: long ? "long" : "short",
    aspect: long ? "16:9" : "9:16",
    targetSeconds: Math.max(15, total),
    hook: { type: hook?.type || "statement", line: firstLine, visual: hook?.visual || String(shots[0].title || "opening shot") },
    styleBible: brief?.styleBible && brief.styleBible.length >= 20 ? brief.styleBible : "Cinematic, photoreal, one continuous look across all shots.",
    clips,
    chapters: chapters.length >= 3 ? chapters : [],
    // The voice is a Microsoft neural voice (EDGE_VOICE, default Andrew), identical on every clip and every video.
    narration: { mode: clips.some((c) => c.narration) ? "tts" : "none", voice: narratorVoice(lang) },
    description: seo?.description || "",
    tags: seo?.tags || [],
  });
}

/**
 * Two thumbnail variants (A: white text bottom, B: yellow text top) at 1280x720. Long videos get a purpose-made
 * hero image from the anchors; a Short reuses its hook image. The first SEO thumbnail concept supplies the words.
 */
export async function makeProjectThumbnails(projectId: number, project: any, shots: any[]): Promise<{ variant: "A" | "B"; path: string }[]> {
  const seo = json<SeoPackage>(project.seo_json);
  const brief = json<{ styleBible?: string; anchors?: { key: string; name: string }[] }>(project.brief_json);
  const dir = path.join(SHORTS_ROOT, "shorts", `project-${projectId}`, "thumbs");
  fs.mkdirSync(dir, { recursive: true });
  const concepts = seo?.thumbnailConcepts?.length ? seo.thumbnailConcepts : [{ focalSubject: String(shots[0]?.title || "the subject"), words: "" }];
  const mainWords = (seo?.mainKeyword || project.chosen_title || "Watch this").split(/\s+/).slice(0, 4).join(" ");

  let heroPath = shots[0]?.image_path ? path.join(STORAGE_ROOT, shots[0].image_path) : "";
  if (project.format === "long") {
    try {
      const c = concepts[0];
      const anchors = await query<any[]>("SELECT image_path FROM anchors WHERE project_id = ? AND image_path IS NOT NULL", [projectId]);
      const refs = anchors.map((a) => path.join(STORAGE_ROOT, a.image_path)).slice(0, 3);
      const prompt = `${brief?.styleBible || "Photoreal cinematic."} ${c.focalSubject}. One focal subject, high contrast, dramatic light, uncluttered, horizontal 16:9 composition. No text, no letters, no logos.`;
      const made = await makeImage({ prompt, size: "1536x1024", refs, provider: project.image_provider, fallback: !!project.image_fallback });
      heroPath = path.join(dir, "hero.png");
      fs.writeFileSync(heroPath, made.buffer);
    } catch (e) {
      logger.warn("thumbnail hero image failed; using the first shot image", { error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (!heroPath || !fs.existsSync(heroPath)) return [];

  const out: { variant: "A" | "B"; path: string }[] = [];
  for (const [i, variant] of (["A", "B"] as const).entries()) {
    const words = (concepts[i]?.words || concepts[0]?.words || mainWords).trim().split(/\s+/).slice(0, 5).join(" ") || mainWords;
    const file = path.join(dir, `thumb-${variant}.png`);
    await makeThumbnail({ image: heroPath, text: words, out: file, variant, workDir: dir });
    out.push({ variant, path: path.relative(SHORTS_ROOT, file).replace(/\\/g, "/") });
  }
  return out;
}

/** Builds and critiques the edit plan (director + critique) from the shots, the narration timings and the facts. */
export function editPlanFor(project: any, shots: any[], plan: ShortPlan, workDir: string) {
  const words = plan.clips.map((c) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(workDir, `words-${c.id}.json`), "utf-8"));
    } catch {
      return [];
    }
  });
  const brief = json<{ tone?: string }>(project.brief_json);
  const facts = json<{ claim: string; source?: string }[]>(project.facts_json) || [];
  const built = buildEditPlan({
    shots,
    words,
    format: plan.format,
    niche: project.niche,
    facts: Array.isArray(facts) ? facts : [],
    tone: brief?.tone || project.tone || "",
    clipSeconds: plan.clips.map((c) => c.seconds),
    narrationDelay: plan.narration.delay,
  });
  return critiqueEditPlan(built);
}

/** A failure that is the network's fault and likely to pass: a reset or timed-out connection, a name that did not resolve. */
export const isTransientNetworkError = (e: unknown): boolean =>
  /ERR_CONNECTION_(RESET|CLOSED|REFUSED|TIMED_OUT)|ERR_NETWORK|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_TIMED_OUT|ERR_PROXY|ERR_TUNNEL|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|socket hang up|fetch failed|Timeout \d+ms exceeded/i.test(
    e instanceof Error ? e.message : String(e)
  );

/**
 * Waits (seconds) between tries of a step that failed on the network: 30 s, 1, 2, 4, 8 minutes, then every 10 minutes, about
 * 4 hours in all. A real outage on this PC lasted over 35 minutes while nobody was there, and a shorter wait failed the video.
 */
export const NETWORK_WAITS_S = [30, 60, 120, 240, 480, ...Array.from({ length: 22 }, () => 600)];

/** Runs a step and, when it fails because the network blinked, waits and tries again instead of failing the whole video. */
export async function retryTransient<T>(fn: () => Promise<T>, onWait: (attempt: number, waitS: number, err: unknown) => void = () => {}, waits: number[] = NETWORK_WAITS_S, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransientNetworkError(e) || attempt >= waits.length) throw e;
      onWait(attempt + 1, waits[attempt], e);
      await sleep(waits[attempt] * 1000);
    }
  }
}

export async function runProjectVideo(projectId: number): Promise<{ file: string; qaPassed: boolean }> {
  try {
    const [project] = await query<any[]>("SELECT * FROM projects WHERE id = ?", [projectId]);
    if (!project) throw new Error(`Project ${projectId} not found`);
    let shots = await query<any[]>("SELECT * FROM shots WHERE project_id = ? ORDER BY shot_number", [projectId]);
    if (!shots.length) throw new Error("This project has no shots yet.");
    const notReady = shots.filter((s) => !s.image_path || !s.video_prompt);
    if (notReady.length) throw new Error(`Shots ${notReady.map((s) => s.shot_number).join(", ")} are not ready (image or video prompt missing).`);

    // Fail early on a plan that cannot be assembled, before any clip is generated.
    planFromProject(project, shots);

    for (const shot of shots) {
      // A clip file is reused only when it really plays: a download that was cut short (a dropped connection, a restart) leaves
      // a file that exists but cannot be opened ("moov atom not found"), and the assembly would fail on it.
      if (shot.video_path && (await isPlayableVideo(path.join(STORAGE_ROOT, shot.video_path)))) continue;
      await setStage(projectId, `clip ${shot.shot_number} of ${shots.length}`);
      await retryTransient(
        () => runShotVideo(projectId, shot.id),
        (attempt, waitS, err) => logger.warn("clip step hit a network error; waiting before trying again", { projectId, shot: shot.shot_number, attempt, waitS, error: String((err as Error)?.message ?? err).slice(0, 160) })
      );
    }

    shots = await query<any[]>("SELECT * FROM shots WHERE project_id = ? ORDER BY shot_number", [projectId]);
    const plan = planFromProject(project, shots);
    const P = runPaths(SHORTS_ROOT, plan.id);
    for (const s of shots) fs.copyFileSync(path.join(STORAGE_ROOT, s.video_path), path.join(P.clips, `shot-${s.shot_number}.mp4`));

    await setStage(projectId, "narration");
    // Narration costs a speech call and a word-timing call per shot, so it is reused when the text and voice are unchanged
    // (rebuilding a video after an edit-pass change then spends nothing).
    const narrHash = createHash("sha1").update(JSON.stringify([plan.narration.voice, plan.narration.speed, plan.clips.map((c) => [c.id, c.narration, c.voice ?? "", c.captionText ?? ""])])).digest("hex");
    const narrHashFile = path.join(P.work, "narration-hash.json");
    let sameNarration = false;
    try {
      sameNarration = JSON.parse(fs.readFileSync(narrHashFile, "utf-8")).hash === narrHash;
    } catch {
      sameNarration = false;
    }
    const spoken = await narrate(SHORTS_ROOT, plan, { force: !sameNarration });
    try {
      fs.writeFileSync(narrHashFile, JSON.stringify({ hash: narrHash }));
    } catch {
      /* the hash is an optimisation only */
    }
    const tooLong = spoken.filter((r) => !r.fits).map((r) => r.clipId);

    await setStage(projectId, "assembling");
    let review: EditReview | null = null;
    try {
      const edited = editPlanFor(project, shots, plan, P.work);
      plan.edit = edited.plan;
      review = edited.review;
      try {
        await query("UPDATE projects SET edit_json = ?, edit_review_json = ? WHERE id = ?", [JSON.stringify(edited.plan), JSON.stringify(edited.review), projectId]);
      } catch (e) {
        logger.warn("could not save the edit plan (edit_json columns missing?)", { projectId, error: e instanceof Error ? e.message : String(e) });
      }
    } catch (e) {
      logger.warn("edit plan failed; assembling without it", { projectId, error: e instanceof Error ? e.message : String(e) });
    }
    const built = await buildShort(SHORTS_ROOT, plan);

    // Long-form videos get graphics cards (chapters, stats, end card) from a HyperFrames overlay pass.
    // It never breaks the build: on any failure the video stays as assembled and the reason is kept as a warning.
    if (project.format === "long" && plan.edit) {
      await setStage(projectId, "graphics");
      const d = dims(plan.aspect);
      const facts = (json<{ text: string; value?: string }[]>(project.facts_json) ?? []).map((f) => ({ text: f.text, value: f.value }));
      const o = await compositeOverlays({ videoFile: built.file, edit: plan.edit, width: d.W, height: d.H, fps: 30, totalSeconds: plan.edit.totalSeconds, workDir: P.work, facts });
      built.warnings.push(...o.warnings.map((w) => `graphics: ${w}`));
      if (o.applied) built.warnings.push(`graphics: ${o.cards} card(s) added in ${Math.round(o.ms / 1000)} s`);
    }

    await setStage(projectId, "qa");
    const qa = await qaShort(built.file, plan, path.join(P.runDir, "frames"), { edit: plan.edit ?? null, ass: built.ass ?? null, words: built.words ?? null });
    const report = { checks: qa.checks, loudness: qa.loudness, frames: qa.frames, warnings: built.warnings, narrationTooLong: tooLong, editReview: review };
    await query("UPDATE projects SET final_video_path = ?, qa_status = ?, qa_report = ?, chapters = ? WHERE id = ?", [
      path.relative(SHORTS_ROOT, built.file).replace(/\\/g, "/"), // "shorts/<id>/final/<file>.mp4", served at /api/media/...
      qa.ok ? "passed" : "failed",
      JSON.stringify(report),
      plan.chapters.length ? JSON.stringify(plan.chapters) : null,
      projectId,
    ]);

    // Thumbnails are a bonus: a failure here must not fail the video.
    await setStage(projectId, "thumbnails");
    try {
      const thumbs = await makeProjectThumbnails(projectId, project, shots);
      if (thumbs.length) await query("UPDATE projects SET thumbnails_json = ?, thumbnail_path = ? WHERE id = ?", [JSON.stringify(thumbs), thumbs[0].path, projectId]);
    } catch (e) {
      logger.warn("thumbnails failed", { projectId, error: e instanceof Error ? e.message : String(e) });
    }

    await setStage(projectId, qa.ok ? "video ready" : "video ready, QA flagged problems");
    logger.info("project video built", { projectId, file: built.file, qaPassed: qa.ok });

    // Auto-publish only a video that passed QA; otherwise it waits for a person to look at it.
    if (project.auto_publish && qa.ok) {
      await enqueue("publish.upload", { projectId, privacy: "private" }, { dedupeKey: `publish:${projectId}:${Date.now()}` });
    }
    return { file: built.file, qaPassed: qa.ok };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("project video failed", { projectId, error: message });
    await setStage(projectId, "video failed", message.slice(0, 500));
    throw err;
  }
}
