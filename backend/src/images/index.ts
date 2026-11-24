// One door for every image the product makes. Picks the provider (project choice, else the default: self-hosted FLUX),
// optionally falls back to OpenAI, scales the result to the size the pipeline asked for, and reports which model made it.

import fs from "fs";
import os from "os";
import path from "path";
import { IMAGE_PROVIDERS } from "../providers";
import { ff } from "../shorts/ffmpeg";
import { readImageSettings, type ImageProviderId } from "./settings";

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export interface MakeImageOptions {
  prompt: string;
  size: ImageSize;
  /** Reference images (anchors) that must stay recognisable. */
  refs?: string[];
  /** Project choice; falls back to the saved default. */
  provider?: string | null;
  /** When the chosen provider fails, try OpenAI. Off by default so nobody is billed silently. */
  fallback?: boolean;
}

export interface MadeImage {
  buffer: Buffer;
  provider: string;
  ms: number;
  fellBack: boolean;
}

const aspectFor = (size: ImageSize) => (size === "1024x1536" ? "9:16" : size === "1536x1024" ? "16:9" : "1:1");

/** Scales a PNG to the exact size the pipeline asked for (FLUX renders smaller and is upscaled). */
export async function scaleTo(buf: Buffer, size: ImageSize): Promise<Buffer> {
  const [w, h] = size.split("x").map(Number);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "img-"));
  try {
    const inp = path.join(dir, "in.png");
    const out = path.join(dir, "out.png");
    fs.writeFileSync(inp, buf);
    await ff(["-i", inp, "-vf", `scale=${w}:${h}:flags=lanczos:force_original_aspect_ratio=increase,crop=${w}:${h}`, "-frames:v", "1", out]);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function runProvider(id: string, o: MakeImageOptions): Promise<Buffer> {
  const p = IMAGE_PROVIDERS[id];
  if (!p) throw new Error(`Unknown image provider '${id}'.`);
  const st = p.status();
  if (!st.ok) throw new Error(`${p.label} is not available: ${st.reason}`);
  const buf = await p.generateImage({ prompt: o.prompt, aspect: aspectFor(o.size), referenceImages: o.refs?.length ? o.refs : undefined });
  // FLUX renders at a smaller size; the other providers already return the requested size.
  return id === "flux-local" ? scaleTo(buf, o.size) : buf;
}

export async function makeImage(o: MakeImageOptions): Promise<MadeImage> {
  const chosen = (o.provider || readImageSettings().defaultProvider) as ImageProviderId;
  const started = Date.now();
  try {
    const buffer = await runProvider(chosen, o);
    return { buffer, provider: chosen, ms: Date.now() - started, fellBack: false };
  } catch (e: any) {
    if (!o.fallback || chosen === "openai") {
      const hint = chosen === "flux-local" ? " Start it with `npm run flux`, or turn on 'fall back to OpenAI' for this project." : "";
      throw new Error(`${e?.message || e}${hint}`);
    }
    const buffer = await runProvider("openai", o);
    return { buffer, provider: "openai", ms: Date.now() - started, fellBack: true };
  }
}
