import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { ff, probe } from "../src/shorts/ffmpeg";
import { narrate } from "../src/shorts/narrate";
import { parsePlan } from "../src/shorts/plan";
import type { TtsProvider } from "../src/providers/types";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "narr-fit-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A speech provider whose audio is 9 seconds at normal speed and shorter when asked to speak faster (real audio files). */
function slowVoice(calls: { speed: number; voice: string }[]): TtsProvider {
  return {
    id: "slow",
    label: "slow test voice",
    status: () => ({ ok: true }),
    async synthesize(r) {
      calls.push({ speed: r.speed, voice: r.voice });
      await ff(["-f", "lavfi", "-i", "sine=frequency=220:sample_rate=24000", "-t", String(9 / r.speed), "-c:a", "libmp3lame", "-b:a", "32k", r.outFile]);
    },
  };
}

const plan = (voice?: string) =>
  parsePlan({
    id: "fit-test",
    niche: "x",
    topic: "a test of narration that is too long for its shot",
    title: "Narration fit test",
    hook: { type: "statement", line: "Hello there", visual: "a door" },
    styleBible: "Cinematic test style, one continuous look across all shots, vertical 9:16 framing.",
    clips: [
      { id: "shot-1", type: "ai_video", seconds: 8, prompt: "x".repeat(50), narration: "ایک دو تین چار پانچ", captionText: "aik do teen chaar paanch", voice },
      { id: "shot-2", type: "ai_video", seconds: 8, prompt: "y".repeat(50), narration: "چھ سات آٹھ", captionText: "chhe saat aath" },
    ],
  });

describe("narration that does not fit its shot", () => {
  it("is spoken again faster so it fits, with the speaker's own voice", async () => {
    const calls: { speed: number; voice: string }[] = [];
    const out = await narrate(root, plan("ur-IN-SalmanNeural"), { provider: slowVoice(calls), transcribe: async () => [], force: true });
    const first = calls.filter((c) => c.voice === "ur-IN-SalmanNeural");
    expect(first.length).toBe(2); // once at normal speed, once faster
    expect(first[0].speed).toBe(1);
    expect(first[1].speed).toBeGreaterThan(1.1);
    expect(first[1].speed).toBeLessThanOrEqual(1.3);
    expect(out[0].fits).toBe(true);
    const d = (await probe(path.join(root, "shorts", "fit-test", "work", "narr-shot-1.mp3"))).duration;
    expect(d).toBeLessThanOrEqual(7.55);
  }, 60000);

  it("captions use the Roman words, spread over the audio when the voice reports no timings", async () => {
    const words = JSON.parse(fs.readFileSync(path.join(root, "shorts", "fit-test", "work", "words-shot-1.json"), "utf-8"));
    expect(words.map((w: any) => w.word)).toEqual(["aik", "do", "teen", "chaar", "paanch"]);
    expect(words[0].start).toBeLessThan(words[4].start);
    expect(words[4].end).toBeLessThanOrEqual(8);
  });
});
