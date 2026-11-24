import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { buildShort, runPaths } from "../src/shorts/assemble";
import { narrate } from "../src/shorts/narrate";
import { buildChapters, parsePlan } from "../src/shorts/plan";
import { qaShort } from "../src/shorts/qa";
import { probe } from "../src/shorts/ffmpeg";
import { makeThumbnail, reframeToVertical } from "../src/media/clips";
import { fakeTranscribe, fakeTts, makeClip, makeImage, tmpDir } from "./helpers";

const raw = () => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "sample-plan.json"), "utf-8"));

describe("Short assembly (9:16)", () => {
  it("builds a 1080x1920 video that passes every QA check", async () => {
    const root = tmpDir("short");
    const plan = parsePlan({ ...raw(), id: "asm-short" });
    const P = runPaths(root, plan.id);
    await makeClip(path.join(P.clips, "c1.mp4"), 720, 1280, true);
    await makeClip(path.join(P.clips, "c2.mp4"), 1080, 1920, false); // silent clip
    const narr = await narrate(root, plan, { provider: fakeTts, transcribe: fakeTranscribe });
    expect(narr.every((n) => n.fits)).toBe(true);
    const out = await buildShort(root, plan);
    const info = await probe(out.file);
    expect([info.width, info.height]).toEqual([1080, 1920]);
    expect(info.duration).toBeGreaterThan(15.5);
    expect(info.duration).toBeLessThan(16.5);
    expect(info.videoCodec).toBe("h264");
    expect(info.audioCodec).toBe("aac");
    expect(out.captionsFile && fs.existsSync(out.captionsFile)).toBeTruthy();
    const qa = await qaShort(out.file, plan, path.join(P.runDir, "frames"));
    expect(qa.checks.filter((c) => !c.ok)).toEqual([]);
    expect(qa.ok).toBe(true);
    expect(qa.frames.length).toBeGreaterThanOrEqual(5);
    expect(Math.abs(qa.loudness!.integrated + 14)).toBeLessThan(1.5);
  }, 400000);

  it("warns when a clip has the wrong orientation instead of failing", async () => {
    const root = tmpDir("rot");
    const plan = parsePlan({ ...raw(), id: "asm-rot" });
    const P = runPaths(root, plan.id);
    await makeClip(path.join(P.clips, "c1.mp4"), 1280, 720, true); // landscape source for a vertical video
    await makeClip(path.join(P.clips, "c2.mp4"), 1080, 1920, true);
    await narrate(root, plan, { provider: fakeTts, transcribe: fakeTranscribe });
    const out = await buildShort(root, plan);
    expect(out.warnings.some((w) => w.includes("c1"))).toBe(true);
    expect((await probe(out.file)).height).toBe(1920);
  }, 400000);

  it("fails clearly when a clip file is missing", async () => {
    const root = tmpDir("missing");
    const plan = parsePlan({ ...raw(), id: "asm-missing" });
    await expect(buildShort(root, plan)).rejects.toThrow(/Missing clip file/);
  });
});

