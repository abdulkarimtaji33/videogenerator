import fs from "fs";
import { generateVideoFromImage } from "../higgsfield";
import { generateImage, generateImageWithReference } from "../openai";
import { synthesizeSpeech } from "../shorts/tts";
import { clipOutput, runBrowserJob } from "./browserWorker";
import { edgeTts } from "./edge";
import { kokoroTts } from "./kokoro";
import { generateOnVeoframe } from "./veoframeWorker";
import { falClips, falImages } from "./fal";
import { fluxLocal } from "./fluxLocal";
import { veoframeMode } from "./instructions";
import { flowCredits } from "./quota";
import type { ClipProvider, ImageProvider, TtsProvider } from "./types";

export const FLOW_MODEL = process.env.FLOW_MODEL || "Veo 3.1 - Lite";

/** Flow A: Google Flow (Veo 3.1) in the browser. Available now. */
export const googleFlow: ClipProvider = {
  id: "google-flow",
  label: "Google Flow (Veo 3.1, browser)",
  kind: "browser",
  status: () => ({ ok: true }),
  cost: (req) => flowCredits(req.model || FLOW_MODEL),
  generateClip: (req) => runBrowserJob("google-flow", { ...req, model: req.model || FLOW_MODEL }),
};

/** Flow B: Veoframe web studio. Switched off until the account is activated (planned for 2026-11-22). */
export const veoframe: ClipProvider = {
  id: "veoframe",
  label: "Veoframe (browser)",
  kind: "browser",
  automatic: () => process.env.VEOFRAME_AUTOMATION !== "false",
  status: () =>
    process.env.VEOFRAME_ENABLED === "true"
      ? { ok: true }
      : { ok: false, reason: "Veoframe is not activated yet. Set VEOFRAME_ENABLED=true in backend/.env once the account is active." },
  cost: () => 1,
  async generateClip(req) {
    const s = veoframe.status();
    if (!s.ok) throw new Error(s.reason);
    // Automatic by default: the worker drives the Studio in its own signed-in browser profile. Set
    // VEOFRAME_AUTOMATION=false to fall back to the manual job pack (a person or Claude in Chrome does the clicks).
    if (process.env.VEOFRAME_AUTOMATION === "false") {
      return runBrowserJob("veoframe", { ...req, model: req.model || veoframeMode().label });
    }
    const outFile = clipOutput(req.runDir, req.clipId);
    const r = await generateOnVeoframe({ prompt: req.prompt, outFile, startFrame: req.referenceImage, aspect: req.aspect });
    return { file: r.file, provider: "veoframe", meta: { jobId: r.jobId } };
  },
};

/** API fallback: Higgsfield image-to-video (needs a reference image and an API key). */
export const higgsfield: ClipProvider = {
  id: "higgsfield",
  label: "Higgsfield (API, image-to-video)",
  kind: "api",
  status: () => (process.env.HIGGSFIELD_API_KEY ? { ok: true } : { ok: false, reason: "HIGGSFIELD_API_KEY is not set." }),
  cost: () => 1,
  async generateClip(req) {
    if (!req.referenceImage) throw new Error("Higgsfield needs a reference image for image-to-video.");
    const buf = await generateVideoFromImage(req.referenceImage, req.prompt);
    const out = `${req.runDir}/clips/${req.clipId}.mp4`;
    fs.mkdirSync(`${req.runDir}/clips`, { recursive: true });
    fs.writeFileSync(out, buf);
    return { file: out, provider: "higgsfield" };
  },
};

export const CLIP_PROVIDERS: Record<string, ClipProvider> = {
  [googleFlow.id]: googleFlow,
  [veoframe.id]: veoframe,
  [higgsfield.id]: higgsfield,
  [falClips.id]: falClips,
};

export const openaiImages: ImageProvider = {
  id: "openai",
  label: "OpenAI images",
  status: () => (process.env.OPENAI_API_KEY ? { ok: true } : { ok: false, reason: "OPENAI_API_KEY is not set." }),
  async generateImage(req) {
    const size = req.aspect === "9:16" ? "1024x1536" : req.aspect === "16:9" ? "1536x1024" : "1024x1024";
    const refs = req.referenceImages?.length ? req.referenceImages : req.referenceImage ? [req.referenceImage] : [];
    return refs.length ? generateImageWithReference(req.prompt, refs, size) : generateImage(req.prompt, size);
  },
};

export const IMAGE_PROVIDERS: Record<string, ImageProvider> = {
  [fluxLocal.id]: fluxLocal,
  [openaiImages.id]: openaiImages,
  [falImages.id]: falImages,
};

export const openaiTts: TtsProvider = {
  id: "openai",
  label: "OpenAI speech",
  status: () => (process.env.OPENAI_API_KEY ? { ok: true } : { ok: false, reason: "OPENAI_API_KEY is not set." }),
  synthesize: (r) => synthesizeSpeech(r.text, r.outFile, { model: r.model, voice: r.voice, instructions: r.instructions, speed: r.speed }),
};

// Edge voices first (free, natural, same voice every time); Kokoro (offline) and OpenAI are alternatives.
export const TTS_PROVIDERS: Record<string, TtsProvider> = { [edgeTts.id]: edgeTts, [kokoroTts.id]: kokoroTts, [openaiTts.id]: openaiTts };

/** Which speech provider narrates videos: set TTS_PROVIDER (edge, kokoro, openai), default edge. */
export const defaultTtsProvider = () => (process.env.TTS_PROVIDER && TTS_PROVIDERS[process.env.TTS_PROVIDER] ? process.env.TTS_PROVIDER : "edge");

export function getProvider(id: string): ClipProvider {
  const p = CLIP_PROVIDERS[id];
  if (!p) throw new Error(`Unknown flow '${id}'. Choose one of: ${Object.keys(CLIP_PROVIDERS).join(", ")}`);
  return p;
}

export function listProviders() {
  return {
    clips: Object.values(CLIP_PROVIDERS).map((p) => ({ id: p.id, label: p.label, kind: p.kind, ...p.status() })),
    images: Object.values(IMAGE_PROVIDERS).map((p) => ({ id: p.id, label: p.label, ...p.status() })),
    tts: Object.values(TTS_PROVIDERS).map((p) => ({ id: p.id, label: p.label, ...p.status() })),
  };
}
