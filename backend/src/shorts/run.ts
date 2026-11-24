// Runs one Short project through its stages and records progress in the database:
//   planned -> assets (clips, narration) -> assembling -> qa -> awaiting_approval | uploading | failed
// Clip generation for browser flows (Google Flow, Veoframe) waits for the worker to save each file, so a
// run can pause here until clips exist; it resumes where it left off because finished clips are kept.
import fs from "fs";
import path from "path";
import { query } from "../db";
import { logger } from "../log";
import { clipOutput, writeInstructions } from "../providers/browserWorker";
import { instructionsFor } from "../providers/instructions";
import { generateClipWithFallback } from "../providers/clips";
import { policyCheck, uniquenessCheck } from "../qa/policy";
import { getSetting } from "../settings";
import { buildShort, runPaths } from "./assemble";
import { narrate } from "./narrate";
import { ShortPlan, parsePlan } from "./plan";
import { qaShort } from "./qa";

export const STORAGE_ROOT = path.join(process.cwd(), "storage");

export type Stage = "draft" | "planned" | "assets" | "assembling" | "qa" | "awaiting_approval" | "uploading" | "scheduled" | "published" | "failed" | "rejected";

export async function setStage(projectId: number, stage: Stage, extra: { error?: string | null } = {}) {
  await query("UPDATE projects SET stage = ?, error_message = ? WHERE id = ?", [stage, extra.error ?? null, projectId]);
}

export interface RunDeps {
  clipOptions?: Parameters<typeof generateClipWithFallback>[1];
  narrateOptions?: Parameters<typeof narrate>[2];
  /** Called when a project reaches awaiting_approval (email notification). */
  onAwaitingApproval?: (projectId: number, plan: ShortPlan) => Promise<void>;
  /** Called when QA passed and the channel publishes automatically. */
  onAutoPublish?: (projectId: number) => Promise<void>;
}

export async function runShortProject(projectId: number, deps: RunDeps = {}): Promise<{ stage: Stage; qaPassed: boolean }> {
  const [proj] = await query<any[]>("SELECT * FROM projects WHERE id = ?", [projectId]);
  if (!proj) throw new Error(`Project ${projectId} not found`);
  if (!proj.plan_json) throw new Error(`Project ${projectId} has no plan`);
  const plan = parsePlan(JSON.parse(proj.plan_json));
  const P = runPaths(STORAGE_ROOT, plan.id);

  try {
    await setStage(projectId, "assets");
    await query("UPDATE projects SET status = 'shots' WHERE id = ?", [projectId]);
    const shots = await query<any[]>("SELECT * FROM shots WHERE project_id = ? ORDER BY shot_number", [projectId]);
    const configured = await getSetting("provider_order");
    const order = [plan.flow, ...configured.filter((x) => x !== plan.flow)];

    // Browser flows (Google Flow, Veoframe) are driven from a job pack; write the step-by-step instructions next to it.
    if (plan.flow === "google-flow" || plan.flow === "veoframe") writeInstructions(P.runDir, plan.flow, instructionsFor(plan.flow, plan));

    for (let i = 0; i < plan.clips.length; i++) {
      const clip = plan.clips[i];
      if (clip.type !== "ai_video") {
        const shotOther = shots[i];
        if (shotOther) await query("UPDATE shots SET status = 'done', clip_type = ? WHERE id = ?", [clip.type, shotOther.id]);
        continue;
      }
      const shot = shots[i];
      const out = clipOutput(P.runDir, clip.id);
      let provider: string | null = shot?.provider ?? null;
      if (!fs.existsSync(out) || fs.statSync(out).size < 50_000) {
        if (shot) await query("UPDATE shots SET status = 'video', attempt_count = attempt_count + 1 WHERE id = ?", [shot.id]);
        const r = await generateClipWithFallback(
          { planId: plan.id, clipId: clip.id, prompt: clip.prompt, seconds: clip.seconds, aspect: "9:16", referenceImage: clip.referenceImage, runDir: P.runDir },
          { order, ...(deps.clipOptions ?? {}) }
        );
        provider = r.provider;
        logger.info("clip generated", { projectId, clip: clip.id, provider, attempts: r.attempts });
      }
      if (shot) {
        await query("UPDATE shots SET status = 'done', video_path = ?, provider = ? WHERE id = ?", [path.relative(STORAGE_ROOT, out).replace(/\\/g, "/"), provider, shot.id]);
      }
    }

    const narr = await narrate(STORAGE_ROOT, plan, deps.narrateOptions);
    const tooLong = narr.filter((n) => !n.fits);
    if (tooLong.length) throw new Error(`Narration does not fit its clip: ${tooLong.map((n) => `${n.clipId} (${n.seconds.toFixed(1)}s > ${n.room.toFixed(1)}s)`).join(", ")}`);

    await setStage(projectId, "assembling");
    const built = await buildShort(STORAGE_ROOT, plan);
    await query("UPDATE projects SET final_video_path = ? WHERE id = ?", [path.relative(STORAGE_ROOT, built.file).replace(/\\/g, "/"), projectId]);

    await setStage(projectId, "qa");
    const qa = await qaShort(built.file, plan, path.join(P.runDir, "frames"));
    let banned: string[] = [];
    if (proj.channel_id) {
      const [ch] = await query<any[]>("SELECT style_guide FROM channels WHERE id = ?", [proj.channel_id]);
      try {
        banned = JSON.parse(ch?.style_guide || "{}").banned_topics || [];
      } catch {
        banned = [];
      }
    }
    const policy = policyCheck(plan, { bannedTopics: banned });
    const uniq = await uniquenessCheck(plan, proj.channel_id ?? null, projectId);
    const passed = qa.ok && !policy.some((f) => f.level === "error") && !uniq.findings.some((f) => f.level === "error");
    const report = {
      qa: { ok: qa.ok, checks: qa.checks, loudness: qa.loudness, info: qa.info },
      frames: qa.frames.map((f) => path.relative(STORAGE_ROOT, f).replace(/\\/g, "/")),
      policy,
      uniqueness: uniq,
      warnings: built.warnings,
      narration: narr,
    };
    await query("UPDATE projects SET qa_status = ?, qa_report = ?, status = 'done' WHERE id = ?", [passed ? "passed" : "failed", JSON.stringify(report), projectId]);

    if (!passed) {
      await setStage(projectId, "failed", { error: "Quality or policy checks failed; see the QA report." });
      return { stage: "failed", qaPassed: false };
    }
    if (proj.publish_mode === "auto") {
      await setStage(projectId, "uploading");
      if (deps.onAutoPublish) await deps.onAutoPublish(projectId);
      return { stage: "uploading", qaPassed: true };
    }
    await setStage(projectId, "awaiting_approval");
    if (deps.onAwaitingApproval) await deps.onAwaitingApproval(projectId, plan);
    return { stage: "awaiting_approval", qaPassed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setStage(projectId, "failed", { error: message });
    await query("UPDATE projects SET status = 'error' WHERE id = ?", [projectId]);
    throw err;
  }
}
