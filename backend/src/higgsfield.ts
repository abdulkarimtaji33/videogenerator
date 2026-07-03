import fs from "fs";
import { withRetry } from "./retry";

const API_BASE = process.env.HIGGSFIELD_API_BASE || "https://platform.higgsfield.ai";
const API_KEY = process.env.HIGGSFIELD_API_KEY || "sample-higgsfield-api-key";
const VIDEO_MODEL = process.env.HIGGSFIELD_VIDEO_MODEL || "kling";

const POLL_INTERVAL_MS = Number(process.env.HIGGSFIELD_POLL_INTERVAL_MS || 5000);
const POLL_TIMEOUT_MS = Number(process.env.HIGGSFIELD_POLL_TIMEOUT_MS || 10 * 60 * 1000);

function getApiKey(): string {
  return API_KEY;
}

/**
 * Submits an image-to-video generation job to Higgsfield using the Kling model,
 * polls until it completes, and returns the resulting video bytes.
 */
export async function generateVideoFromImage(
  imagePath: string,
  videoPrompt: string
): Promise<Buffer> {
  const apiKey = getApiKey();
  const imageBuffer = fs.readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString("base64");

  const job = await withRetry(async () => {
    const res = await fetch(`${API_BASE}/v1/image2video`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VIDEO_MODEL,
        prompt: videoPrompt,
        image: imageBase64,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err: any = new Error(`Higgsfield image2video request failed (${res.status}): ${text}`);
      err.status = res.status;
      throw err;
    }

    return res.json() as Promise<{ id: string }>;
  });

  const jobId = job.id;
  if (!jobId) {
    throw new Error("Higgsfield response did not include a job id");
  }

  const videoUrl = await pollForVideoUrl(jobId, apiKey);
  return downloadVideo(videoUrl);
}

async function pollForVideoUrl(jobId: string, apiKey: string): Promise<string> {
  const start = Date.now();

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const status = await withRetry(async () => {
      const res = await fetch(`${API_BASE}/v1/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err: any = new Error(`Higgsfield job status request failed (${res.status}): ${text}`);
        err.status = res.status;
        throw err;
      }
      return res.json() as Promise<{ status: string; video_url?: string; error?: string }>;
    });

    if (status.status === "completed" && status.video_url) {
      return status.video_url;
    }
    if (status.status === "failed") {
      throw new Error(`Higgsfield video generation failed: ${status.error || "unknown error"}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Higgsfield video generation timed out after ${POLL_TIMEOUT_MS}ms (job ${jobId})`);
}

async function downloadVideo(url: string): Promise<Buffer> {
  const res = await withRetry(async () => {
    const r = await fetch(url);
    if (!r.ok) {
      const err: any = new Error(`Failed to download generated video (${r.status})`);
      err.status = r.status;
      throw err;
    }
    return r;
  });
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
