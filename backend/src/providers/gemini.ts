// Google Gemini text client (the default writer). Talks to the Gemini API over plain HTTPS; the key goes in the x-goog-api-key
// header, never in the URL, and is read from GEMINI_API_KEY in backend/.env (never from the database or the settings file).
//
// Real behaviour of a free-tier key, measured on 2026-11-26, which this client is built around:
//  - Pro models answer 429 with "limit: 0" (no quota at all), and the 2.5 family answers 404 ("no longer available to new users").
//  - Flash models have per-minute and per-day limits, and now and then answer 503 "high demand" or do not answer for minutes.
// So a call tries the chosen model, then the next model of a short chain, instead of failing the whole video. A model that said
// "no quota", "gone" or "daily limit used" is skipped for a while; short limits and 503s are waited out a few times first.
// Thinking is kept minimal by default (thinking takes time and these steps are writing and JSON).

import { FALLBACK_GEMINI_MODELS, readTextSettings } from "../text/settings";

export class GeminiError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
    this.name = "GeminiError";
  }
}

export const GEMINI_WAITS_S = [5, 15, 30];
const baseUrl = () => (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");

/** The answer text of a generateContent reply (reasoning parts removed). */
export function geminiText(j: any): string {
  return (j?.candidates?.[0]?.content?.parts ?? [])
    .filter((p: any) => p && !p.thought)
    .map((p: any) => (typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();
}

/** Seconds Gemini asked us to wait: RetryInfo ("21s") or the message text ("Please retry in 21h57m32s"); null when it said nothing. */
export function retrySecondsFrom(body: string): number | null {
  const d = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (d) return Math.ceil(Number(d[1]));
  const m = body.match(/retry in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?/i);
  if (m && (m[1] || m[2] || m[3])) return Math.ceil(Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0));
  return null;
}

export type Verdict = { action: "retry"; waitS: number } | { action: "switch"; skipS: number; why: string } | { action: "fail" };

/** What to do with a failed reply: wait and try the same model again, move on to the next model, or give up. */
export function classifyFailure(status: number, body: string): Verdict {
  if (status === 404) return { action: "switch", skipS: 3600, why: "the model is no longer available to this key" };
  if (status === 429) {
    const wait = retrySecondsFrom(body);
    if (/limit:\s*0\b/.test(body)) return { action: "switch", skipS: 6 * 3600, why: "this key has no quota for the model" };
    if (wait !== null && wait > 120) return { action: "switch", skipS: Math.min(wait, 6 * 3600), why: "its daily quota is used up" };
    return { action: "retry", waitS: Math.min(120, Math.max(5, wait ?? 15)) };
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) return { action: "retry", waitS: 5 };
  return { action: "fail" };
}

/** Models that said "skip me" until this time (milliseconds since 1970). Lives as long as the process. */
const skipUntil = new Map<string, number>();
export const resetGeminiSkips = () => skipUntil.clear();

/** The models one call may use, in order: the chosen one, then the others of the chain. */
export function geminiChain(chosen: string): string[] {
  return [chosen, ...FALLBACK_GEMINI_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
}

export interface GeminiOptions {
  /** Use exactly this model and no other (tests, comparisons). */
  model?: string;
  waits?: number[];
  sleep?: (ms: number) => Promise<void>;
  /** Limit for one request; a model that does not answer in this time is skipped. */
  timeoutMs?: number;
  /** "minimal" | "low" | "medium" | "high"; default from Settings. */
  thinking?: string;
}

async function callModel(model: string, system: string, user: string, key: string, o: GeminiOptions, thinking: string): Promise<string> {
  const waits = o.waits ?? GEMINI_WAITS_S;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const url = `${baseUrl()}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const make = (withThinking: boolean) =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      ...(withThinking && thinking ? { generationConfig: { thinkingConfig: { thinkingLevel: thinking } } } : {}),
    });
  let withThinking = true;
  for (let attempt = 0; ; attempt++) {
    let status = 0;
    let text = "";
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 150_000);
      try {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: make(withThinking), signal: ctl.signal });
        status = r.status;
        text = await r.text();
      } finally {
        clearTimeout(timer);
      }
    } catch (e: any) {
      const timedOut = e?.name === "AbortError";
      // A model that does not answer is skipped (not waited for again); a dropped connection is tried once more.
      if (timedOut) throw Object.assign(new GeminiError(`Gemini ${model} did not answer in time.`, 0), { skipS: 600 });
      if (attempt >= waits.length) throw new GeminiError(`Gemini request failed: ${e?.cause?.code || e?.message || e}`, 0);
      await sleep(waits[attempt] * 1000);
      continue;
    }
    if (status >= 200 && status < 300) {
      let j: any;
      try {
        j = JSON.parse(text);
      } catch {
        throw new GeminiError("Gemini returned an unreadable answer.", status);
      }
      const out = geminiText(j);
      if (out) return out;
      throw new GeminiError(`Gemini returned no text (${j?.promptFeedback?.blockReason || j?.candidates?.[0]?.finishReason || "empty"}).`, status);
    }
    // A model that does not know the thinking setting: ask again without it.
    if (status === 400 && withThinking && /thinking/i.test(text)) {
      withThinking = false;
      continue;
    }
    const v = classifyFailure(status, text);
    let msg = text.slice(0, 240);
    try {
      msg = JSON.parse(text)?.error?.message || msg;
    } catch {
      /* keep the raw text */
    }
    msg = String(msg).replace(/\s+/g, " ").slice(0, 200);
    if (v.action === "retry" && attempt < waits.length) {
      await sleep(Math.max(v.waitS, waits[attempt]) * 1000);
      continue;
    }
    const err = new GeminiError(`Gemini ${model} ${status}: ${msg}`, status);
    if (v.action === "switch") throw Object.assign(err, { skipS: v.skipS });
    // Tried several times and still busy: treat like a model that is out for now.
    if (v.action === "retry") throw Object.assign(err, { skipS: 300 });
    throw err;
  }
}

export async function geminiGenerate(system: string, user: string, opts: GeminiOptions = {}): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError("GEMINI_API_KEY is not set in backend/.env.", 401);
  const s = readTextSettings();
  const thinking = opts.thinking ?? s.geminiThinking;
  const models = opts.model ? [opts.model] : geminiChain(s.geminiModel);
  const problems: string[] = [];
  let last: GeminiError | null = null;
  for (const [i, model] of models.entries()) {
    // Skip a model that said "no" a moment ago, unless it is the last one left (then it is tried anyway).
    if ((skipUntil.get(model) ?? 0) > Date.now() && i < models.length - 1 && !opts.model) {
      problems.push(`${model}: skipped (it failed recently)`);
      continue;
    }
    try {
      const out = await callModel(model, system, user, key, opts, thinking);
      if (i > 0 && !opts.model) console.warn(`Gemini ${models[0]} was not available; ${model} wrote this step.`);
      return out;
    } catch (e: any) {
      if (!(e instanceof GeminiError)) throw e;
      last = e;
      problems.push(e.message);
      const skipS = (e as any).skipS as number | undefined;
      if (skipS === undefined) throw e; // a request or key problem: another model will not help
      skipUntil.set(model, Date.now() + skipS * 1000);
    }
  }
  throw new GeminiError(problems.join(" | "), last?.status ?? 0);
}
