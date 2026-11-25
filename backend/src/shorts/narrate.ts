// Narration step: one speech file per clip (consistent voice, exact timing per clip), then word timestamps
// from Whisper aligned to the exact script words so captions use the right spelling and land on time.
import fs from "fs";
import path from "path";
import { TTS_PROVIDERS, defaultTtsProvider } from "../providers";
import { runPaths } from "./assemble";
import { probe } from "./ffmpeg";
import type { ShortPlan } from "./plan";
import type { TtsProvider } from "../providers/types";
import { Word, alignScript, transcribeWords } from "./tts";

export interface NarrationResult {
  clipId: string;
  seconds: number;
  room: number;
  fits: boolean;
  skipped?: boolean;
}

export interface NarrateOptions {
  force?: boolean;
  ttsProvider?: string;
  /** Inject a speech provider (tests). */
  provider?: TtsProvider;
  /** Inject word timing (tests); defaults to OpenAI Whisper. */
  transcribe?: (file: string) => Promise<Word[]>;
}

export async function narrate(storageRoot: string, plan: ShortPlan, opts: NarrateOptions = {}): Promise<NarrationResult[]> {
  if (plan.narration.mode !== "tts") return [];
  const provider = opts.provider ?? TTS_PROVIDERS[opts.ttsProvider || defaultTtsProvider()];
  if (!provider) throw new Error(`Unknown speech provider '${opts.ttsProvider}'`);
  const st = provider.status();
  if (!st.ok) throw new Error(`Speech provider '${provider.id}' is not available: ${st.reason}`);
  const P = runPaths(storageRoot, plan.id);
  const out: NarrationResult[] = [];
  for (const c of plan.clips) {
    const room = c.seconds - plan.narration.delay - 0.2;
    if (!c.narration.trim()) continue;
    const mp3 = path.join(P.work, `narr-${c.id}.mp3`);
    const wf = path.join(P.work, `words-${c.id}.json`);
    if (!opts.force && fs.existsSync(mp3) && fs.existsSync(wf)) {
      const d = (await probe(mp3)).duration;
      out.push({ clipId: c.id, seconds: d, room, fits: d <= room, skipped: true });
      continue;
    }
    fs.rmSync(`${mp3}.words.json`, { force: true }); // a stale timing file from another voice must never be reused
    const say = (speed: number) => provider.synthesize({ text: c.narration, outFile: mp3, voice: c.voice || plan.narration.voice, model: plan.narration.model, instructions: plan.narration.instructions, speed });
    await say(plan.narration.speed);
    // A line that is too long for its shot (voices differ in pace: one Urdu voice is about 25% slower than another) is spoken
    // again a little faster, up to 1.3x, instead of running into the next shot.
    const first = (await probe(mp3)).duration;
    if (first > room && room > 0) {
      const faster = Math.min(1.3, plan.narration.speed * (first / room) * 1.04);
      if (faster > plan.narration.speed + 0.02) {
        fs.rmSync(`${mp3}.words.json`, { force: true });
        await say(Math.round(faster * 100) / 100);
      }
    }
    // Edge voices come with exact word timings (no OpenAI call); other voices are transcribed with Whisper.
    let heard: Word[] | null = null;
    if (!opts.transcribe) {
      try {
        const own = JSON.parse(fs.readFileSync(`${mp3}.words.json`, "utf-8")) as Word[];
        if (Array.isArray(own) && own.length) heard = own;
      } catch {
        heard = null;
      }
    }
    const d = (await probe(mp3)).duration;
    if (!heard) {
      if (c.captionText) {
        // Urdu and Hindi: no OpenAI call; spread the caption words over the spoken part of the file.
        heard = [{ word: "", start: 0.05, end: Math.max(0.2, d - 0.05) }];
      } else heard = await (opts.transcribe ?? transcribeWords)(mp3);
    }
    // Captions use the Roman words when given; they take the timings of the spoken words (one for one, else by length).
    fs.writeFileSync(wf, JSON.stringify(alignScript(c.captionText || c.narration, heard), null, 2));
    out.push({ clipId: c.id, seconds: d, room, fits: d <= room });
  }
  return out;
}
