// VoiceStudio (open-source, local-first voice studio, AGPL-3.0; engine OmniVoice) as the speech engine. It runs as a server on a GPU
// machine (the Colab T4, reached through a tunnel) and is called through its ElevenLabs-compatible API:
//   POST {url}/elevenlabs/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128   body {text, model_id, language_code, voice_settings:{speed}}
//   POST {url}/elevenlabs/v1/speech-to-text   (multipart: file, model_id)          -> words with start/end
// The key is sent as xi-api-key and is read from VOICESTUDIO_API_KEY in backend/.env only.
//
// Word timings for the captions: after the speech is made it is transcribed by VoiceStudio itself, which gives a start and end for
// each spoken word. If that fails, the span of the speech (silence at the start and end removed) is found with ffmpeg and the caption
// words are spread over it by length. Either way no OpenAI call is needed.

import fs from "fs";
import { logger } from "../log";
import { FFMPEG, probe, run } from "../shorts/ffmpeg";
import { readVoiceSettings } from "../voice/settings";
import type { TtsProvider, TtsRequest } from "./types";
import { voiceSlot } from "./voices";

const base = () => readVoiceSettings().voicestudioUrl;
const wordsFileFor = (mp3: string) => `${mp3}.words.json`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class VoiceStudioError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
    this.name = "VoiceStudioError";
  }
}

/** The VoiceStudio voice id for an Edge-style voice id: the slot's own voice, else the role's, else the engine's default voice. */
export function voiceIdFor(edgeVoice: string, voices: Record<string, string>): string {
  const { slot, role } = voiceSlot(edgeVoice);
  return voices[slot] || voices[role] || "default";
}

const headers = (json: boolean): Record<string, string> => ({
  ...(json ? { "Content-Type": "application/json" } : {}),
  ...(process.env.VOICESTUDIO_API_KEY ? { "xi-api-key": process.env.VOICESTUDIO_API_KEY } : {}),
});

async function call(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Waits until the server answers /health. A tunnel name resolves to a few Cloudflare addresses and some of them are unreachable from
 * this PC (a real case: one of two addresses timed out for Node while curl fell back to the other). Each new lookup can return a
 * different address, so a failed quick check is simply tried again; the working connection is then reused for the real request.
 */
export async function waitReachable(tries = 12): Promise<void> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const r = await call(`${base()}/health`, { method: "GET" }, 6000);
      if (r.ok) return;
      last = `health answered ${r.status}`;
    } catch (e: any) {
      last = e?.name === "AbortError" ? "timed out" : String(e?.cause?.code || e?.message || e);
    }
    await sleep(500);
  }
  throw new VoiceStudioError(`VoiceStudio does not answer (${last}). Is the Colab server running, and is the address current (node scripts/set-voicestudio.js <url>)?`);
}

/** Seconds of speech in a file: where the first sound starts and the last one ends (silence trimmed). */
export async function speechSpan(file: string): Promise<{ start: number; end: number; duration: number }> {
  const duration = (await probe(file)).duration;
  const r = await run(FFMPEG, ["-hide_banner", "-i", file, "-af", "silencedetect=noise=-38dB:d=0.12", "-f", "null", "-"]);
  const starts = [...r.stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...r.stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  let start = 0;
  let end = duration;
  if (starts.length && starts[0] <= 0.05 && ends.length) start = ends[0];
  if (starts.length > ends.length || (starts.length && ends.length && ends[ends.length - 1] >= duration - 0.05)) end = starts[starts.length - 1];
  if (!(end > start + 0.2)) return { start: 0, end: duration, duration };
  return { start: Math.max(0, start - 0.03), end: Math.min(duration, end + 0.05), duration };
}

/** Timings VoiceStudio's own transcription gives for the words of the speech (empty when it cannot). */
async function transcribeWords(file: string, lang: string): Promise<{ word: string; start: number; end: number }[]> {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type: "audio/mpeg" }), "speech.mp3");
  form.append("model_id", "scribe_v1");
  form.append("language_code", lang);
  const r = await call(`${base()}/elevenlabs/v1/speech-to-text`, { method: "POST", headers: headers(false), body: form }, 120_000);
  if (!r.ok) return [];
  const j: any = await r.json().catch(() => ({}));
  return (j?.words ?? [])
    .filter((w: any) => w && (w.type === undefined || w.type === "word") && typeof w.text === "string" && w.text.trim())
    .map((w: any) => ({ word: String(w.text).trim(), start: Number(w.start), end: Number(w.end) }))
    .filter((w: any) => Number.isFinite(w.start) && Number.isFinite(w.end));
}

