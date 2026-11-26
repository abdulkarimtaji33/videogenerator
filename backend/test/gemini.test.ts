import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { classifyFailure, geminiChain, geminiGenerate, geminiText, resetGeminiSkips, retrySecondsFrom } from "../src/providers/gemini";
import { generateText } from "../src/openai";
import { writeTextSettings } from "../src/text/settings";

// The success path was checked against Google's real API (docs/Text-Models.md). These tests cover failure replies that cannot be
// triggered on demand with a real key (a model that is gone, no quota, "high demand"), using a small local stand-in server.
let server: http.Server;
let port = 0;
let seen: { url: string; body: any }[] = [];
let reply: (model: string, body: any, n: number) => { status: number; json: any };
const calls: Record<string, number> = {};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gem-"));
const KEYS = ["GEMINI_API_KEY", "GEMINI_BASE_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "TEXT_SETTINGS_FILE"];
const saved: Record<string, string | undefined> = {};
const ok = (text: string) => ({ status: 200, json: { candidates: [{ content: { parts: [{ text }] } }] } });

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      const model = decodeURIComponent((req.url || "").split("/models/")[1].split(":")[0]);
      calls[model] = (calls[model] ?? 0) + 1;
      seen.push({ url: req.url || "", body });
      const r = reply(model, body, calls[model]);
      res.writeHead(r.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as any).port;
});
afterAll(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.TEXT_SETTINGS_FILE = path.join(tmp, `s-${Math.random().toString(36).slice(2)}.json`);
  writeTextSettings({ provider: "gemini", geminiModel: "gemini-3.8-flash", geminiThinking: "minimal", fallback: false });
  for (const k of Object.keys(calls)) delete calls[k];
  seen = [];
  resetGeminiSkips();
});

const noWait = { waits: [0, 0], sleep: async () => {} };

describe("reading Gemini replies", () => {
  it("keeps the answer and drops reasoning parts", () => {
    expect(geminiText({ candidates: [{ content: { parts: [{ text: "thinking...", thought: true }, { text: " answer " }] } }] })).toBe("answer");
    expect(geminiText({})).toBe("");
  });

  it("reads how long Gemini asks us to wait", () => {
    expect(retrySecondsFrom('{"retryDelay": "21s"}')).toBe(21);
    expect(retrySecondsFrom("Please retry in 21h57m32.02s.")).toBe(21 * 3600 + 57 * 60 + 33);
    expect(retrySecondsFrom("Please retry in 38s")).toBe(38);
    expect(retrySecondsFrom("nothing here")).toBeNull();
  });
});

describe("deciding what a failure means (replies seen on a real free-tier key)", () => {
  it("a gone model, no quota and a used-up daily quota move on; a busy model is retried; a bad request fails", () => {
    expect(classifyFailure(404, "no longer available to new users").action).toBe("switch");
    expect(classifyFailure(429, "Quota exceeded ... limit: 0, model: gemini-3.1-pro ... Please retry in 21h57m32s").action).toBe("switch");
    expect(classifyFailure(429, "Please retry in 21h57m32s").action).toBe("switch");
    expect(classifyFailure(429, '{"retryDelay":"21s"}')).toEqual({ action: "retry", waitS: 21 });
    expect(classifyFailure(503, "high demand").action).toBe("retry");
    expect(classifyFailure(400, "bad request").action).toBe("fail");
    expect(classifyFailure(403, "key not allowed").action).toBe("fail");
  });

  it("the chain starts with the chosen model, then the others, without repeats", () => {
    expect(geminiChain("gemini-3.5-flash-lite")).toEqual(["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3-flash-preview"]);
    expect(geminiChain("gemini-3.8-flash")).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3-flash-preview"]);
    expect(new Set(geminiChain("gemini-3.8-flash")).size).toBe(3);
  });
});

describe("calling Gemini", () => {
  it("sends the key in a header (not the URL), the system prompt, and minimal thinking", async () => {
    reply = () => ok(" hello ");
    expect(await geminiGenerate("SYS", "USR", { model: "gemini-3.8-flash" })).toBe("hello");
    expect(seen[0].url).not.toContain("test-key");
    expect(seen[0].body.systemInstruction.parts[0].text).toBe("SYS");
    expect(seen[0].body.contents[0].parts[0].text).toBe("USR");
    expect(seen[0].body.generationConfig.thinkingConfig.thinkingLevel).toBe("minimal");
  });

  it("asks again without the thinking setting when a model rejects it", async () => {
    reply = (_m, body) => (body.generationConfig ? { status: 400, json: { error: { message: "Thinking level is not supported for this model" } } } : ok("fine"));
    expect(await geminiGenerate("s", "u", { model: "gemini-3.5-flash-lite" })).toBe("fine");
    expect(seen).toHaveLength(2);
    expect(seen[1].body.generationConfig).toBeUndefined();
  });

  it("waits out a busy model and then succeeds", async () => {
    reply = (_m, _b, n) => (n < 3 ? { status: 503, json: { error: { message: "high demand" } } } : ok("done"));
    expect(await geminiGenerate("s", "u", { model: "gemini-3.8-flash", ...noWait })).toBe("done");
    expect(calls["gemini-3.8-flash"]).toBe(3);
  });

  it("moves to the next model when the chosen one is gone, and does not ask the gone one again", async () => {
    reply = (m) => (m === "gemini-3.8-flash" ? { status: 404, json: { error: { message: "no longer available to new users" } } } : ok(`from ${m}`));
    expect(await geminiGenerate("s", "u", noWait)).toBe("from gemini-3.5-flash-lite");
    expect(await geminiGenerate("s", "u", noWait)).toBe("from gemini-3.5-flash-lite");
    expect(calls["gemini-3.8-flash"]).toBe(1); // skipped the second time
  });

  it("moves on when the chosen model has no quota at all", async () => {
    reply = (m) =>
      m === "gemini-3.8-flash"
        ? { status: 429, json: { error: { message: "You exceeded your current quota. limit: 0, model: x. Please retry in 21h57m32s." } } }
        : ok("lite answered");
    expect(await geminiGenerate("s", "u", noWait)).toBe("lite answered");
    expect(calls["gemini-3.8-flash"]).toBe(1); // no pointless retries
  });

  it("a bad key or request is reported at once (another model would not help)", async () => {
    reply = () => ({ status: 400, json: { error: { message: "API key not valid" } } });
    await expect(geminiGenerate("s", "u", noWait)).rejects.toThrow(/400.*API key not valid/);
    expect(Object.keys(calls)).toEqual(["gemini-3.8-flash"]);
  });

  it("reports every model's reason when all of them fail", async () => {
    reply = () => ({ status: 404, json: { error: { message: "gone" } } });
    await expect(geminiGenerate("s", "u", noWait)).rejects.toThrow(/gemini-3\.8-flash 404.*gemini-3\.5-flash-lite 404/s);
  });

  it("says plainly when the key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(geminiGenerate("s", "u")).rejects.toThrow(/GEMINI_API_KEY is not set/);
  });
});

describe("generateText with Gemini as the first choice", () => {
  it("uses Gemini first", async () => {
    reply = () => ok("gemini text");
    expect(await generateText("s", "u")).toBe("gemini text");
  });

  it("is the default provider when the key is set and nothing is saved", async () => {
    process.env.TEXT_SETTINGS_FILE = path.join(tmp, "none.json");
    const { readTextSettings } = await import("../src/text/settings");
    expect(readTextSettings().provider).toBe("gemini");
    expect(readTextSettings().geminiModel).toBe("gemini-3.5-flash-lite");
    expect(readTextSettings().geminiThinking).toBe("minimal");
  });
});
