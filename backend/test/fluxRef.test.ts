import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { fitReference } from "../src/providers/fluxLocal";
import { ff, probe } from "../src/shorts/ffmpeg";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fluxref-test-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function makePng(name: string, w: number, h: number): Promise<string> {
  const f = path.join(dir, name);
  await ff(["-f", "lavfi", "-i", `testsrc=size=${w}x${h}:rate=1`, "-frames:v", "1", f]);
  return f;
}
async function dims(buf: Buffer): Promise<{ w: number; h: number }> {
  const f = path.join(dir, `out-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(f, buf);
  const i = await probe(f);
  return { w: i.width, h: i.height };
}

describe("reference images sent to FLUX", () => {
  it("a 1024x1536 anchor is shrunk to fit a 384x640 render, keeping its shape", async () => {
    const big = await makePng("anchor.png", 1024, 1536);
    const out = await fitReference(big, 384, 640);
    const { w, h } = await dims(out);
    expect(w).toBeLessThanOrEqual(384);
    expect(h).toBeLessThanOrEqual(640);
    expect(w % 16).toBe(0);
    expect(h % 16).toBe(0);
    expect(Math.abs(w / h - 1024 / 1536)).toBeLessThan(0.03);
    // far fewer pixels than the original means far fewer image tokens for FLUX to attend over
    expect(w * h).toBeLessThan(1024 * 1536 * 0.2);
  }, 60000);

  it("a small image is not enlarged", async () => {
    const small = await makePng("small.png", 192, 320);
    const { w, h } = await dims(await fitReference(small, 384, 640));
    expect(w).toBeLessThanOrEqual(192);
    expect(h).toBeLessThanOrEqual(320);
  }, 60000);

  it("a file ffmpeg cannot read as an image is sent unchanged", async () => {
    const junk = path.join(dir, "junk.png");
    fs.writeFileSync(junk, "not really an image");
    expect((await fitReference(junk, 384, 640)).toString()).toBe("not really an image");
  }, 60000);

  it("answers repeat requests for the same file from memory", async () => {
    const big = await makePng("cache.png", 800, 1200);
    const a = await fitReference(big, 384, 640);
    const b = await fitReference(big, 384, 640);
    expect(b).toBe(a);
  }, 60000);
});
