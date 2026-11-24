import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { query } from "../src/db";
import { DEFAULT_QUOTAS, canSpend, flowCredits, recordSpend, usageSummary } from "../src/providers/quota";
import { generateClipWithFallback } from "../src/providers/clips";
import { falRun } from "../src/providers/fal";
import { waitForFile, writeJob } from "../src/providers/browserWorker";
import { getAllSettings, getSetting, setSetting } from "../src/settings";
import { veoframe } from "../src/providers";
import type { ClipProvider, ClipRequest } from "../src/providers/types";

const require = createRequire(import.meta.url);

beforeAll(async () => {
  const { migrate } = require("../scripts/migrate.js");
  await migrate({ database: "videogenerator_test" });
});

beforeEach(async () => {
  await query("DELETE FROM provider_usage");
  await query("DELETE FROM settings");
});

afterEach(() => vi.unstubAllGlobals());

const req: ClipRequest = { planId: "p", clipId: "c1", prompt: "x".repeat(60), seconds: 8, aspect: "9:16", runDir: path.join(os.tmpdir(), "vg-test-run") };
const fake = (id: string, over: Partial<ClipProvider> = {}): ClipProvider => ({
  id,
  label: id,
  kind: "api",
  status: () => ({ ok: true }),
  cost: () => 1,
  generateClip: async () => ({ file: `${id}.mp4`, provider: id }),
  ...over,
});

describe("flow credits", () => {
  it("matches Flow's pricing guide", () => {
    expect(flowCredits("Veo 3.1 - Lite")).toBe(10);
    expect(flowCredits("Veo 3.1 - Fast")).toBe(20);
    expect(flowCredits("Veo 3.1 - Quality")).toBe(100);
  });
  it("defaults the free tier to 50 credits a day", () => {
    expect(DEFAULT_QUOTAS["google-flow"].perDay).toBe(50);
  });
});

describe("quota guard", () => {
  it("accumulates spend and blocks what no longer fits", async () => {
    await recordSpend("google-flow", 40);
    expect((await canSpend("google-flow", 10)).ok).toBe(true);
    const over = await canSpend("google-flow", 20);
    expect(over.ok).toBe(false);
    expect(over.remaining).toBe(10);
    await recordSpend("google-flow", 10);
    expect((await canSpend("google-flow", 1)).ok).toBe(false);
  });
  it("allows providers that have no quota defined", async () => {
    expect((await canSpend("unknown-provider", 999)).ok).toBe(true);
  });
  it("summarises usage for the dashboard", async () => {
    await recordSpend("veoframe", 3);
    const s = await usageSummary();
    expect(s.veoframe.used).toBe(3);
    expect(s["google-flow"].unit).toBe("credits");
  });
});

describe("provider fallback", () => {
  it("skips a disabled provider and one that is out of quota, then uses the next", async () => {
    await recordSpend("flow", 50, 0, { flow: { unit: "credits", perDay: 50 } });
    const providers = {
      veo: fake("veo", { status: () => ({ ok: false, reason: "not activated" }) }),
      flow: fake("flow", { cost: () => 10 }),
      api: fake("api"),
    };
    const r = await generateClipWithFallback(req, { order: ["veo", "flow", "api"], providers, quotas: { flow: { unit: "credits", perDay: 50 } } });
    expect(r.provider).toBe("api");
    expect(r.attempts.map((a) => a.outcome)).toEqual(["skipped", "skipped", "ok"]);
    expect(r.attempts[1].detail).toContain("daily quota");
  });
  it("falls back when a provider throws and records spend only for the one that worked", async () => {
    const providers = {
      a: fake("a", { generateClip: async () => Promise.reject(new Error("site down")) }),
      b: fake("b", { cost: () => 2 }),
    };
    const r = await generateClipWithFallback(req, { order: ["a", "b"], providers, quotas: { a: { unit: "clips", perDay: 5 }, b: { unit: "clips", perDay: 5 } } });
    expect(r.provider).toBe("b");
    expect((await canSpend("a", 0, { a: { unit: "clips", perDay: 5 } })).used).toBe(0);
    expect((await canSpend("b", 0, { b: { unit: "clips", perDay: 5 } })).used).toBe(2);
  });
  it("explains why when every provider fails", async () => {
    await expect(generateClipWithFallback(req, { order: ["a"], providers: { a: fake("a", { status: () => ({ ok: false, reason: "no key" }) }) }, quotas: {} })).rejects.toThrow(/a skipped \(no key\)/);
  });
  it("keeps Veoframe off until it is activated", () => {
    delete process.env.VEOFRAME_ENABLED;
    expect(veoframe.status().ok).toBe(false);
  });
});

describe("browser worker contract", () => {
  it("writes a job file with the output path", () => {
    const job = writeJob(req, "google-flow");
    const file = path.join(req.runDir, "jobs", "google-flow", "c1.json");
    expect(JSON.parse(fs.readFileSync(file, "utf-8")).output).toBe(job.output);
    expect(job.output.endsWith(path.join("clips", "c1.mp4"))).toBe(true);
  });
  it("waits for a complete file and times out when none appears", async () => {
    const f = path.join(os.tmpdir(), `vg-wait-${Date.now()}.mp4`);
    setTimeout(() => fs.writeFileSync(f, Buffer.alloc(60_000)), 120);
    await expect(waitForFile(f, 5000, 60)).resolves.toBeUndefined();
    await expect(waitForFile(path.join(os.tmpdir(), "never-" + Date.now()), 250, 50)).rejects.toThrow(/Timed out/);
  });
});

describe("fal.ai client (mocked network)", () => {
  it("submits, polls and fetches the result", async () => {
    process.env.FAL_KEY = "test-key";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: any) => {
        calls.push(`${init?.method || "GET"} ${url}`);
        const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b, text: async () => "" });
        if (url.startsWith("https://queue.fal.run/")) return json({ status_url: "https://s/status", response_url: "https://s/result" });
        if (url === "https://s/status") return json({ status: calls.filter((c) => c.endsWith("/status")).length < 2 ? "IN_PROGRESS" : "COMPLETED" });
        return json({ video: { url: "https://cdn/v.mp4" } });
      })
    );
    const out = await falRun("fal-ai/veo3/fast", { prompt: "x" }, { pollMs: 5 });
    expect(out.video.url).toBe("https://cdn/v.mp4");
    expect(calls[0]).toBe("POST https://queue.fal.run/fal-ai/veo3/fast");
    expect(calls.filter((c) => c.endsWith("/status")).length).toBe(2);
  });
  it("reports a failed submit clearly", async () => {
    process.env.FAL_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "bad key", json: async () => ({}) })));
    await expect(falRun("m", {})).rejects.toThrow(/401/);
  });
});

describe("settings", () => {
  it("returns defaults, stores overrides and rejects unknown keys", async () => {
    expect((await getSetting("provider_order"))[0]).toBe("google-flow");
    await setSetting("provider_order", ["veoframe", "google-flow"]);
    expect(await getSetting("provider_order")).toEqual(["veoframe", "google-flow"]);
    expect((await getAllSettings()).pacing_seconds).toBe(8);
    await expect(setSetting("nope" as any, 1 as any)).rejects.toThrow(/Unknown setting/);
  });
});
