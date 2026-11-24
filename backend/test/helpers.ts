import fs from "fs";
import os from "os";
import path from "path";
import { ff } from "../src/shorts/ffmpeg";
import type { TtsProvider } from "../src/providers/types";
import type { Word } from "../src/shorts/tts";

export const tmpDir = (name: string) => {
  const d = path.join(os.tmpdir(), `vg-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

/** A synthetic 8-second clip with a moving test pattern; audio optional. */
export async function makeClip(file: string, w: number, h: number, audio = true, seconds = 8, fps = 24) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const args = ["-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=${fps}:duration=${seconds}`];
  if (audio) args.push("-f", "lavfi", "-i", `sine=frequency=220:sample_rate=44100:duration=${seconds}`);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", ...(audio ? ["-c:a", "aac"] : []), "-t", String(seconds), file);
  await ff(args);
}

export async function makeImage(file: string, w = 1600, h = 900) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await ff(["-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=1:duration=1`, "-frames:v", "1", file]);
}

/** Fake speech: a quiet tone whose length follows the word count (about 2.7 words a second). */
export const fakeTts: TtsProvider = {
  id: "fake-tts",
  label: "fake",
  status: () => ({ ok: true }),
  async synthesize(r) {
    const seconds = Math.max(1, r.text.split(/\s+/).length / 2.7);
    await ff(["-f", "lavfi", "-i", `sine=frequency=330:sample_rate=44100:duration=${seconds.toFixed(2)}`, "-af", "volume=0.3", "-c:a", "libmp3lame", r.outFile]);
  },
};

/** Fake word timing: words spread evenly across the narration. */
export const fakeTranscribe = async (file: string): Promise<Word[]> => {
  const { probe } = await import("../src/shorts/ffmpeg");
  const d = (await probe(file)).duration;
  const words = ["one", "two", "three", "four", "five", "six", "seven", "eight"];
  return words.map((w, i) => ({ word: w, start: (d * i) / words.length, end: (d * (i + 1)) / words.length - 0.02 }));
};
