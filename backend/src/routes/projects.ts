import { Router } from "express";
import { query } from "../db";
import { enqueue } from "../jobs/queue";
import { asyncHandler } from "../asyncHandler";
import { AppError } from "../errors";
import { IMAGE_PROVIDER_IDS } from "../images/settings";
import { isLanguage } from "../providers/voices";
import {
  MAX_IMAGE_REGENERATIONS,
  DEFAULT_SHOT_DURATION_SECONDS,
  MIN_SHOT_DURATION_SECONDS,
  MAX_SHOT_DURATION_SECONDS,
} from "../types";

export const projectsRouter = Router();

projectsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const idea: string = typeof req.body?.idea === "string" ? req.body.idea.trim() : "";
    const shotCountRaw = req.body?.shotCount;
    const shotCount = Number.isFinite(shotCountRaw)
      ? Math.max(1, Math.min(20, Math.trunc(shotCountRaw)))
      : 5;
    const shotDurationRaw = req.body?.shotDurationSeconds;
    const shotDurationSeconds = Number.isFinite(shotDurationRaw)
      ? Math.max(MIN_SHOT_DURATION_SECONDS, Math.min(MAX_SHOT_DURATION_SECONDS, Math.trunc(shotDurationRaw)))
      : DEFAULT_SHOT_DURATION_SECONDS;

    if (!idea) {
      throw new AppError("idea is required", 400);
    }
    if (idea.length > 4000) {
      throw new AppError("idea must be 4000 characters or fewer", 400);
    }

    // New-style request (niche present): the niche-aware pipeline. Old-style (no niche): the original character flow.
    const niche: string | null = typeof req.body?.niche === "string" && req.body.niche.trim() ? req.body.niche.trim().slice(0, 48) : null;
    let result;
    if (niche) {
      const format = req.body?.format === "long" ? "long" : "short";
      const lenRaw = Number(req.body?.lengthSeconds);
      const lengthSeconds = Number.isFinite(lenRaw)
        ? Math.trunc(Math.max(format === "short" ? 15 : 180, Math.min(format === "short" ? 60 : 1800, lenRaw)))
        : format === "short"
          ? 32
          : 600;
      const channelId = Number.isInteger(req.body?.channelId) ? req.body.channelId : null;
      result = await query<any>(
        `INSERT INTO projects (idea_prompt, shot_count, shot_duration_seconds, status, niche, format, aspect, length_seconds, review_enabled, auto_publish, channel_id, run_mode)
         VALUES (?, ?, 8, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          idea,
          Math.ceil(lengthSeconds / 8),
          niche,
          format,
          format === "short" ? "9:16" : "16:9",
          lengthSeconds,
          req.body?.reviewEnabled === false ? 0 : 1,
          req.body?.autoPublish === true ? 1 : 0,
          channelId,
          req.body?.mode === "plan" ? "plan" : "full",
        ]
      );
    } else {
      result = await query<any>(
        "INSERT INTO projects (idea_prompt, shot_count, shot_duration_seconds, status) VALUES (?, ?, ?, 'pending')",
        [idea, shotCount, shotDurationSeconds]
      );
    }
    const projectId = result.insertId as number;

    // Image model for this project (null = the saved default, self-hosted FLUX) and whether OpenAI may stand in when it is down.
    const imageProvider = IMAGE_PROVIDER_IDS.includes(req.body?.imageProvider) ? (req.body.imageProvider as string) : null;
    await query("UPDATE projects SET image_provider = ?, image_fallback = ? WHERE id = ?", [imageProvider, req.body?.imageFallback === true ? 1 : 0, projectId]);
    // Spoken language of the video: English (default), Urdu or Hindi. Captions of Urdu and Hindi videos are Roman letters.
    if (isLanguage(req.body?.language) && req.body.language !== "en") await query("UPDATE projects SET language = ? WHERE id = ?", [req.body.language, projectId]);

    // The pipeline runs as a persistent queued job: it survives a restart, retries with backoff, and
    // updates the DB as it progresses; the client polls GET /api/projects/:id.
    await enqueue("project.pipeline", { projectId }, { dedupeKey: `pipeline:${projectId}` });

    res.status(201).json({ id: projectId });
  })
);

projectsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      throw new AppError("invalid project id", 400);
    }

    const [project] = await query<any[]>("SELECT * FROM projects WHERE id = ?", [projectId]);
    if (!project) {
      throw new AppError("project not found", 404);
    }

    const shots = await query<any[]>("SELECT * FROM shots WHERE project_id = ? ORDER BY shot_number ASC", [
      projectId,
    ]);
    const anchors = await query<any[]>("SELECT * FROM anchors WHERE project_id = ? ORDER BY id ASC", [projectId]);

    res.json(projectView(project, shots, anchors));
  })
);

function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** The raw project row plus the niche pipeline's JSON columns parsed into camelCase objects (null on old projects). */
export function projectView(project: any, shots: any[], anchors: any[]) {
  return {
    ...project,
    brief: parseJson(project.brief_json),
    facts: parseJson(project.facts_json),
    seo: parseJson(project.seo_json),
    hook: parseJson(project.hook_json),
    script: parseJson(project.script_json),
    review: parseJson(project.review_json),
    costEstimate: parseJson(project.cost_estimate_json),
    thumbnails: parseJson(project.thumbnails_json),
    imageProvider: project.image_provider ?? null,
    imageFallback: !!project.image_fallback,
    edit: parseJson(project.edit_json),
    editReview: parseJson(project.edit_review_json),
    anchors: anchors.map((a) => ({
      key: a.key,
      kind: a.kind,
      name: a.name,
      lockedFeatures: a.locked_features,
      imagePath: a.image_path,
      status: a.status,
      imageProviderUsed: a.image_provider_used ?? null,
      imageMs: a.image_ms ?? null,
    })),
    shots: shots.map((s) => ({ ...s, anchor_keys: parseJson<string[]>(s.anchor_keys) ?? [], imageProviderUsed: s.image_provider_used ?? null, imageMs: s.image_ms ?? null })),
  };
}

// Re-run the plan from the start (all stages are cheap compared with the clips; the clips of the old plan are dropped).
projectsRouter.post(
  "/:id/replan",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) throw new AppError("invalid project id", 400);
    const [project] = await query<any[]>("SELECT id, niche FROM projects WHERE id = ?", [projectId]);
    if (!project) throw new AppError("project not found", 404);
    if (!project.niche) throw new AppError("This project was made by the original pipeline and cannot be re-planned.", 400);
    await query("UPDATE projects SET status = 'pending', stage = 'queued', error_message = NULL, final_video_path = NULL WHERE id = ?", [projectId]);
    await enqueue("project.pipeline", { projectId }, { dedupeKey: `pipeline:${projectId}:${Date.now()}` });
    res.status(202).json({ ok: true });
  })
);

// Choose (or edit) the title used for the upload.
projectsRouter.patch(
  "/:id/seo",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) throw new AppError("invalid project id", 400);
    const chosen = typeof req.body?.chosenTitle === "string" ? req.body.chosenTitle.trim() : "";
    if (chosen.length < 5 || chosen.length > 100) throw new AppError("chosenTitle must be 5 to 100 characters", 400);
    const [project] = await query<any[]>("SELECT seo_json FROM projects WHERE id = ?", [projectId]);
    if (!project) throw new AppError("project not found", 404);
    const seo = parseJson<any>(project.seo_json);
    if (!seo) throw new AppError("This project has no SEO package yet.", 400);
    seo.chosenTitle = chosen;
    await query("UPDATE projects SET seo_json = ?, chosen_title = ?, title = ? WHERE id = ?", [JSON.stringify(seo), chosen, chosen, projectId]);
    res.json({ ok: true, chosenTitle: chosen });
  })
);

// Pick thumbnail variant A or B as the one used for the upload.
projectsRouter.post(
  "/:id/thumbnail",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) throw new AppError("invalid project id", 400);
    const variant = req.body?.variant === "B" ? "B" : "A";
    const [project] = await query<any[]>("SELECT thumbnails_json FROM projects WHERE id = ?", [projectId]);
    if (!project) throw new AppError("project not found", 404);
    const list = parseJson<{ variant: string; path: string }[]>(project.thumbnails_json) ?? [];
    const pick = list.find((t) => t.variant === variant);
    if (!pick) throw new AppError(`Thumbnail ${variant} does not exist yet.`, 400);
    await query("UPDATE projects SET thumbnail_path = ? WHERE id = ?", [pick.path, projectId]);
    res.json({ ok: true, variant, path: pick.path });
  })
);

projectsRouter.post(
  "/:id/shots/:shotId/image",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    const shotId = Number(req.params.shotId);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(shotId) || shotId <= 0) {
      throw new AppError("invalid project or shot id", 400);
    }

    const [shot] = await query<any[]>("SELECT * FROM shots WHERE id = ? AND project_id = ?", [
      shotId,
      projectId,
    ]);
    if (!shot) {
      throw new AppError("shot not found", 404);
    }
    if (!shot.image_prompt) {
      throw new AppError("shot has no image prompt yet", 400);
    }
    if (shot.image_regenerations >= MAX_IMAGE_REGENERATIONS) {
      throw new AppError(`This shot's image has already been regenerated the maximum of ${MAX_IMAGE_REGENERATIONS} times`, 400);
    }

    await enqueue("shot.image", { projectId, shotId });

    res.status(202).json({ ok: true });
  })
);

