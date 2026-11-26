import fs from "fs";
import os from "os";
import path from "path";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler";
import { integrationStatus } from "../config";
import { query } from "../db";
import { AppError } from "../errors";
import { getJob, jobStats, listJobs } from "../jobs/queue";
import { rankNiches } from "../niche/scorer";
import { makeImage } from "../images";
import { generateTextVia } from "../openai";
import { defaultTtsProvider } from "../providers";
import { synthesizeVoiceStudio, voiceStudioHealth } from "../providers/voicestudio";
import { probe } from "../shorts/ffmpeg";
import { readVoiceSettings, writeVoiceSettings } from "../voice/settings";
import { ollamaHealth } from "../providers/ollama";
import { GEMINI_THINKING_LEVELS, RECOMMENDED_GEMINI_MODELS, RECOMMENDED_OLLAMA_MODELS, TEXT_PROVIDER_IDS, readTextSettings, writeTextSettings, type TextProviderId } from "../text/settings";
import { readImageSettings, writeImageSettings } from "../images/settings";
import { CLIP_PROVIDERS, IMAGE_PROVIDERS, listProviders } from "../providers";
import { fluxHealth } from "../providers/fluxLocal";
import { usageSummary } from "../providers/quota";
import { getAllSettings, getSetting, setSetting } from "../settings";
import { pullAllStats, weeklyReportData } from "../youtube/analytics";
import { notConnectedReason } from "../youtube/publish";
import { intParam, parseBody } from "./util";

export const systemRouter = Router();

systemRouter.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    const quotas = await getSetting("quotas");
    const stages = await query<any[]>("SELECT stage, COUNT(*) AS n FROM projects WHERE plan_json IS NOT NULL GROUP BY stage");
    const failed = await query<any[]>("SELECT id, title, error_message, updated_at FROM projects WHERE stage = 'failed' AND plan_json IS NOT NULL ORDER BY updated_at DESC LIMIT 10");
    const uploads = await query<any[]>("SELECT u.id, u.project_id, u.state, u.publish_at, u.youtube_video_id, p.title FROM uploads u JOIN projects p ON p.id = u.project_id ORDER BY u.id DESC LIMIT 10");
    res.json({
      jobs: await jobStats(),
      usage: await usageSummary(quotas),
      integrations: integrationStatus(),
      youtubeReady: notConnectedReason() === null,
      providers: listProviders(),
      projectsByStage: Object.fromEntries(stages.map((r) => [r.stage, Number(r.n)])),
      recentFailures: failed,
      recentUploads: uploads,
    });
  })
);

// Veoframe: is the worker's browser profile signed in (a saved login exists), and how many clips are left today.
systemRouter.get(
  "/veoframe",
  asyncHandler(async (_req, res) => {
    const quotas = await getSetting("quotas");
    const usage = (await usageSummary(quotas)) as any;
    const u = usage?.veoframe ?? { remaining: 0, quota: 150 };
    const cookies = path.join(process.cwd(), "storage", "browser-profile", "veoframe", "Default", "Network", "Cookies");
    const hasSession = fs.existsSync(cookies) && fs.statSync(cookies).size > 0;
    res.json({ signedIn: hasSession && process.env.VEOFRAME_ENABLED === "true", quotaLeft: Number(u.remaining ?? 0), perDay: Number(u.quota ?? 150) });
  })
);

// Image models: which are usable, whether the self-hosted FLUX server answers, and the settings behind them.
async function imageStatus() {
  const s = readImageSettings();
  const flux = await fluxHealth();
  const providers = Object.values(IMAGE_PROVIDERS).map((p) => {
    const st = p.status();
    const base = { id: p.id, label: p.label, configured: st.ok, detail: st.ok ? undefined : (st as any).reason };
    if (p.id === "flux-local") return { ...base, online: flux.online, detail: flux.online ? "FLUX server is running." : `FLUX server is not reachable (${flux.detail}). Start it with \`npm run flux\`.`, avgSeconds: s.lastFluxMs ? Math.round(s.lastFluxMs / 1000) : undefined };
    return base;
  });
  return { default: s.defaultProvider, providers, flux: { url: s.fluxUrl, model: s.fluxModel, steps: s.fluxSteps, lastMs: s.lastFluxMs } };
}

systemRouter.get("/images", asyncHandler(async (_req, res) => res.json(await imageStatus())));

const ImageSettingsPatch = z.object({
  default: z.enum(["flux-local", "openai", "fal"]).optional(),
  fluxUrl: z.string().url().optional(),
  fluxModel: z.string().min(1).max(120).optional(),
  fluxSteps: z.number().int().min(1).max(60).optional(),
});

