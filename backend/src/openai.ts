import fs from "fs";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { withRetry } from "./retry";
import { GeminiError, geminiGenerate } from "./providers/gemini";
import { OllamaError, ollamaGenerate } from "./providers/ollama";
import { generateWithFallback, isProviderFailure } from "./textFallback";
import { FALLBACK_QUALITY_ORDER, readTextSettings, type TextProviderId } from "./text/settings";

const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4.1";
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/** Shared client for modules that need other OpenAI endpoints (speech, transcription). */
export function getOpenAIClient(): OpenAI {
  return getClient();
}

async function openaiText(system: string, user: string): Promise<string> {
  const response = await withRetry(() =>
    getClient().chat.completions.create({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })
  );
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI text generation returned no content");
  }
  return content.trim();
}

/** Runs the text step on one specific model, with no fallback (used by the Settings test button). */
export async function generateTextVia(provider: TextProviderId, system: string, user: string): Promise<string> {
  if (provider === "gemini") return geminiGenerate(system, user);
  return provider === "ollama" ? ollamaGenerate(system, user) : openaiText(system, user);
}

const LABEL: Record<TextProviderId, string> = { gemini: "Gemini", ollama: "Ollama", openai: "OpenAI" };

/** A model that is not the first choice is only worth trying when it is set up (a key exists); Ollama is tried if it answers. */
const standbyReady = (id: TextProviderId): boolean => (id === "gemini" ? !!process.env.GEMINI_API_KEY : id === "openai" ? !!process.env.OPENAI_API_KEY : true);

/**
 * Runs one text generation step. `system` sets the role/task, `user` is the actual instruction.
 * The model chosen in Settings (default: Gemini) goes first. If it fails and "fall back" is on, the others that are set up
 * are tried (Gemini, OpenAI, Ollama in that order); if all fail, Claude is used when its key is set (see textFallback.ts).
 */
export async function generateText(system: string, user: string): Promise<string> {
  const s = readTextSettings();
  const primary = s.provider;
  const order: TextProviderId[] = s.fallback ? [primary, ...FALLBACK_QUALITY_ORDER.filter((id) => id !== primary)] : [primary];
  const failures: { id: TextProviderId; err: any }[] = [];
  for (const id of order) {
    if (id !== primary && !standbyReady(id)) continue;
    try {
      return await generateTextVia(id, system, user);
    } catch (err) {
      failures.push({ id, err });
      const next = order.slice(order.indexOf(id) + 1).find((n) => standbyReady(n));
      if (next) console.warn(`${LABEL[id]} text generation failed (${(err as Error)?.message}); trying ${LABEL[next]}.`);
    }
  }
  // Everything configured failed. Claude can still help when the failure was the provider's, not the prompt's.
  if (failures.some((f) => f.err instanceof OllamaError || f.err instanceof GeminiError || isProviderFailure(f.err))) {
    try {
      const fb = await generateWithFallback(system, user, (m) => console.warn(m));
      if (fb) return fb.text;
    } catch {
      /* the provider errors below are the useful ones */
    }
  }
  if (failures.length === 1) throw failures[0].err;
  throw Object.assign(new Error(failures.map((f) => `${LABEL[f.id]}: ${(f.err as Error)?.message ?? f.err}`).join(" | ")), { status: failures[0].err?.status });
}

/** Generates a standalone image (used for the character reference shot). Returns PNG bytes. */
export async function generateImage(
  prompt: string,
  size: "1024x1024" | "1024x1536" | "1536x1024" = "1024x1024"
): Promise<Buffer> {
  const response = await withRetry(() =>
    getClient().images.generate({
      model: IMAGE_MODEL,
      prompt,
      size,
    })
  );

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI image generation returned no image data");
  }
  return Buffer.from(b64, "base64");
}

/**
 * Generates a shot image using the character reference image as identity input,
 * so the character stays visually consistent across shots.
 */
export async function generateImageWithReference(
  prompt: string,
  /** One reference image, or several (for example a planet and a place that must both appear). */
  referenceImagePath: string | string[],
  size: "1024x1024" | "1024x1536" | "1536x1024" = "1024x1024"
): Promise<Buffer> {
  const paths = (Array.isArray(referenceImagePath) ? referenceImagePath : [referenceImagePath]).slice(0, 4);
  if (paths.length === 0) throw new Error("generateImageWithReference needs at least one reference image");
  const response = await withRetry(async () => {
    // Re-read the reference files on every attempt: a stream can only be consumed once,
    // so a retried call needs fresh ones.
    const files = await Promise.all(
      paths.map((p, i) => toFile(fs.createReadStream(p), `reference-${i + 1}.png`, { type: "image/png" }))
    );
    return getClient().images.edit({
      model: IMAGE_MODEL,
      image: files.length === 1 ? files[0] : files,
      prompt,
      size,
    });
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI image edit returned no image data");
  }
  return Buffer.from(b64, "base64");
}