export async function synthesizeVoiceStudio(req: TtsRequest): Promise<void> {
  const s = readVoiceSettings();
  if (!s.voicestudioUrl) throw new VoiceStudioError("The VoiceStudio address is not set. Run: node scripts/set-voicestudio.js <url>");
  const { lang } = voiceSlot(req.voice);
  const voiceId = voiceIdFor(req.voice, s.voices);
  const url = `${s.voicestudioUrl}/elevenlabs/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
  const body = JSON.stringify({ text: req.text, model_id: s.voicestudioModel, language_code: lang, voice_settings: { speed: req.speed || 1 } });
  fs.rmSync(wordsFileFor(req.outFile), { force: true });
  await waitReachable();

  // The first request of a fresh server can take minutes (it downloads the model), and a tunnel can drop: retry a few times.
  let last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await call(url, { method: "POST", headers: headers(true), body }, 600_000);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        fs.writeFileSync(req.outFile, buf);
        if (buf.length < 2000 || (await probe(req.outFile)).duration < 0.3) throw new VoiceStudioError("VoiceStudio returned no usable audio.");
        break;
      }
      const text = (await r.text()).slice(0, 200);
      last = `VoiceStudio ${r.status}: ${text}`;
      // A wrong key, an unknown voice or a bad request will not get better by asking again.
      if (r.status === 401 || r.status === 403 || r.status === 404 || r.status === 422) throw new VoiceStudioError(last, r.status);
    } catch (e: any) {
      if (e instanceof VoiceStudioError && e.status) throw e;
      last = e?.name === "AbortError" ? "VoiceStudio did not answer in time." : `VoiceStudio request failed: ${e?.cause?.code || e?.message || e}`;
    }
    if (attempt === 3) throw new VoiceStudioError(`${last} Is the VoiceStudio server (Colab) running, and is the address current?`);
    await sleep(5000 * (attempt + 1));
  }

  // word timings for the captions
  let words: { word: string; start: number; end: number }[] = [];
  try {
    words = await transcribeWords(req.outFile, lang);
  } catch (e) {
    logger.warn("voicestudio transcription for word timings failed; using the speech span", { error: String((e as Error)?.message ?? e).slice(0, 120) });
  }
  if (!words.length) {
    const span = await speechSpan(req.outFile);
    const spoken = req.text.split(/\s+/).filter(Boolean).length;
    const n = spoken === 2 ? 3 : 2; // never as many marks as spoken words: then they would be taken as the words' own timings
    words = Array.from({ length: n }, (_, i) => {
      const at = span.start + ((span.end - span.start) * i) / (n - 1);
      return { word: "", start: i === n - 1 ? span.end - 0.01 : at, end: i === n - 1 ? span.end : at + 0.01 };
    });
  }
  fs.writeFileSync(wordsFileFor(req.outFile), JSON.stringify(words));
}

export const voiceStudioTts: TtsProvider = {
  id: "voicestudio",
  label: "VoiceStudio (OmniVoice, GPU server)",
  status: () => (readVoiceSettings().voicestudioUrl ? { ok: true } : { ok: false, reason: "The VoiceStudio address is not set (node scripts/set-voicestudio.js <url>)." }),
  synthesize: (req) => synthesizeVoiceStudio(req),
};
