import { Router } from "express";
import { query } from "../db";
import { runPipeline, runShotImage, runShotVideo } from "../pipeline";
import { asyncHandler } from "../asyncHandler";
import { AppError } from "../errors";

export const projectsRouter = Router();

projectsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const idea: string = typeof req.body?.idea === "string" ? req.body.idea.trim() : "";
    const shotCountRaw = req.body?.shotCount;
    const shotCount = Number.isFinite(shotCountRaw)
      ? Math.max(1, Math.min(20, Math.trunc(shotCountRaw)))
      : 5;

    if (!idea) {
      throw new AppError("idea is required", 400);
    }
    if (idea.length > 4000) {
      throw new AppError("idea must be 4000 characters or fewer", 400);
    }

    const result = await query<any>(
      "INSERT INTO projects (idea_prompt, shot_count, status) VALUES (?, ?, 'pending')",
      [idea, shotCount]
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
