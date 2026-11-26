import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { ff, isPlayableVideo } from "../src/shorts/ffmpeg";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "playable-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("telling a real clip from a broken download (real files)", () => {
  it("accepts a real video, rejects one cut short (no moov atom), rejects junk and a missing file", async () => {
    const good = path.join(dir, "good.mp4");
    // Noise keeps the file big enough (over 50 KB) like a real clip.
    await ff(["-f", "lavfi", "-i", "testsrc2=size=320x568:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "3", "-c:v", "libx264", "-b:v", "1500k", "-c:a", "aac", good]);
    expect(fs.statSync(good).size).toBeGreaterThan(50_000);
    expect(await isPlayableVideo(good)).toBe(true);

    // The failure seen on a real run: a download that stopped part way. The mp4 index (moov atom) is at the end, so it is missing.
    const cut = path.join(dir, "cut.mp4");
    const bytes = fs.readFileSync(good);
    fs.writeFileSync(cut, bytes.subarray(0, Math.floor(bytes.length * 0.6)));
    expect(fs.statSync(cut).size).toBeGreaterThan(50_000);
    expect(await isPlayableVideo(cut)).toBe(false);

    const junk = path.join(dir, "junk.mp4");
    fs.writeFileSync(junk, Buffer.alloc(100_000, 7));
    expect(await isPlayableVideo(junk)).toBe(false);
    expect(await isPlayableVideo(path.join(dir, "missing.mp4"))).toBe(false);
  }, 60000);

  it("rejects a tiny file without asking ffprobe", async () => {
    const tiny = path.join(dir, "tiny.mp4");
    fs.writeFileSync(tiny, "abc");
    expect(await isPlayableVideo(tiny)).toBe(false);
  });
});
