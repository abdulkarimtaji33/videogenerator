// Ollama text client. Talks to the native /api/chat route (not the OpenAI-compatible /v1 one: `think` is only reliable on
// the native route). The reply is streamed, so a slow model never hits a request timeout: the only limits are "no data for
// OLLAMA_IDLE_MIN minutes" (default 20, covers a long prompt being read) and an overall OLLAMA_TIMEOUT_MIN (default 90).
//
// JSON is NOT forced with Ollama's `format` option. Grammar-constrained decoding has loop bugs on some models, and the
// pipeline already parses, validates and retries every JSON step itself (jsonStep). Prompts ask for JSON only.

import http from "http";
import https from "https";
import { readTextSettings } from "../text/settings";

export class OllamaError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
    this.name = "OllamaError";
  }
}

const base = () => readTextSettings().ollamaUrl.replace(/\/$/, "");

export async function ollamaHealth(timeoutMs = 2500): Promise<{ online: boolean; detail: string; installed: string[]; modelInstalled: boolean }> {
  const s = readTextSettings();
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(base() + "/api/tags", { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return { online: false, detail: `HTTP ${r.status}`, installed: [], modelInstalled: false };
    const j: any = await r.json().catch(() => ({}));
    const installed: string[] = Array.isArray(j?.models) ? j.models.map((m: any) => String(m?.name || m?.model || "")).filter(Boolean) : [];
    const want = s.ollamaModel;
    const modelInstalled = installed.some((n) => n === want || n === `${want}:latest` || (!want.includes(":") && n.startsWith(`${want}:`)));
    return {
      online: true,
      installed,
      modelInstalled,
      detail: modelInstalled ? "ready" : `Ollama is running but '${want}' is not installed. Run: ollama pull ${want}`,
    };
  } catch (e: any) {
    return { online: false, installed: [], modelInstalled: false, detail: e?.name === "AbortError" ? "timed out" : String(e?.cause?.code || e?.message || e) };
  }
}

/** Thinking text some templates leave inline, and surrounding whitespace. */
export function cleanOllamaText(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
}

interface ChatResult {
  content: string;
  thinking: string;
}

function chatOnce(body: Record<string, unknown>): Promise<ChatResult> {
  const u = new URL(base() + "/api/chat");
  const payload = Buffer.from(JSON.stringify(body));
  const lib = u.protocol === "https:" ? https : http;
  const idleMs = (Number(process.env.OLLAMA_IDLE_MIN) || 20) * 60_000;
  const totalMs = (Number(process.env.OLLAMA_TIMEOUT_MIN) || 90) * 60_000;
  return new Promise((resolve, reject) => {
    let content = "";
    let thinking = "";
    let buf = "";
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(total);
      fn();
    };
    const req = lib.request(
      { method: "POST", hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname, headers: { "Content-Type": "application/json", "Content-Length": payload.length } },
      (res) => {
        const status = res.statusCode ?? 500;
        if (status >= 400) {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf-8");
            let msg = text.slice(0, 300);
            try {
              msg = JSON.parse(text)?.error || msg;
            } catch {
              /* keep the raw text */
            }
            done(() => reject(new OllamaError(`Ollama ${status}: ${msg}`, status)));
          });
          return;
        }
        const handle = (line: string) => {
          if (!line.trim()) return;
          let j: any;
          try {
            j = JSON.parse(line);
          } catch {
            return;
          }
          if (j?.error) return done(() => reject(new OllamaError(`Ollama: ${String(j.error).slice(0, 300)}`, 500)));
          if (j?.message?.content) content += j.message.content;
          if (j?.message?.thinking) thinking += j.message.thinking;
        };
        res.setEncoding("utf-8");
        res.on("data", (chunk: string) => {
          buf += chunk;
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            handle(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
          }
        });
        res.on("end", () => {
          handle(buf);
          done(() => resolve({ content, thinking }));
        });
        res.on("error", (e) => done(() => reject(new OllamaError(`Ollama connection lost: ${e.message}`))));
      }
    );
    const total = setTimeout(() => req.destroy(new Error(`Ollama did not finish within ${Math.round(totalMs / 60000)} minutes.`)), totalMs);
    req.setTimeout(idleMs, () => req.destroy(new Error(`Ollama sent nothing for ${Math.round(idleMs / 60000)} minutes.`)));
    req.on("error", (e: any) => done(() => reject(e instanceof OllamaError ? e : new OllamaError(e?.code === "ECONNREFUSED" ? `Ollama is not running at ${base()} (connection refused). Start it, or turn on the OpenAI fallback.` : `Ollama request failed: ${e?.message || e}`))));
    req.end(payload);
  });
}

/** One writing step: system + user message in, plain text out. */
export async function ollamaGenerate(system: string, user: string): Promise<string> {
  const s = readTextSettings();
  const body: Record<string, unknown> = {
    model: s.ollamaModel,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    stream: true,
    think: s.ollamaThink,
    keep_alive: "30m",
    // Qwen's recommended non-thinking sampling (model card): temperature 0.7, top_p 0.8, top_k 20.
    options: { num_ctx: s.ollamaNumCtx, temperature: s.ollamaTemperature, top_p: 0.8, top_k: 20, num_predict: s.ollamaThink ? 32768 : 8192 },
  };
  let r: ChatResult;
  try {
    r = await chatOnce(body);
  } catch (e) {
    // A model without a thinking mode rejects the `think` field; ask again without it.
    if (e instanceof OllamaError && e.status === 400 && /think/i.test(e.message)) {
      delete body.think;
      r = await chatOnce(body);
    } else if (e instanceof OllamaError && e.status === 404) {
      throw new OllamaError(`Ollama does not have the model '${s.ollamaModel}'. Run: ollama pull ${s.ollamaModel}`, 404);
    } else {
      throw e;
    }
  }
  const text = cleanOllamaText(r.content);
  if (!text) {
    throw new OllamaError(r.thinking ? "Ollama returned only reasoning text and no answer (thinking used the whole output limit). Turn thinking off in Settings." : "Ollama returned no text.");
  }
  return text;
}
