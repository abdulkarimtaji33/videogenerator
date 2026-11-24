import fs from "fs";
import { getOpenAIClient } from "../openai";
import { withRetry } from "../retry";

export interface Word {
  word: string;
  start: number;
  end: number;
}

export interface SpeechOptions {
  model: string;
  voice: string;
  instructions: string;
  speed: number;
}

/** Synthesizes narration to an mp3 file. gpt-4o-mini-tts takes style instructions; tts-1 models take a speed. */
export async function synthesizeSpeech(text: string, outFile: string, o: SpeechOptions): Promise<void> {
  const client = getOpenAIClient();
  const params: Record<string, unknown> = { model: o.model, voice: o.voice, input: text, response_format: "mp3" };
  if (o.model.startsWith("gpt-4o")) params.instructions = o.instructions;
  else params.speed = o.speed;
  // The body download is inside the retry: a connection can drop mid-stream after the response starts.
  const audio = await withRetry(async () => {
    const res: any = await (client.audio.speech.create as any)(params);
    return Buffer.from(await res.arrayBuffer());
  });
  fs.writeFileSync(outFile, audio);
}

/** Word-level timestamps from Whisper. */
export async function transcribeWords(file: string): Promise<Word[]> {
  const client = getOpenAIClient();
  const r: any = await withRetry(() =>
    (client.audio.transcriptions.create as any)({
      file: fs.createReadStream(file),
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    })
  );
  return (r.words || []).map((w: any) => ({ word: String(w.word).trim(), start: Number(w.start), end: Number(w.end) }));
}

/**
 * Pairs the exact script words with Whisper's timings. If the word counts match, each script word takes
 * the matching timing. Otherwise the script words are spread across the spoken span in proportion to
 * their length, so captions always show the correct spelling and still land on time.
 */
export function alignScript(script: string, heard: Word[]): Word[] {
  const scriptWords = script.split(/\s+/).filter(Boolean);
  if (heard.length === 0) return [];
  if (heard.length === scriptWords.length) {
    return scriptWords.map((w, i) => ({ word: w, start: heard[i].start, end: heard[i].end }));
  }
  const t0 = heard[0].start;
  const t1 = heard[heard.length - 1].end;
  const total = scriptWords.reduce((n, w) => n + w.length + 1, 0);
  let acc = 0;
  return scriptWords.map((w) => {
    const s = t0 + ((t1 - t0) * acc) / total;
    acc += w.length + 1;
    const e = t0 + ((t1 - t0) * acc) / total;
    return { word: w, start: s, end: e };
  });
}
