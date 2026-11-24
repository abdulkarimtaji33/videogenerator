// YouTube routes.
//
// youtubeRouter (mounted at /api/youtube):
//   GET /status    -> { configured, connected, redirectUri }
//   GET /auth-url  -> { url }  OAuth start: the UI opens this Google sign-in URL (needs YOUTUBE_CLIENT_ID/SECRET in .env)
//   GET /callback  -> OAuth callback (Google redirects here with ?code&state; the token is stored in storage/secrets)
//
// projectPublishRouter (mounted at /api/projects by app.ts):
//   POST /:id/publish  body { privacy: private|unlisted|public|scheduled, publishAt?: ISO string }
//   -> 202 { ok, jobId }; the 'publish.upload' job does the upload (youtube/publish.ts).
import crypto from "crypto";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler";
import { loadConfig } from "../config";
import { query } from "../db";
import { AppError } from "../errors";
import { enqueue } from "../jobs/queue";
import { buildAuthUrl, exchangeCode, hasToken, isConfigured } from "../youtube/client";
import { notConnectedReason } from "../youtube/publish";
import { intParam, parseBody } from "./util";

export const youtubeRouter = Router();
const pending = new Set<string>();

youtubeRouter.get("/status", (_req, res) => {
  res.json({ configured: isConfigured(), connected: hasToken(), redirectUri: loadConfig().YOUTUBE_REDIRECT_URI });
});

youtubeRouter.get("/auth-url", (_req, res) => {
  if (!isConfigured()) throw new AppError("Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in backend/.env first.", 409);
  const state = crypto.randomBytes(16).toString("hex");
  pending.add(state);
  res.json({ url: buildAuthUrl(state) });
});

youtubeRouter.get(
  "/callback",
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) throw new AppError(`Google returned an error: ${error}`, 400);
    if (!state || !pending.has(state)) throw new AppError("Unknown or expired sign-in state; start again from /api/youtube/auth-url.", 400);
    pending.delete(state);
    if (!code) throw new AppError("Missing authorization code", 400);
    await exchangeCode(code);
    res.type("html").send("<h2>YouTube connected.</h2><p>You can close this tab and return to the studio.</p>");
  })
);

const PublishBody = z.object({
  privacy: z.enum(["private", "unlisted", "public", "scheduled"]),
  publishAt: z.iso.datetime({ offset: true }).optional(),
});

export const projectPublishRouter = Router();

projectPublishRouter.post(
  "/:id/publish",
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id);
    const body = parseBody(PublishBody, req.body);
    if (body.publishAt && Number.isNaN(new Date(body.publishAt).getTime())) throw new AppError("publishAt: not a valid date", 400);
    if (body.publishAt && new Date(body.publishAt).getTime() < Date.now()) throw new AppError("publishAt: must be in the future", 400);
    const [project] = await query<any[]>("SELECT id, final_video_path FROM projects WHERE id = ?", [id]);
    if (!project) throw new AppError("project not found", 404);
    if (!project.final_video_path) throw new AppError("This project has no finished video yet. Make the video first.", 400);
    const reason = notConnectedReason();
    if (reason) throw new AppError(reason, 400);
    await query("UPDATE projects SET publish_status = 'publishing' WHERE id = ?", [id]);
    const jobId = await enqueue("publish.upload", { projectId: id, privacy: body.privacy, publishAt: body.publishAt }, { dedupeKey: `publish:${id}:${Date.now()}`, maxAttempts: 2 });
    res.status(202).json({ ok: true, jobId });
  })
);
