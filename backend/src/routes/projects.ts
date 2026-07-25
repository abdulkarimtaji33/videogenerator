import { Router } from "express";
import { query } from "../db";
import { runPipeline, runShotImage, runShotVideo, runShotDuration } from "../pipeline";
import { asyncHandler } from "../asyncHandler";
import { AppError } from "../errors";
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

    const result = await query<any>(
      "INSERT INTO projects (idea_prompt, shot_count, shot_duration_seconds, status) VALUES (?, ?, ?, 'pending')",
      [idea, shotCount, shotDurationSeconds]
    );
    const projectId = result.insertId as number;

    // Fire-and-forget: pipeline runs in the background on this same Node process
    // and updates the DB as it progresses; the client polls GET /api/projects/:id.
    // Errors are caught and persisted to the project row by runPipeline itself,
    // this catch is only a last-resort safety net against a truly unexpected throw.
    runPipeline(projectId).catch((err) => {
      console.error(`Pipeline for project ${projectId} crashed unexpectedly:`, err);
    });

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

    res.json({ ...project, shots });
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

    runShotImage(projectId, shotId).catch((err) => {
      console.error(`Image regeneration for shot ${shotId} crashed unexpectedly:`, err);
    });

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

    // Fire-and-forget, same pattern as project creation: the client polls
    // GET /api/projects/:id and watches this shot's status/video_path update.
    runShotVideo(projectId, shotId).catch((err) => {
      console.error(`Video generation for shot ${shotId} crashed unexpectedly:`, err);
    });

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

    runShotDuration(projectId, shotId, durationSeconds).catch((err) => {
      console.error(`Duration update for shot ${shotId} crashed unexpectedly:`, err);
    });

    res.status(202).json({ ok: true });
  })
);
