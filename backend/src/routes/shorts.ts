// Channel pipeline routes for Shorts projects. Mounted at /api/projects before the original router, so the
// fixed paths below (/import, /review-inbox) win over the original GET /:id.
import { Router } from "express";
import { asyncHandler } from "../asyncHandler";
import { query } from "../db";
import { AppError } from "../errors";
import { enqueue } from "../jobs/queue";
import { parsePlan, ShortPlan } from "../shorts/plan";
import { reviewPlan } from "../shorts/review";
import { intParam, jsonOr } from "./util";

export const shortsRouter = Router();

const present = (p: any) => ({
  id: p.id,
  title: p.title,
  format: p.format,
  stage: p.stage,
  qaStatus: p.qa_status,
  channelId: p.channel_id,
  channelName: p.channel_name ?? null,
  language: p.language,
  publishMode: p.publish_mode,
  publishAt: p.publish_at,
  finalVideoPath: p.final_video_path,
  thumbnailPath: p.thumbnail_path,
  error: p.error_message,
  createdAt: p.created_at,
});

shortsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const where = ["p.plan_json IS NOT NULL"];
    const args: any[] = [];
    for (const [q, col] of [["stage", "p.stage"], ["format", "p.format"]] as const) {
      if (req.query[q]) {
        where.push(`${col} = ?`);
        args.push(String(req.query[q]));
      }
    }
    if (req.query.channelId) {
      where.push("p.channel_id = ?");
      args.push(intParam(req.query.channelId, "channelId"));
    }
    const rows = await query<any[]>(
      `SELECT p.*, c.name AS channel_name FROM projects p LEFT JOIN channels c ON c.id = p.channel_id WHERE ${where.join(" AND ")} ORDER BY p.id DESC LIMIT 200`,
      args
    );
    res.json(rows.map(present));
  })
);

shortsRouter.get(
  "/review-inbox",
  asyncHandler(async (_req, res) => {
    const rows = await query<any[]>("SELECT p.*, c.name AS channel_name FROM projects p LEFT JOIN channels c ON c.id = p.channel_id WHERE p.stage = 'awaiting_approval' ORDER BY p.id");
    res.json(rows.map(present));
  })
);

shortsRouter.post(
  "/import",
  asyncHandler(async (req, res) => {
    const { plan: rawPlan, channelId, topicId, autoStart = true, force = false } = req.body || {};
    let plan: ShortPlan;
    try {
      plan = parsePlan(rawPlan);
    } catch (e) {
      throw new AppError(e instanceof Error ? e.message : "invalid plan", 400);
    }
    const review = reviewPlan(plan);
    if (review.errors > 0 && !force) {
      res.status(422).json({ error: "Plan review failed", findings: review.findings.filter((f) => f.level !== "ok") });
      return;
    }
    const [dup] = await query<any[]>("SELECT id FROM projects WHERE JSON_VALUE(plan_json, '$.id') = ?", [plan.id]);
    if (dup) throw new AppError(`a project with plan id '${plan.id}' already exists (#${dup.id})`, 409);

    let channel: any = null;
    if (channelId != null) {
      [channel] = await query<any[]>("SELECT * FROM channels WHERE id = ?", [intParam(channelId, "channelId")]);
      if (!channel) throw new AppError("channel not found", 404);
    }
    const audioMode = plan.narration.mode === "veo-native" ? "native" : "narrated";
    const r = await query<any>(
      `INSERT INTO projects (idea_prompt, shot_count, shot_duration_seconds, status, channel_id, topic_id, format, language, aspect, audio_mode, plan_source,
                             plan_json, title, description, tags, stage, publish_mode)
       VALUES (?, ?, 8, 'pending', ?, ?, 'short', ?, '9:16', ?, 'claude', ?, ?, ?, ?, 'planned', ?)`,
      [plan.topic, plan.clips.length, channel?.id ?? null, topicId ?? null, plan.language, audioMode, JSON.stringify(plan), plan.title, plan.description, JSON.stringify(plan.tags), channel?.publish_mode ?? "review"]
    );
    const projectId = Number(r.insertId);
    for (let i = 0; i < plan.clips.length; i++) {
      const c = plan.clips[i];
      await query(
        `INSERT INTO shots (project_id, shot_number, title, duration_seconds, description, voiceover, narration_text, video_prompt, clip_type, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai_video', 'pending')`,
        [projectId, i + 1, c.id, c.seconds, c.purpose ?? "", c.narration, c.narration, c.prompt]
      );
    }
    if (topicId != null) await query("UPDATE topics SET status = 'planned' WHERE id = ? AND status IN ('idea','approved')", [intParam(topicId, "topicId")]);
    let jobId: number | null = null;
    if (autoStart) jobId = await enqueue("short.run", { projectId }, { dedupeKey: `short:${projectId}` });
    res.status(201).json({ id: projectId, jobId, review: { errors: review.errors, warnings: review.warnings, hookScore: review.hook.score } });
  })
);

