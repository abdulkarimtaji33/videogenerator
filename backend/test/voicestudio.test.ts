import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { speechSpan, voiceIdFor } from "../src/providers/voicestudio";
import { narratorVoice, voiceFor, voiceSlot } from "../src/providers/voices";
import { defaultTtsProvider } from "../src/providers";
import { readVoiceSettings, writeVoiceSettings } from "../src/voice/settings";
import { ff } from "../src/shorts/ffmpeg";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-test-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("voice slots (which VoiceStudio voice a speaker gets)", () => {
  it("maps the Edge-style voice ids to narrator / male-N / female-N", () => {
    expect(voiceSlot(narratorVoice("ur"))).toMatchObject({ role: "narrator", slot: "narrator", lang: "ur" });
    expect(voiceSlot("ur-IN-SalmanNeural")).toMatchObject({ role: "male", slot: "male-0", lang: "ur" });
    expect(voiceSlot("ur-PK-UzmaNeural")).toMatchObject({ role: "female", slot: "female-0", lang: "ur" });
    expect(voiceSlot("ur-IN-GulNeural")).toMatchObject({ role: "female", slot: "female-1" });
    expect(voiceSlot("hi-IN-SwaraNeural")).toMatchObject({ role: "female", lang: "hi" });
    expect(voiceSlot("en-GB-RyanNeural")).toMatchObject({ role: "male", lang: "en" });
    expect(voiceSlot("onyx")).toMatchObject({ role: "narrator", lang: "en" }); // an OpenAI voice name: the narrator slot
  });

  it("two characters of a story land in different slots", () => {
    const cast = [{ key: "a", gender: "female" as const }, { key: "b", gender: "male" as const }];
    expect(voiceSlot(voiceFor("ur", "a", cast)).slot).toBe("female-0");
    expect(voiceSlot(voiceFor("ur", "b", cast)).slot).toBe("male-0");
    expect(voiceSlot(voiceFor("ur", "narrator", cast)).slot).toBe("narrator");
  });

  it("picks the slot's voice, else the role's, else the engine's default voice", () => {
    expect(voiceIdFor("ur-PK-UzmaNeural", { "female-0": "uzma1", female: "anyfemale" })).toBe("uzma1");
    expect(voiceIdFor("ur-PK-UzmaNeural", { female: "anyfemale" })).toBe("anyfemale");
    expect(voiceIdFor("ur-PK-UzmaNeural", {})).toBe("default");
    expect(voiceIdFor(narratorVoice("hi"), { narrator: "nar" })).toBe("nar");
  });
});

describe("speech settings and the default engine", () => {
  beforeEach(() => {
    process.env.VOICE_SETTINGS_FILE = path.join(dir, `v-${Math.random().toString(36).slice(2)}.json`);
    delete process.env.VOICESTUDIO_URL;
    delete process.env.VOICE_PROVIDER;
    delete process.env.TTS_PROVIDER;
  });

  it("uses Edge until a VoiceStudio address is saved, then VoiceStudio", () => {
    expect(readVoiceSettings().provider).toBe("edge");
    expect(defaultTtsProvider()).toBe("edge");
    writeVoiceSettings({ provider: "voicestudio", voicestudioUrl: "https://example.test/" });
    expect(readVoiceSettings().voicestudioUrl).toBe("https://example.test"); // trailing slash removed
    expect(defaultTtsProvider()).toBe("voicestudio");
    writeVoiceSettings({ provider: "edge" });
    expect(defaultTtsProvider()).toBe("edge");
  });

  it("TTS_PROVIDER in the environment wins, and an address without the provider choice does not switch", () => {
    writeVoiceSettings({ provider: "edge", voicestudioUrl: "https://example.test" });
    expect(defaultTtsProvider()).toBe("edge");
    process.env.TTS_PROVIDER = "voicestudio";
    expect(defaultTtsProvider()).toBe("voicestudio");
  });

  it("never stores the API key in the settings file", () => {
    process.env.VOICESTUDIO_API_KEY = "secret-key-123";
    writeVoiceSettings({ provider: "voicestudio", voicestudioUrl: "https://example.test" });
    expect(fs.readFileSync(process.env.VOICE_SETTINGS_FILE as string, "utf-8")).not.toContain("secret-key-123");
    delete process.env.VOICESTUDIO_API_KEY;
  });
});

describe("finding the speech inside a recording (real audio, real ffmpeg)", () => {
  it("finds where a tone starts and ends when there is silence before and after it", async () => {
    const f = path.join(dir, "span.wav");
    // 1.0 s silence, 2.0 s tone, 1.5 s silence
    await ff([
      "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-f", "lavfi", "-i", "sine=frequency=300:sample_rate=24000", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
      "-filter_complex", "[0:a]atrim=0:1.0[a];[1:a]atrim=0:2.0[b];[2:a]atrim=0:1.5[c];[a][b][c]concat=n=3:v=0:a=1[out]",
      "-map", "[out]", f,
    ]);
    const s = await speechSpan(f);
    expect(s.duration).toBeGreaterThan(4.4);
    expect(s.start).toBeGreaterThan(0.85);
    expect(s.start).toBeLessThan(1.15);
    expect(s.end).toBeGreaterThan(2.85);
    expect(s.end).toBeLessThan(3.2);
  }, 60000);

  it("returns the whole file when there is no silence to cut", async () => {
    const f = path.join(dir, "tone.wav");
    await ff(["-f", "lavfi", "-i", "sine=frequency=300:sample_rate=24000", "-t", "2", f]);
    const s = await speechSpan(f);
    expect(s.start).toBeLessThan(0.1);
    expect(s.end).toBeGreaterThan(1.9);
  }, 60000);
});
