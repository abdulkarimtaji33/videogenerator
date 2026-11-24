import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import path from "path";
import { AppError } from "./errors";
import { channelsRouter } from "./routes/channels";
import { hooksRouter } from "./routes/hooks";
import { imagesRouter } from "./routes/images";
import { projectsRouter } from "./routes/projects";
import { shortsRouter } from "./routes/shorts";
import { systemRouter } from "./routes/system";
import { topicsRouter } from "./routes/topics";
import { projectPublishRouter, youtubeRouter } from "./routes/youtube";

export function createApp(): express.Express {
  const app = express();

  // No auth/cookies/session anywhere in this API (local use only), so reflecting any origin is harmless
  // and removes CORS as a source of "can't reach the backend" errors.
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));
  // The channel pipeline routes must come first so /import and /review-inbox win over the original GET /:id.
  app.use("/api/projects", shortsRouter);
  app.use("/api/projects", projectPublishRouter);
  app.use("/api/projects", projectsRouter);
  app.use("/api/images", imagesRouter);
  app.use("/api/hooks", hooksRouter);
  app.use("/api/channels", channelsRouter);
  app.use("/api/topics", topicsRouter);
  app.use("/api/system", systemRouter);
  app.use("/api/youtube", youtubeRouter);
  // Finished videos, frames and clips. Only the shorts folder is exposed (never logs or secrets).
  app.use("/api/media/shorts", express.static(path.join(process.cwd(), "storage", "shorts")));

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) return res.status(err.statusCode).json({ error: err.message });
    console.error("Unhandled error while processing request:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  });

  return app;
}
