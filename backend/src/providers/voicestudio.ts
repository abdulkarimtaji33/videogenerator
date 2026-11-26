// VoiceStudio (open-source, local-first voice studio, AGPL-3.0; engine OmniVoice) as the speech engine. It runs as a server on a GPU
// machine (the Colab T4, reached through a tunnel) and is called through its ElevenLabs-compatible API:
//   POST {url}/elevenlabs/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128   body {text, model_id, language_code, voice_settings:{speed}}
//   POST {url}/elevenlabs/v1/speech-to-text   (multipart: file, model_id)          -> words with start/end
// The key is sent as xi-api-key and is read from VOICESTUDIO_API_KEY in backend/.env only.
//
// All calls go through net/httpx.ts (not fetch): it connects over an address that answers, which a tunnel name needs on this PC.
//
// Word timings for the captions: after the speech is made it is transcribed by VoiceStudio itself, which gives a start and end for
// each spoken word. If that fails, the span of the speech (silence at the start and end removed) is found with ffmpeg and the caption
// words are spread over it by length. Either way no OpenAI call is needed.

import fs from "fs";
import { logger } from "../log";
import { httpx, multipart, type HttpxResponse } from "../net/httpx";
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

/** One request to the server; a stalled or refused connection is retried a few times (the tunnel can blink). */
async function call(path: string, init: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string | Buffer }, timeoutMs: number, tries = 3): Promise<HttpxResponse> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await httpx(`${base()}${path}`, init, timeoutMs);
    } catch (e) {
      last = e;
      await sleep(1000 * (i + 1));
    }
  }
  throw last;
}

/** Waits until the server answers /health (a few quick tries; each try may use another address). */
export async function waitReachable(tries = 8): Promise<void> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const r = await httpx(`${base()}/health`, { method: "GET" }, 8000);
      if (r.ok) return;
      last = `health answered ${r.status}`;
    } catch (e: any) {
      last = String(e?.code || e?.message || e);
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
  const m = multipart({ model_id: "scribe_v1", language_code: lang }, { name: "file", filename: "speech.mp3", type: "audio/mpeg", data: fs.readFileSync(file) });
  const r = await call("/elevenlabs/v1/speech-to-text", { method: "POST", headers: { ...headers(false), "Content-Type": m.contentType }, body: m.body }, 120_000, 2);
  if (!r.ok) return [];
  let j: any = {};
  try {
    j = r.json();
  } catch {
    return [];
  }
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
  const path = `/elevenlabs/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
  const body = JSON.stringify({ text: req.text, model_id: s.voicestudioModel, language_code: lang, voice_settings: { speed: req.speed || 1 } });
  fs.rmSync(wordsFileFor(req.outFile), { force: true });
  await waitReachable();

  // The first request of a fresh server can take minutes (it downloads the model), and a tunnel can drop: retry a few times.
  let last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await httpx(`${s.voicestudioUrl}${path}`, { method: "POST", headers: headers(true), body }, 600_000);
      if (r.ok) {
        fs.writeFileSync(req.outFile, r.body);
        if (r.body.length < 2000 || (await probe(req.outFile)).duration < 0.3) throw new VoiceStudioError("VoiceStudio returned no usable audio.");
        break;
      }
      last = `VoiceStudio ${r.status}: ${r.text().slice(0, 300)}`;
      // A wrong key, a licence gate, an unknown voice or a bad request will not get better by asking again.
      if (r.status === 401 || r.status === 403 || r.status === 404 || r.status === 422) throw new VoiceStudioError(last, r.status);
    } catch (e: any) {
      if (e instanceof VoiceStudioError && e.status) throw e;
      last = e instanceof VoiceStudioError ? e.message : `VoiceStudio request failed: ${e?.code || e?.message || e}`;
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

export interface VoiceStudioHealth {
  online: boolean;
  detail: string;
  device?: string;
  engine?: string | null;
  /** Whether the API key in backend/.env is accepted by the server (null when it could not be checked). */
  keyOk: boolean | null;
  voices: { id: string; name: string }[];
}

/** Is the server up, does it accept our key, and which voices does it have. Never throws. */
export async function voiceStudioHealth(): Promise<VoiceStudioHealth> {
  if (!base()) return { online: false, detail: "No VoiceStudio address is set.", keyOk: null, voices: [] };
  try {
    await waitReachable(6);
  } catch (e: any) {
    return { online: false, detail: String(e?.message || e), keyOk: null, voices: [] };
  }
  try {
    const h: any = (await call("/health", { method: "GET" }, 10_000)).json();
    let keyOk: boolean | null = null;
    let voices: { id: string; name: string }[] = [];
    const r = await call("/elevenlabs/v1/voices", { method: "GET", headers: headers(false) }, 15_000);
    if (r.ok) {
      keyOk = true;
      voices = (r.json()?.voices ?? []).map((v: any) => ({ id: String(v.voice_id), name: String(v.name || v.voice_id) }));
    } else if (r.status === 401 || r.status === 403) keyOk = false;
    return {
      online: true,
      device: h?.device,
      engine: h?.engine ?? null,
      keyOk,
      voices,
      detail: keyOk === false ? "The server answers but refuses the key: VOICESTUDIO_API_KEY in backend/.env does not match the server's key." : "ready",
    };
  } catch (e: any) {
    return { online: false, detail: `VoiceStudio request failed: ${e?.code || e?.message || e}`, keyOk: null, voices: [] };
  }
}

export const voiceStudioTts: TtsProvider = {
  id: "voicestudio",
  label: "VoiceStudio (OmniVoice, GPU server)",
  status: () => (readVoiceSettings().voicestudioUrl ? { ok: true } : { ok: false, reason: "The VoiceStudio address is not set (node scripts/set-voicestudio.js <url>)." }),
  synthesize: (req) => synthesizeVoiceStudio(req),
};
