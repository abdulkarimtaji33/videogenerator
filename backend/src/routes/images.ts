import fs from "fs";
import path from "path";
import { Router } from "express";
import { STORAGE_ROOT } from "../pipeline";
import { asyncHandler } from "../asyncHandler";
import { AppError } from "../errors";

export const imagesRouter = Router();

imagesRouter.get(
  "/*",
  asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || "";
    const filePath = path.join(STORAGE_ROOT, requestedPath);
    const resolved = path.resolve(filePath);

    // Verify the final path stays within STORAGE_ROOT to prevent traversal.
    if (!resolved.startsWith(path.resolve(STORAGE_ROOT) + path.sep)) {
      throw new AppError("invalid path", 400);
    }

    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw new AppError("not found", 404);
    }
    if (!stat.isFile()) {
      throw new AppError("not found", 404);
    }

    const contentType = resolved.endsWith(".mp4") ? "video/mp4" : "image/png";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    const stream = fs.createReadStream(resolved);
    stream.on("error", (err) => {
      console.error(`Failed to stream image ${resolved}:`, err);
      if (!res.headersSent) res.status(500).json({ error: "failed to read image" });
    });
    stream.pipe(res);
  })
);
