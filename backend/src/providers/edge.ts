// Microsoft neural voices through Edge's read-aloud service (node-edge-tts): free, no account, natural, and the same
// voice on every clip and every video. It needs an internet connection.
//
// Why node-edge-tts: Microsoft moved the service to api.msedgeservices.com with a newer security token. The older
// edge-tts-universal library still talks to the old address, which refuses the connection, and it never reports the
// failure, so synthesize() hangs forever. node-edge-tts uses the new address, and every call here also has a timeout
// and a retry, so a future Microsoft change fails loudly instead of freezing.
//
// Voice: EDGE_VOICE in backend/.env (default en-US-AndrewMultilingualNeural). Others that work well for narration:
// en-US-BrianMultilingualNeural, en-US-ChristopherNeural, en-GB-RyanNeural, en-US-GuyNeural, en-US-AvaMultilingualNeural.

import fs from "fs";
import path from "path";
import { logger } from "../log";
import type { TtsProvider, TtsRequest } from "./types";

export const DEFAULT_EDGE_VOICE = "en-US-AndrewMultilingualNeural";
const ATTEMPTS = 3;
const TIMEOUT_MS = 30_000;

const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<any>;

/** A Microsoft voice id looks like en-US-AndrewMultilingualNeural; anything else (an OpenAI voice name) is replaced. */
export function resolveEdgeVoice(requested?: string): string {
  if (requested && /^[a-z]{2,3}-[A-Z]{2}-\w+Neural$/.test(requested)) return requested;
  const fromEnv = process.env.EDGE_VOICE;
  return fromEnv && /^[a-z]{2,3}-[A-Z]{2}-\w+Neural$/.test(fromEnv) ? fromEnv : DEFAULT_EDGE_VOICE;
}

/** Speed 1.0 = normal; Edge wants a signed percentage. */
export function edgeRate(speed?: number): string {
  const pct = Math.round(((speed || 1) - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

/** Where Edge's own word timings for a narration file are kept (next to the mp3). */
export const wordsFileFor = (mp3: string) => `${mp3}.words.json`;

export async function synthesizeEdge(req: TtsRequest, load: () => Promise<any> = () => dynamicImport("node-edge-tts")): Promise<void> {
  const voice = resolveEdgeVoice(req.voice);
  const { EdgeTTS } = await load();
  fs.mkdirSync(path.dirname(req.outFile), { recursive: true });
  let lastError = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const tts = new EdgeTTS({ voice, lang: voice.slice(0, 5), outputFormat: "audio-24khz-96kbitrate-mono-mp3", rate: edgeRate(req.speed), timeout: TIMEOUT_MS, saveSubtitles: true });
      const wordsFile = wordsFileFor(req.outFile);
      fs.rmSync(wordsFile, { force: true });
      if (typeof tts.streamAudio === "function") {
        // Edge reports the exact start and end of every spoken word; keeping them means captions need no speech-recognition call.
        const out = fs.openSync(req.outFile, "w");
        const words: { word: string; start: number; end: number }[] = [];
        try {
          for await (const chunk of tts.streamAudio(req.text)) {
            if (Buffer.isBuffer(chunk)) fs.writeSync(out, chunk);
            else if (chunk && typeof chunk.part === "string") words.push({ word: chunk.part.trim(), start: chunk.start / 1000, end: chunk.end / 1000 });
          }
        } finally {
          fs.closeSync(out);
        }
        const usable = words.filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end));
        if (usable.length) fs.writeFileSync(wordsFile, JSON.stringify(usable));
      } else {
        await tts.ttsPromise(req.text, req.outFile);
      }
      if (fs.existsSync(req.outFile) && fs.statSync(req.outFile).size > 1000) return;
      lastError = "the service returned no audio";
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    logger.warn("edge tts attempt failed", { attempt, voice, error: lastError });
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`Edge TTS failed after ${ATTEMPTS} tries (${lastError}). Check the internet connection.`);
}

export const edgeTts: TtsProvider = {
  id: "edge",
  label: "Microsoft neural voices (Edge, free)",
  status: () => ({ ok: true }),
  synthesize: (req) => synthesizeEdge(req),
};