// One click: generate every missing clip (through the provider order, Veoframe first) and assemble the finished
// video with narration, captions and QA. Re-running resumes: shots that already have a clip are skipped.
projectsRouter.post(
  "/:id/video",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) throw new AppError("invalid project id", 400);
    const [project] = await query<any[]>("SELECT id, status FROM projects WHERE id = ?", [projectId]);
    if (!project) throw new AppError("project not found", 404);
    if (project.status !== "done") throw new AppError("The story and shot images are not finished yet.", 400);
    await query("UPDATE projects SET stage = 'queued for video', error_message = NULL WHERE id = ?", [projectId]);
    await enqueue("project.video", { projectId }, { dedupeKey: `video:${projectId}:${Date.now()}` });
    res.status(202).json({ ok: true });
  })
);

projectsRouter.post(
  "/:id/shots/:shotId/video",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    const shotId = Number(req.params.shotId);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(shotId) || shotId <= 0) {
      throw new AppError("invalid project or shot id", 400);
    }

    const [shot] = await query<any[]>("SELECT * FROM shots WHERE id = ? AND project_id = ?", [
      shotId,
      projectId,
    ]);
    if (!shot) {
      throw new AppError("shot not found", 404);
    }
    if (!shot.image_path || !shot.video_prompt) {
      throw new AppError("shot is not ready for video generation yet", 400);
    }

    // Queued like project creation: the client polls GET /api/projects/:id and watches this shot update.
    await enqueue("shot.video", { projectId, shotId });

    res.status(202).json({ ok: true });
  })
);