systemRouter.put(
  "/images",
  asyncHandler(async (req, res) => {
    const p = parseBody(ImageSettingsPatch, req.body);
    writeImageSettings({
      ...(p.default ? { defaultProvider: p.default } : {}),
      ...(p.fluxUrl ? { fluxUrl: p.fluxUrl } : {}),
      ...(p.fluxModel ? { fluxModel: p.fluxModel } : {}),
      ...(p.fluxSteps ? { fluxSteps: p.fluxSteps } : {}),
    });
    res.json(await imageStatus());
  })
);

// Makes one small test image with the chosen provider (no fallback, so the answer says what really happened).
systemRouter.post(
  "/images/test",
  asyncHandler(async (req, res) => {
    const provider = typeof req.body?.provider === "string" ? req.body.provider : readImageSettings().defaultProvider;
    try {
      const made = await makeImage({ prompt: "A single red apple on a white table, soft daylight, photograph.", size: "1024x1024", provider, fallback: false });
      res.json({ ok: true, provider: made.provider, ms: made.ms, imageBase64: made.buffer.toString("base64") });
    } catch (e: any) {
      res.json({ ok: false, provider, ms: 0, error: String(e?.message || e).slice(0, 400) });
    }
  })
);

// Text model (writing): Gemini by default; OpenAI and Ollama are the other choices and the standbys. Keys are never returned.
async function textStatus() {
  const s = readTextSettings();
  const o = await ollamaHealth();
  const openaiConfigured = !!process.env.OPENAI_API_KEY;
  const geminiConfigured = !!process.env.GEMINI_API_KEY;
  return {
    provider: s.provider,
    fallback: s.fallback,
    providers: [
      { id: "gemini", label: `Gemini (${s.geminiModel})`, configured: geminiConfigured, detail: geminiConfigured ? undefined : "GEMINI_API_KEY is not set in backend/.env." },
      { id: "openai", label: `OpenAI (${process.env.OPENAI_TEXT_MODEL || "gpt-4.1"})`, configured: openaiConfigured, detail: openaiConfigured ? undefined : "OPENAI_API_KEY is not set in backend/.env." },
      { id: "ollama", label: `Ollama (${s.ollamaModel})`, configured: true, online: o.online && o.modelInstalled, detail: o.online ? o.detail : `Ollama is not reachable (${o.detail}). Install it from ollama.com and run it.` },
    ],
    gemini: { model: s.geminiModel, thinking: s.geminiThinking, thinkingLevels: GEMINI_THINKING_LEVELS, recommended: RECOMMENDED_GEMINI_MODELS },
    ollama: { url: s.ollamaUrl, model: s.ollamaModel, think: s.ollamaThink, numCtx: s.ollamaNumCtx, temperature: s.ollamaTemperature, installed: o.installed, recommended: RECOMMENDED_OLLAMA_MODELS },
  };
}

systemRouter.get("/text", asyncHandler(async (_req, res) => res.json(await textStatus())));

const TextSettingsPatch = z.object({
  provider: z.enum(["gemini", "ollama", "openai"]).optional(),
  geminiModel: z.string().trim().regex(/^[A-Za-z0-9._-]{2,80}$/, "a Gemini model id such as gemini-2.5-pro").optional(),
  geminiThinking: z.enum(GEMINI_THINKING_LEVELS).optional(),
  fallback: z.boolean().optional(),
  ollamaUrl: z.string().url().optional(),
  ollamaModel: z.string().trim().min(1).max(120).optional(),
  ollamaThink: z.boolean().optional(),
  ollamaNumCtx: z.number().int().min(2048).max(262144).optional(),
  ollamaTemperature: z.number().min(0).max(2).optional(),
});