describe("long-form assembly (16:9) with stills, cards and music", () => {
  it("builds a 1920x1080 video from an AI clip, a Ken Burns still and a text card", async () => {
    const root = tmpDir("long");
    const base = raw();
    const plan = parsePlan({
      ...base,
      id: "asm-long",
      format: "long",
      aspect: "16:9",
      targetSeconds: 18,
      captions: { enabled: true, wordsPerChunk: 3 },
      music: undefined,
      clips: [
        { ...base.clips[0], id: "c1", seconds: 8 },
        { id: "c2", type: "still_kenburns", image: "still.png", seconds: 6, narration: "Its rings are mostly ice. They would float too." },
        { id: "c3", type: "card", text: "Saturn floats", seconds: 4 },
      ],
      chapters: [],
    });
    const P = runPaths(root, plan.id);
    await makeClip(path.join(P.clips, "c1.mp4"), 1280, 720, true);
    await makeImage(path.join(P.runDir, "still.png"));
    const music = path.join(root, "music.mp3");
    const { ff } = await import("../src/shorts/ffmpeg");
    await ff(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=5", "-c:a", "libmp3lame", music]);
    const withMusic = parsePlan({ ...plan, music: { file: music, gain: 0.1 } });
    await narrate(root, withMusic, { provider: fakeTts, transcribe: fakeTranscribe });
    const out = await buildShort(root, withMusic);
    const info = await probe(out.file);
    expect([info.width, info.height]).toEqual([1920, 1080]);
    expect(info.duration).toBeGreaterThan(17.5);
    expect(info.duration).toBeLessThan(18.5);
    const qa = await qaShort(out.file, withMusic, path.join(P.runDir, "frames"));
    expect(qa.checks.filter((c) => !c.ok)).toEqual([]);
  }, 180000);

  it("rejects incomplete clip definitions", () => {
    const base = raw();
    expect(() => parsePlan({ ...base, format: "long", aspect: "16:9", clips: [{ id: "a", type: "still_kenburns", seconds: 4 }, base.clips[0]] })).toThrow(/image/);
    expect(() => parsePlan({ ...base, format: "long", aspect: "16:9", clips: [{ id: "a", type: "card", seconds: 4 }, base.clips[0]] })).toThrow(/text/);
    expect(() => parsePlan({ ...base, format: "long", aspect: "9:16", clips: base.clips })).toThrow(/16:9/);
    expect(() => parsePlan({ ...base, aspect: "16:9" })).toThrow(/9:16/);
  });
});

describe("chapters", () => {
  it("builds YouTube chapter lines and refuses chapters that are too short", () => {
    const base = raw();
    const card = (id: string, seconds: number) => ({ id, type: "card", text: `Part ${id}`, seconds });
    const long = ["a", "b", "c", "d"].map((id) => card(id, 12));
    const plan = parsePlan({ ...base, format: "long", aspect: "16:9", targetSeconds: 48, clips: long, chapters: [{ title: "Intro", clipId: "a" }, { title: "Proof", clipId: "b" }, { title: "Twist", clipId: "d" }] });
    expect(buildChapters(plan)).toBe("0:00 Intro\n0:12 Proof\n0:36 Twist");
    const short = ["a", "b", "c", "d"].map((id) => card(id, 8));
    const tight = parsePlan({ ...base, format: "long", aspect: "16:9", targetSeconds: 32, clips: short, chapters: [{ title: "Intro", clipId: "a" }, { title: "Proof", clipId: "b" }, { title: "Twist", clipId: "c" }] });
    expect(buildChapters(tight)).toBe(""); // 8-second chapters are under YouTube's 10-second minimum
  });
});

describe("thumbnails and reframing", () => {
  it("makes two 1280x720 thumbnail variants and rejects too much text", async () => {
    const dir = tmpDir("thumb");
    const img = path.join(dir, "hero.png");
    await makeImage(img);
    for (const v of ["A", "B"] as const) {
      const out = path.join(dir, `t-${v}.png`);
      await makeThumbnail({ image: img, text: "Saturn would float", out, variant: v, workDir: dir });
      const info = await probe(out);
      expect([info.width, info.height]).toEqual([1280, 720]);
    }
    await expect(makeThumbnail({ image: img, text: "one two three four five six seven", out: path.join(dir, "x.png"), workDir: dir })).rejects.toThrow(/1 to 6 words/);
  }, 120000);

  it("reframes a 16:9 master into a 1080x1920 Short", async () => {
    const dir = tmpDir("reframe");
    const src = path.join(dir, "master.mp4");
    await makeClip(src, 1920, 1080, true, 8, 30);
    const out = path.join(dir, "short.mp4");
    await reframeToVertical(src, out, 1, 5);
    const info = await probe(out);
    expect([info.width, info.height]).toEqual([1080, 1920]);
    expect(info.duration).toBeGreaterThan(4.8);
    expect(info.duration).toBeLessThan(5.3);
  }, 120000);
});