projectsRouter.patch(
  "/:id/shots/:shotId/duration",
  asyncHandler(async (req, res) => {
    const projectId = Number(req.params.id);
    const shotId = Number(req.params.shotId);
    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(shotId) || shotId <= 0) {
      throw new AppError("invalid project or shot id", 400);
    }

    const durationRaw = req.body?.durationSeconds;
    const durationSeconds = Number.isFinite(durationRaw) ? Math.trunc(durationRaw) : NaN;
    if (
      !Number.isInteger(durationSeconds) ||
      durationSeconds < MIN_SHOT_DURATION_SECONDS ||
      durationSeconds > MAX_SHOT_DURATION_SECONDS
    ) {
      throw new AppError(
        `durationSeconds must be an integer between ${MIN_SHOT_DURATION_SECONDS} and ${MAX_SHOT_DURATION_SECONDS}`,
        400
      );
    }

    const [shot] = await query<any[]>("SELECT * FROM shots WHERE id = ? AND project_id = ?", [
      shotId,
      projectId,
    ]);
    if (!shot) {
      throw new AppError("shot not found", 404);
    }
    if (!shot.image_prompt) {
      throw new AppError("shot has no image prompt yet", 400);
    }

    await enqueue("shot.duration", { projectId, shotId, durationSeconds });

    res.status(202).json({ ok: true });
  })
);
