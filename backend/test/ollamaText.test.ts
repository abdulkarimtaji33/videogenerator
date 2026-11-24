import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { generateText, generateTextVia } from "../src/openai";
import { cleanOllamaText, ollamaHealth } from "../src/providers/ollama";
import { readTextSettings, writeTextSettings } from "../src/text/settings";

let server: http.Server;
let port = 0;
let seen: any[] = [];
let handler: (body: any, res: http.ServerResponse) => void;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "textset-"));
const KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "TEXT_SETTINGS_FILE"];
const saved: Record<string, string | undefined> = {};

function ndjson(res: http.ServerResponse, parts: string[]) {
  res.writeHead(200, { "Content-Type": "application/x-ndjson" });
  parts.forEach((p) => res.write(JSON.stringify({ message: { role: "assistant", content: p }, done: false }) + "\n"));
  res.end(JSON.stringify({ message: { role: "assistant", content: "" }, done: true }) + "\n");
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ models: [{ name: "qwen3.8:27b" }, { name: "gemma4:31b" }] }));
    }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      seen.push({ url: req.url, body });
      handler(body, res);
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
  process.env.TEXT_SETTINGS_FILE = path.join(tmp, `s-${Math.random().toString(36).slice(2)}.json`);
  seen = [];
  writeTextSettings({ provider: "ollama", ollamaUrl: `http://127.0.0.1:${port}`, ollamaModel: "qwen3.8:27b", fallback: true, ollamaThink: false });
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("Ollama text", () => {
  it("defaults to Ollama with qwen3.8:27b and the OpenAI standby on", () => {
    process.env.TEXT_SETTINGS_FILE = path.join(tmp, "missing.json");
    const s = readTextSettings();
    expect(s.provider).toBe("ollama");
    expect(s.ollamaModel).toBe("qwen3.8:27b");
    expect(s.fallback).toBe(true);
    expect(s.ollamaThink).toBe(false);
  });

  it("streams the answer together and sends the model, messages, think:false and a big context", async () => {
    handler = (_b, res) => ndjson(res, ['{"ok":', " true}"]);
    const text = await generateText("SYSTEM", "USER");
    expect(text).toBe('{"ok": true}');
    const b = seen[0].body;
    expect(seen[0].url).toBe("/api/chat");
    expect(b.model).toBe("qwen3.8:27b");
    expect(b.messages).toEqual([{ role: "system", content: "SYSTEM" }, { role: "user", content: "USER" }]);
    expect(b.think).toBe(false);
    expect(b.stream).toBe(true);
    expect(b.options.num_ctx).toBe(32768);
    expect(b.format).toBeUndefined(); // JSON is validated by the pipeline, not forced by Ollama's grammar
  });

  it("asks again without `think` when the model has no thinking mode", async () => {
    handler = (b, res) => {
      if ("think" in b) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: '"x" does not support thinking' }));
      }
      ndjson(res, ["fine"]);
    };
    expect(await generateText("s", "u")).toBe("fine");
    expect(seen).toHaveLength(2);
    expect("think" in seen[1].body).toBe(false);
  });

  it("reports a missing model with the pull command", async () => {
    handler = (_b, res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "model not found" }));
    };
    writeTextSettings({ fallback: false });
    await expect(generateText("s", "u")).rejects.toThrow(/ollama pull qwen3\.8:27b/);
  });

  it("strips inline <think> blocks and fails clearly when only reasoning came back", async () => {
    expect(cleanOllamaText("<think>hmm</think>\n answer ")).toBe("answer");
    handler = (_b, res) => {
      res.writeHead(200);
      res.end(JSON.stringify({ message: { content: "", thinking: "long reasoning" }, done: true }) + "\n");
    };
    writeTextSettings({ fallback: false });
    await expect(generateText("s", "u")).rejects.toThrow(/only reasoning/);
  });

  it("says Ollama is not running when the port is closed, and does not call OpenAI without a key", async () => {
    writeTextSettings({ ollamaUrl: "http://127.0.0.1:1" });
    await expect(generateText("s", "u")).rejects.toThrow(/not running/);
  });

  it("uses Ollama when OpenAI is chosen but fails (no key) and the standby is on", async () => {
    handler = (_b, res) => ndjson(res, ["from ollama"]);
    writeTextSettings({ provider: "openai", fallback: true });
    expect(await generateText("s", "u")).toBe("from ollama");
    writeTextSettings({ provider: "openai", fallback: false });
    await expect(generateText("s", "u")).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("generateTextVia never falls back (the Settings test button)", async () => {
    writeTextSettings({ ollamaUrl: "http://127.0.0.1:1", fallback: true });
    await expect(generateTextVia("ollama", "s", "u")).rejects.toThrow(/not running/);
  });

  it("health lists installed models and flags a missing one", async () => {
    let h = await ollamaHealth();
    expect(h).toMatchObject({ online: true, modelInstalled: true });
    expect(h.installed).toContain("gemma4:31b");
    writeTextSettings({ ollamaModel: "qwen3.8:27b-q8_0" });
    h = await ollamaHealth();
    expect(h.modelInstalled).toBe(false);
    expect(h.detail).toMatch(/ollama pull qwen3\.8:27b-q8_0/);
  });
});
