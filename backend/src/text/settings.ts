// Text model settings (which model writes the brief, facts, hooks, SEO, script and review). Kept in a small JSON file like
// the image settings, so the Settings page can change them without a migration and they survive restarts.
// Environment variables give the initial values. API keys are never stored here: they stay in backend/.env.

import fs from "fs";
import path from "path";

export type TextProviderId = "gemini" | "ollama" | "openai";
export const TEXT_PROVIDER_IDS: TextProviderId[] = ["gemini", "ollama", "openai"];

/** The order the other models are tried in when the chosen one fails (best and most reliable first). */
export const FALLBACK_QUALITY_ORDER: TextProviderId[] = ["gemini", "openai", "ollama"];

/** Qwen3.8 27B: newest dense Qwen on Ollama (Aug 2026), Apache 2.0, 256K context. See docs/Text-Models.md for why. */
export const DEFAULT_OLLAMA_MODEL = "qwen3.8:27b";

/** The Gemini model used when none is chosen (the owner's choice, 2026-11-26): Flash-Lite, because it answered every real request in about 1 s while 3.8 Flash was often overloaded. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

/** Tried after the chosen model when it is not available (no quota, gone, busy, silent). Real findings: docs/Text-Models.md. */
export const FALLBACK_GEMINI_MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3-flash-preview"];

export const GEMINI_THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
export type GeminiThinking = (typeof GEMINI_THINKING_LEVELS)[number];

/** Models worth offering in the picker (any other Ollama tag can be typed in). */
export const RECOMMENDED_OLLAMA_MODELS: { id: string; note: string }[] = [
  { id: "qwen3.8:27b", note: "Best quality. Needs a machine with 24 GB+ of free RAM (17 GB model); it cannot load on a 7.8 GB server." },
  { id: "qwen3.5:4b", note: "Best that fits small servers (3.3 GB, runs in 6 GB). Tested for real: JSON and Urdu worked." },
  { id: "qwen3.5:9b", note: "Better than 4b if you have 10 GB+ of free RAM (6.6 GB model)." },
  { id: "qwen3.6:35b-a3b", note: "Faster mixture-of-experts alternative (3B active); a little less accurate." },
  { id: "qwen3.6:27b", note: "Previous dense Qwen; fallback if 3.8 misbehaves on your setup." },
  { id: "gemma4:31b", note: "Good prose, but Ollama's JSON-schema path has known loop bugs (this app does not use it)." },
  { id: "gpt-oss:120b", note: "Strong reasoning, weak prose and weak factual recall; needs about 65 GB." },
];

/** Gemini models offered in the picker (any model id the key can use can be typed in). */
export const RECOMMENDED_GEMINI_MODELS: { id: string; note: string }[] = [
  { id: "gemini-3.5-flash-lite", note: "Default: Gemini 3.5 Flash-Lite, fast and reliable (about 1 s per answer in tests)." },
  { id: "gemini-3.8-flash", note: "Gemini 3.8 Flash: stronger, but often busy (503) on a free key; the app then uses Flash-Lite." },
  { id: "gemini-3-flash-preview", note: "Older Flash preview; used as a standby." },
];

export interface TextSettings {
  /** The model used first. */
  provider: TextProviderId;
  geminiModel: string;
  /** How much Gemini thinks before answering. Minimal by default: thinking takes time and these steps are writing and JSON. */
  geminiThinking: GeminiThinking;
  ollamaUrl: string;
  ollamaModel: string;
  /** Reasoning mode. Off by default: Qwen3.8 over-thinks by default and the steps here are writing and JSON. */
  ollamaThink: boolean;
  /** Context window (tokens) requested from Ollama; its own default (4096) would cut long scripts. */
  ollamaNumCtx: number;
  ollamaTemperature: number;
  /** When the chosen model fails, try the others that are set up (Gemini, OpenAI, Ollama). */
  fallback: boolean;
}

const file = () => process.env.TEXT_SETTINGS_FILE || path.join(process.cwd(), "storage", "text-settings.json");

const bool = (v: string | undefined, d: boolean) => (v == null || v === "" ? d : /^(1|true|yes|on)$/i.test(v));

const defaults = (): TextSettings => ({
  // Gemini is the default writer when its key is set; without a key the first choice is Ollama.
  provider: (TEXT_PROVIDER_IDS as string[]).includes(process.env.TEXT_PROVIDER || "")
    ? (process.env.TEXT_PROVIDER as TextProviderId)
    : process.env.GEMINI_API_KEY
      ? "gemini"
      : "ollama",
  geminiModel: process.env.GEMINI_TEXT_MODEL || DEFAULT_GEMINI_MODEL,
  geminiThinking: (GEMINI_THINKING_LEVELS as readonly string[]).includes(process.env.GEMINI_THINKING || "") ? (process.env.GEMINI_THINKING as GeminiThinking) : "minimal",
  ollamaUrl: process.env.OLLAMA_URL || "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
  ollamaThink: bool(process.env.OLLAMA_THINK, false),
  ollamaNumCtx: Number(process.env.OLLAMA_NUM_CTX) || 32768,
  ollamaTemperature: process.env.OLLAMA_TEMPERATURE ? Number(process.env.OLLAMA_TEMPERATURE) : 0.7,
  fallback: bool(process.env.TEXT_FALLBACK_TO_OTHER, true),
});

export function readTextSettings(): TextSettings {
  const d = defaults();
  try {
    return { ...d, ...JSON.parse(fs.readFileSync(file(), "utf-8")) };
  } catch {
    return d;
  }
}

export function writeTextSettings(patch: Partial<TextSettings>): TextSettings {
  const next = { ...readTextSettings(), ...patch };
  if (!(TEXT_PROVIDER_IDS as string[]).includes(next.provider)) throw new Error(`Unknown text provider '${next.provider}'.`);
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  } catch {
    /* settings are best effort */
  }
  return next;
}
