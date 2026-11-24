import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fallbackOrder, generateWithFallback, isProviderFailure } from "../src/textFallback";

const realFetch = globalThis.fetch;
const KEYS = ["ANTHROPIC_API_KEY", "GEMINI_API_KEY", "TEXT_FALLBACK_ORDER"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("text fallback", () => {
  it("does nothing without a fallback key (OpenAI-only setups are unchanged)", async () => {
    expect(fallbackOrder()).toEqual([]);
    expect(await generateWithFallback("s", "u")).toBeNull();
  });

  it("only lists providers whose key is set, in the configured order", () => {
    process.env.GEMINI_API_KEY = "g";
    expect(fallbackOrder()).toEqual(["gemini"]);
    process.env.ANTHROPIC_API_KEY = "a";
    expect(fallbackOrder()).toEqual(["anthropic", "gemini"]);
    process.env.TEXT_FALLBACK_ORDER = "gemini,anthropic";
    expect(fallbackOrder()).toEqual(["gemini", "anthropic"]);
  });

  it("classifies which OpenAI failures a fallback can fix", () => {
    expect(isProviderFailure({ status: 429 })).toBe(true);
    expect(isProviderFailure({ status: 401 })).toBe(true);
    expect(isProviderFailure({ status: 503 })).toBe(true);
    expect(isProviderFailure({ status: 400 })).toBe(false);
    expect(isProviderFailure(new Error("fetch failed"))).toBe(true);
    expect(isProviderFailure(new Error("The model did not return valid JSON"))).toBe(false);
  });

  it("calls Claude with the key in a header (not the URL) and returns its text", async () => {
    process.env.ANTHROPIC_API_KEY = "secret-a";
    const seen: { url: string; headers: any; body: any }[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      seen.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ content: [{ type: "text", text: " hello " }] }), { status: 200 });
    }) as any;
    const r = await generateWithFallback("sys", "usr");
    expect(r).toEqual({ text: "hello", provider: "anthropic" });
    expect(seen[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0].url).not.toContain("secret-a");
    expect(seen[0].headers["x-api-key"]).toBe("secret-a");
    expect(seen[0].body.system).toBe("sys");
    expect(seen[0].body.messages[0]).toEqual({ role: "user", content: "usr" });
  });

  it("moves on to Gemini when Claude fails, and keeps its key out of the URL", async () => {
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.GEMINI_API_KEY = "secret-g";
    const urls: string[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
      urls.push(String(url));
      if (String(url).includes("anthropic")) return new Response("{}", { status: 529 });
      expect(init.headers["x-goog-api-key"]).toBe("secret-g");
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "from gemini" }] } }] }), { status: 200 });
    }) as any;
    const r = await generateWithFallback("s", "u");
    expect(r?.provider).toBe("gemini");
    expect(r?.text).toBe("from gemini");
    expect(urls.every((u) => !u.includes("secret-g"))).toBe(true);
  });

  it("throws when every configured fallback fails", async () => {
    process.env.ANTHROPIC_API_KEY = "a";
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 500 })) as any;
    await expect(generateWithFallback("s", "u")).rejects.toThrow(/500/);
  });
});