systemRouter.put(
  "/text",
  asyncHandler(async (req, res) => {
    const p = parseBody(TextSettingsPatch, req.body);
    writeTextSettings(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
    res.json(await textStatus());
  })
);

// One tiny generation on the chosen model, without any fallback, so the answer says what really happened.
systemRouter.post(
  "/text/test",
  asyncHandler(async (req, res) => {
    const s = readTextSettings();
    const provider = (TEXT_PROVIDER_IDS as string[]).includes(req.body?.provider) ? (req.body.provider as TextProviderId) : s.provider;
    const started = Date.now();
    try {
      const text = await generateTextVia(provider, "You are a terse assistant. Reply with ONLY valid JSON.", 'Return {"ok": true, "word": "ready"}.');
      const model = provider === "ollama" ? s.ollamaModel : provider === "gemini" ? s.geminiModel : process.env.OPENAI_TEXT_MODEL || "gpt-4.1";
      res.json({ ok: true, provider, model, ms: Date.now() - started, sample: text.slice(0, 200) });
    } catch (e: any) {
      res.json({ ok: false, provider, ms: Date.now() - started, error: String(e?.message || e).slice(0, 400) });
    }
  })
);

// Speech (narration and character voices): VoiceStudio on the GPU server, or the free Microsoft Edge voices. The key is never returned.
async function voiceStatus() {
  const s = readVoiceSettings();
  const h = s.voicestudioUrl ? await voiceStudioHealth() : null;
  return {
    provider: s.provider,
    active: defaultTtsProvider(),
    url: s.voicestudioUrl,
    keySet: !!process.env.VOICESTUDIO_API_KEY,
    providers: [
      { id: "voicestudio", label: "VoiceStudio (GPU server)", configured: !!s.voicestudioUrl, online: h ? h.online && h.keyOk !== false : undefined, detail: h ? (h.online ? h.detail : h.detail) : "No VoiceStudio address is set." },
      { id: "edge", label: "Microsoft Edge voices (free)", configured: true },
    ],
    server: h ? { device: h.device ?? null, engine: h.engine ?? null, voices: h.voices } : null,
    voices: s.voices,
  };
}

systemRouter.get("/voice", asyncHandler(async (_req, res) => res.json(await voiceStatus())));

const VoiceSettingsPatch = z.object({
  provider: z.enum(["voicestudio", "edge"]).optional(),
  voicestudioUrl: z.union([z.literal(""), z.string().url()]).optional(),
  voices: z.record(z.string().regex(/^[a-z]+(-\d)?$/), z.string().min(1).max(120)).optional(),
});

systemRouter.put(
  "/voice",
  asyncHandler(async (req, res) => {
    const p = parseBody(VoiceSettingsPatch, req.body);
    writeVoiceSettings(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
    res.json(await voiceStatus());
  })
);

// Makes one short real sentence with the chosen engine (no fallback), so the answer says what really happens, including a licence gate.
systemRouter.post(
  "/voice/test",
  asyncHandler(async (_req, res) => {
    const started = Date.now();
    const s = readVoiceSettings();
    if (s.provider !== "voicestudio") return res.json({ ok: true, provider: "edge", ms: 0, note: "Edge voices are used (nothing to test on a server)." });
    const h = await voiceStudioHealth();
    if (!h.online) return res.json({ ok: false, provider: "voicestudio", ms: Date.now() - started, error: h.detail });
    const file = path.join(os.tmpdir(), `vs-test-${Date.now()}.mp3`);
    try {
      await synthesizeVoiceStudio({ text: "This is a short test of the voice.", outFile: file, voice: "en-US-AndrewMultilingualNeural", model: "", instructions: "", speed: 1 });
      res.json({ ok: true, provider: "voicestudio", ms: Date.now() - started, seconds: Math.round((await probe(file)).duration * 10) / 10 });
    } catch (e: any) {
      res.json({ ok: false, provider: "voicestudio", ms: Date.now() - started, error: String(e?.message || e).slice(0, 400) });
    } finally {
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}.words.json`, { force: true });
    }
  })
);

systemRouter.get("/jobs", asyncHandler(async (req, res) => res.json(await listJobs(Number(req.query.limit) || 50))));

systemRouter.post(
  "/jobs/:id/retry",
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id);
    const job = await getJob(id);
    if (!job) throw new AppError("job not found", 404);
    if (!["failed", "dead"].includes(job.status)) throw new AppError(`job is '${job.status}'; only failed or dead jobs can be retried`, 409);
    await query("UPDATE jobs SET status = 'queued', attempts = 0, locked_by = NULL, run_after = NOW(), dedupe_key = NULL WHERE id = ?", [id]);
    res.json({ ok: true });
  })
);

const SettingsPatch = z.object({
  provider_order: z.array(z.string()).min(1).refine((a) => a.every((x) => x in CLIP_PROVIDERS), "unknown provider in provider_order").optional(),
  pacing_seconds: z.number().min(0).max(120).optional(),
  concurrency: z.number().int().min(1).max(8).optional(),
  budget_usd_per_day: z.number().min(0).max(1000).optional(),
  quotas: z.record(z.string(), z.object({ unit: z.enum(["credits", "clips", "usd"]), perDay: z.number().min(0) })).optional(),
});

systemRouter.get("/settings", asyncHandler(async (_req, res) => res.json(await getAllSettings())));

systemRouter.put(
  "/settings",
  asyncHandler(async (req, res) => {
    const patch = parseBody(SettingsPatch, req.body);
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) await setSetting(k as any, v as any);
    res.json(await getAllSettings());
  })
);

systemRouter.get("/niches", (_req, res) => res.json(rankNiches()));

systemRouter.get("/analytics", asyncHandler(async (_req, res) => res.json(await weeklyReportData())));

systemRouter.post(
  "/analytics/pull",
  asyncHandler(async (_req, res) => {
    const reason = notConnectedReason();
    if (reason) throw new AppError(reason, 409);
    res.json({ updated: await pullAllStats() });
  })
);