async function load(id: number) {
  const [p] = await query<any[]>("SELECT * FROM projects WHERE id = ? AND plan_json IS NOT NULL", [id]);
  if (!p) throw new AppError("project not found", 404);
  return p;
}

shortsRouter.get(
  "/:id/review",
  asyncHandler(async (req, res) => {
    const p = await load(intParam(req.params.id));
    const shots = await query<any[]>("SELECT * FROM shots WHERE project_id = ? ORDER BY shot_number", [p.id]);
    const uploads = await query<any[]>("SELECT * FROM uploads WHERE project_id = ? ORDER BY id DESC", [p.id]);
    res.json({
      ...present(p),
      plan: jsonOr(p.plan_json, null),
      qaReport: jsonOr(p.qa_report, null),
      shots,
      uploads: uploads.map((u) => ({ ...u, stats: jsonOr(u.stats, []) })),
    });
  })
);

shortsRouter.post(
  "/:id/approve",
  asyncHandler(async (req, res) => {
    const p = await load(intParam(req.params.id));
    if (p.stage !== "awaiting_approval") throw new AppError(`project is '${p.stage}'; only a video awaiting approval can be approved`, 409);
    if (p.qa_status !== "passed") throw new AppError("quality checks have not passed", 409);
    await query("UPDATE projects SET stage = 'uploading', error_message = NULL WHERE id = ?", [p.id]);
    const jobId = await enqueue("publish.upload", { projectId: p.id }, { dedupeKey: `publish:${p.id}:${Date.now()}`, maxAttempts: 2 });
    res.status(202).json({ ok: true, jobId });
  })
);

shortsRouter.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const p = await load(intParam(req.params.id));
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : "";
    if (!reason) throw new AppError("a reason is required", 400);
    if (!["awaiting_approval", "failed"].includes(p.stage)) throw new AppError(`project is '${p.stage}' and cannot be rejected now`, 409);
    await query("UPDATE projects SET stage = 'rejected', error_message = ? WHERE id = ?", [reason, p.id]);
    if (p.topic_id) await query("UPDATE topics SET status = 'rejected', reject_reason = ? WHERE id = ?", [reason, p.topic_id]);
    res.json({ ok: true });
  })
);

shortsRouter.post(
  "/:id/restart",
  asyncHandler(async (req, res) => {
    const p = await load(intParam(req.params.id));
    if (p.stage !== "failed") throw new AppError(`project is '${p.stage}'; only a failed project can be restarted`, 409);
    await query("UPDATE projects SET stage = 'planned', qa_status = 'pending', error_message = NULL WHERE id = ?", [p.id]);
    const jobId = await enqueue("short.run", { projectId: p.id }, { dedupeKey: `short:${p.id}:${Date.now()}` });
    res.status(202).json({ ok: true, jobId });
  })
);
