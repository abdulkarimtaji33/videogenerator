// fal.ai fallback provider (images and clips) using fal's public queue API:
//   POST https://queue.fal.run/<model>  ->  { status_url, response_url }  ->  poll  ->  GET response_url
// It needs FAL_KEY and has not been run against the live service (no key on this machine); the request
// shaping and polling are unit-tested with a mocked fetch. Model ids are configurable.
import fs from "fs";
import path from "path";
import type { ClipProvider, ClipRequest, ClipResult, ImageProvider, ImageRequest } from "./types";

const key = () => process.env.FAL_KEY || "";
const headers = () => ({ Authorization: `Key ${key()}`, "Content-Type": "application/json" });

export async function falRun(model: string, input: unknown, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<any> {
  const sub = await fetch(`https://queue.fal.run/${model}`, { method: "POST", headers: headers(), body: JSON.stringify(input) });
  if (!sub.ok) throw new Error(`fal submit failed (${sub.status}): ${(await sub.text().catch(() => "")).slice(0, 300)}`);
  const { status_url, response_url } = (await sub.json()) as { status_url: string; response_url: string };
  const start = Date.now();
  const timeout = opts.timeoutMs ?? 10 * 60 * 1000;
  while (Date.now() - start < timeout) {
    const st = await fetch(status_url, { headers: headers() });
    if (!st.ok) throw new Error(`fal status failed (${st.status})`);
    const s = (await st.json()) as { status: string };
    if (s.status === "COMPLETED") {
      const res = await fetch(response_url, { headers: headers() });
      if (!res.ok) throw new Error(`fal result failed (${res.status})`);
      return res.json();
    }
    if (s.status === "FAILED" || s.status === "ERROR") throw new Error("fal generation failed");
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 3000));
  }
  throw new Error(`fal generation timed out after ${Math.round(timeout / 1000)}s`);
}

async function download(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

const IMAGE_SIZE: Record<string, string> = { "9:16": "portrait_16_9", "16:9": "landscape_16_9", "1:1": "square_hd" };

export const falImages: ImageProvider = {
  id: "fal",
  label: "fal.ai images (FLUX)",
  status: () => (key() ? { ok: true } : { ok: false, reason: "FAL_KEY is not set." }),
  async generateImage(req: ImageRequest) {
    const out = await falRun(process.env.FAL_IMAGE_MODEL || "fal-ai/flux/schnell", { prompt: req.prompt, image_size: IMAGE_SIZE[req.aspect || "1:1"] });
    const url = out?.images?.[0]?.url;
    if (!url) throw new Error("fal returned no image");
    return download(url);
  },
};

export const falClips: ClipProvider = {
  id: "fal",
  label: "fal.ai video",
  kind: "api",
  status: () => (key() ? { ok: true } : { ok: false, reason: "FAL_KEY is not set." }),
  cost: (req: ClipRequest) => 0.1 * req.seconds,
  async generateClip(req: ClipRequest): Promise<ClipResult> {
    const input: Record<string, unknown> = { prompt: req.prompt, aspect_ratio: req.aspect, duration: `${req.seconds}s`, generate_audio: true };
    if (req.referenceImage) {
      input.image_url = `data:image/png;base64,${fs.readFileSync(req.referenceImage).toString("base64")}`;
    }
    const out = await falRun(process.env.FAL_VIDEO_MODEL || "fal-ai/veo3/fast", input);
    const url = out?.video?.url;
    if (!url) throw new Error("fal returned no video");
    const file = path.join(req.runDir, "clips", `${req.clipId}.mp4`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await download(url));
    return { file, provider: "fal" };
  },
};
