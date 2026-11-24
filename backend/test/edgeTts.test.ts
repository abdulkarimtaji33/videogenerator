import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { edgeRate, resolveEdgeVoice, synthesizeEdge, wordsFileFor } from "../src/providers/edge";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "edge-")), "out.mp3");
const req = (outFile: string) => ({ text: "Saturn is lighter than water.", outFile, voice: "onyx", model: "x", instructions: "", speed: 1 });

describe("edge voice helpers", () => {
  it("keeps a Microsoft voice id and replaces an OpenAI voice name with the default", () => {
    expect(resolveEdgeVoice("en-GB-RyanNeural")).toBe("en-GB-RyanNeural");
    expect(resolveEdgeVoice("onyx")).toBe("en-US-AndrewMultilingualNeural");
    expect(resolveEdgeVoice(undefined)).toBe("en-US-AndrewMultilingualNeural");
  });
  it("turns a speed into a signed percentage", () => {
    expect(edgeRate(1)).toBe("+0%");
    expect(edgeRate(0.95)).toBe("-5%");
    expect(edgeRate(1.1)).toBe("+10%");
  });
});

describe("synthesizeEdge", () => {
  it("writes the file the service produced", async () => {
    const out = tmp();
    const calls: string[] = [];
    const load = async () => ({
      EdgeTTS: class {
        constructor(public cfg: any) {
          calls.push(cfg.voice + "|" + cfg.rate + "|" + cfg.timeout);
        }
        async ttsPromise(_t: string, file: string) {
          fs.writeFileSync(file, Buffer.alloc(5000, 1));
        }
      },
    });
    await synthesizeEdge(req(out), load);
    expect(fs.statSync(out).size).toBe(5000);
    expect(calls[0]).toBe("en-US-AndrewMultilingualNeural|+0%|30000");
  });

  it("keeps Edge's own word timings next to the audio so captions need no speech recognition", async () => {
    const out = tmp();
    const load = async () => ({
      EdgeTTS: class {
        async *streamAudio(_t: string) {
          yield Buffer.alloc(4000, 1);
          yield { part: " Saturn ", start: 120, end: 640 };
          yield { part: "floats", start: 700, end: 1300 };
          yield Buffer.alloc(2000, 1);
        }
      },
    });
    await synthesizeEdge(req(out), load);
    expect(fs.statSync(out).size).toBe(6000);
    const words = JSON.parse(fs.readFileSync(wordsFileFor(out), "utf-8"));
    expect(words).toEqual([
      { word: "Saturn", start: 0.12, end: 0.64 },
      { word: "floats", start: 0.7, end: 1.3 },
    ]);
  });

  it("removes a stale timing file before a new synthesis", async () => {
    const out = tmp();
    fs.writeFileSync(wordsFileFor(out), JSON.stringify([{ word: "old", start: 0, end: 1 }]));
    const load = async () => ({ EdgeTTS: class { async ttsPromise(_t: string, file: string) { fs.writeFileSync(file, Buffer.alloc(3000, 1)); } } });
    await synthesizeEdge(req(out), load);
    expect(fs.existsSync(wordsFileFor(out))).toBe(false);
  });

  it("retries a failing connection and then succeeds", async () => {
    const out = tmp();
    let n = 0;
    const load = async () => ({
      EdgeTTS: class {
        async ttsPromise(_t: string, file: string) {
          if (++n < 2) throw new Error("socket closed");
          fs.writeFileSync(file, Buffer.alloc(3000, 1));
        }
      },
    });
    await synthesizeEdge(req(out), load);
    expect(n).toBe(2);
  }, 20000);

  it("fails with a clear message instead of hanging when every try fails", async () => {
    const out = tmp();
    const load = async () => ({ EdgeTTS: class { async ttsPromise() { throw new Error("handshake refused"); } } });
    await expect(synthesizeEdge(req(out), load)).rejects.toThrow(/Edge TTS failed after 3 tries \(handshake refused\)/);
  }, 30000);
});
