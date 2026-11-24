// Kokoro-82M text to speech, run locally on the CPU through kokoro-js: free, no account, no internet after the first
// model download (about 90 MB, cached), and exactly the same voice on every clip and every video.
// Voice ids: af_heart (Kokoro's top-rated), af_bella, af_nicole, am_michael, am_fenrir, am_puck, bm_george, bm_lewis, ...
// Pick one with KOKORO_VOICE in backend/.env (default af_heart).

import fs from "fs";
import os from "os";
import path from "path";
import { ff } from "../shorts/ffmpeg";
import type { TtsProvider } from "./types";

export const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const DEFAULT_KOKORO_VOICE = "af_heart";

// kokoro-js is an ES module; a real dynamic import keeps working whatever module format the build uses.
const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<any>;

let loading: Promise<any> | null = null;
function loadModel(): Promise<any> {
  if (!loading) {
    loading = dynamicImport("kokoro-js")
      .then((m) => m.KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: "q8", device: "cpu" }))
      .catch((e) => {
        loading = null;
        throw e;
      });
  }
  return loading;
}

/** The plan carries an OpenAI voice name by default ("onyx"); anything Kokoro does not know falls back to KOKORO_VOICE. */
export function resolveVoice(requested: string | undefined, known: string[] | null): string {
  const preferred = process.env.KOKORO_VOICE || DEFAULT_KOKORO_VOICE;
  if (requested && (!known || known.includes(requested))) return requested;
  return !known || known.includes(preferred) ? preferred : DEFAULT_KOKORO_VOICE;
}

export const kokoroTts: TtsProvider = {
  id: "kokoro",
  label: "Kokoro (local, free)",
  status: () => ({ ok: true }),
  async synthesize(req) {
    const tts = await loadModel();
    const known = Object.keys(tts.voices ?? {});
    const voice = resolveVoice(req.voice, known);
    const audio = await tts.generate(req.text, { voice, speed: req.speed || 1 });
    const wav = path.join(os.tmpdir(), `kokoro-${process.pid}-${Date.now()}.wav`);
    await audio.save(wav);
    try {
      fs.mkdirSync(path.dirname(req.outFile), { recursive: true });
      // A real MP3 (the narration step names its files .mp3 and Whisper reads them by extension).
      await ff(["-i", wav, "-ar", "24000", "-ac", "1", "-c:a", "libmp3lame", "-q:a", "2", req.outFile]);
    } finally {
      fs.rmSync(wav, { force: true });
    }
  },
};
