// Shared contract for providers that only exist as websites (Google Flow, Veoframe).
// The backend writes a "job pack" (one JSON file per clip plus step-by-step instructions). A worker,
// currently Claude driving Chrome, later possibly a Playwright script, generates each clip on the website
// and saves the downloaded video at job.output. The backend then picks the file up. Because only the file
// path matters, the worker can be swapped without touching the pipeline.

import fs from "fs";
import path from "path";
import type { ClipRequest, ClipResult } from "./types";

export interface ClipJob {
  provider: string;
  planId: string;
  clipId: string;
  prompt: string;
  seconds: number;
  aspect: string;
  model?: string;
  referenceImage?: string;
  /** Absolute path where the finished mp4 must be saved. */
  output: string;
  createdAt: string;
}

export function clipOutput(runDir: string, clipId: string): string {
  return path.join(runDir, "clips", `${clipId}.mp4`);
}

export function jobsDir(runDir: string, provider: string): string {
  return path.join(runDir, "jobs", provider);
}

export function writeJob(req: ClipRequest, provider: string): ClipJob {
  const job: ClipJob = {
    provider,
    planId: req.planId,
    clipId: req.clipId,
    prompt: req.prompt,
    seconds: req.seconds,
    aspect: req.aspect,
    model: req.model,
    referenceImage: req.referenceImage,
    output: clipOutput(req.runDir, req.clipId),
    createdAt: new Date().toISOString(),
  };
  const dir = jobsDir(req.runDir, provider);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.dirname(job.output), { recursive: true });
  fs.writeFileSync(path.join(dir, `${req.clipId}.json`), JSON.stringify(job, null, 2));
  return job;
}

export function writeInstructions(runDir: string, provider: string, text: string) {
  const dir = jobsDir(runDir, provider);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "INSTRUCTIONS.md"), text);
}

/** Waits until the worker has saved a complete, non-empty file (size stable across two checks). */
export async function waitForFile(file: string, timeoutMs = 30 * 60 * 1000, pollMs = 4000): Promise<void> {
  const start = Date.now();
  let lastSize = -1;
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(file)) {
      const size = fs.statSync(file).size;
      if (size > 50_000 && size === lastSize) return;
      lastSize = size;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timed out after ${Math.round(timeoutMs / 60000)} minutes waiting for ${file}`);
}

export async function runBrowserJob(provider: string, req: ClipRequest): Promise<ClipResult> {
  const job = writeJob(req, provider);
  await waitForFile(job.output);
  return { file: job.output, provider };
}
