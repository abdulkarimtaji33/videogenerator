// End to end through the real API and database, with fake clip and speech providers so it costs nothing:
// create channel and topic -> import plan -> run the pipeline -> review inbox -> approve -> publish.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import type { Server } from "http";
import { createApp } from "../src/app";
import { query } from "../src/db";
import "../src/jobs/handlers";
import { runOnce } from "../src/jobs/worker";
import { clipOutput } from "../src/providers/browserWorker";
import type { ClipProvider } from "../src/providers/types";
import { runPaths } from "../src/shorts/assemble";
import { STORAGE_ROOT, runShortProject } from "../src/shorts/run";
import { fakeTranscribe, fakeTts, makeClip, tmpDir } from "./helpers";

const require = createRequire(import.meta.url);
const realFetch = globalThis.fetch;
const base = () => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "sample-plan.json"), "utf-8"));
const stamp = Date.now();
const planFor = (suffix: string, extra: any = {}) => ({ ...base(), id: `e2e-${stamp}-${suffix}`, title: `Saturn would float ${suffix}`, topic: `Saturn density ${suffix}`, ...extra });

let server: Server;
let url = "";
const made: string[] = [];

async function api(method: string, p: string, body?: unknown) {
  const res = await fetch(url + p, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const fakeClips: ClipProvider = {
  id: "fake",
  label: "fake",
  kind: "api",
  status: () => ({ ok: true }),
  cost: () => 1,
  async generateClip(req) {
    const f = clipOutput(req.runDir, req.clipId);
    await makeClip(f, 720, 1280, true);
    return { file: f, provider: "fake" };
  },
};
const deps = { clipOptions: { order: ["fake"], providers: { fake: fakeClips }, quotas: {} }, narrateOptions: { provider: fakeTts, transcribe: fakeTranscribe } };

beforeAll(async () => {
  const { migrate } = require("../scripts/migrate.js");
  await migrate({ database: "videogenerator_test" });
  for (const t of ["uploads", "shots", "projects", "topics", "channels", "jobs", "provider_usage"]) await query(`DELETE FROM ${t}`);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  url = `http://127.0.0.1:${(server.address() as any).port}`;
}, 60000);

afterAll(async () => {
  server?.close();
  for (const id of made) fs.rmSync(path.join(STORAGE_ROOT, "shorts", id), { recursive: true, force: true });
  for (const t of ["uploads", "shots", "projects", "topics", "channels", "jobs"]) await query(`DELETE FROM ${t}`);
});

describe("channel pipeline end to end", () => {
  let channelId = 0;
  let topicId = 0;
  let projectId = 0;

  it("creates and validates a channel and a topic", async () => {
    const bad = await api("POST", "/api/channels", { name: "x" });
    expect(bad.status).toBe(400);
    const ch = await api("POST", "/api/channels", { name: "Space Curiosity", language: "en", niche: "space_science_curiosity", timezone: "UTC", publishSlots: ["09:00", "18:00"], styleGuide: { banned_topics: ["gambling"] } });
    expect(ch.status).toBe(201);
    channelId = ch.json.id;
    expect((await api("POST", "/api/channels", { name: "Space Curiosity" })).status).toBe(409); // same slug
    expect((await api("POST", "/api/channels", { name: "Bad Zone", timezone: "Mars/Olympus" })).status).toBe(400);
    const tp = await api("POST", "/api/topics", { channelId, title: "Saturn would float on water", angle: "NASA density figure", sources: [{ url: "https://nssdc.gsfc.nasa.gov/planetary/factsheet/saturnfact.html" }] });
    expect(tp.status).toBe(201);
    topicId = tp.json.id;
    expect((await api("POST", `/api/topics/${topicId}/approve`)).json.status).toBe("approved");
    expect((await api("POST", `/api/topics/${topicId}/reject`, {})).status).toBe(400); // reason required
  });

  it("imports a plan, rejects bad and duplicate plans", async () => {
    const plan = planFor("main");
    made.push(plan.id);
    const bad = await api("POST", "/api/projects/import", { plan: { ...plan, hook: undefined } });
    expect(bad.status).toBe(400);
    const flawed = planFor("flawed");
    flawed.clips[1].prompt += ' A sign reads "float".';
    const review = await api("POST", "/api/projects/import", { plan: flawed });
    expect(review.status).toBe(422);
    expect(JSON.stringify(review.json.findings)).toContain("quotation");
    const ok = await api("POST", "/api/projects/import", { plan, channelId, topicId, autoStart: false });
    expect(ok.status).toBe(201);
    projectId = ok.json.id;
    expect(ok.json.review.errors).toBe(0);
    expect((await api("POST", "/api/projects/import", { plan, channelId, autoStart: false })).status).toBe(409);
    const topics = await api("GET", `/api/topics?channelId=${channelId}`);
    expect(topics.json[0].status).toBe("planned");
    const shots = await query<any[]>("SELECT * FROM shots WHERE project_id = ?", [projectId]);
    expect(shots.length).toBe(2);
    expect(shots[0].video_prompt).toContain("golden ringed planet");
  });

  it("runs the pipeline to awaiting_approval with every QA check passing", async () => {
    const res = await runShortProject(projectId, deps);
    expect(res).toEqual({ stage: "awaiting_approval", qaPassed: true });
    const r = await api("GET", `/api/projects/${projectId}/review`);
    expect(r.json.stage).toBe("awaiting_approval");
    expect(r.json.qaStatus).toBe("passed");
    expect(r.json.qaReport.qa.checks.every((c: any) => c.ok)).toBe(true);
    expect(r.json.qaReport.policy.some((f: any) => f.level === "error")).toBe(false);
    expect(r.json.shots.every((s: any) => s.status === "done" && s.provider === "fake")).toBe(true);
    expect(fs.existsSync(path.join(STORAGE_ROOT, r.json.finalVideoPath))).toBe(true);
    const inbox = await api("GET", "/api/projects/review-inbox");
    expect(inbox.json.map((p: any) => p.id)).toContain(projectId);
    const media = await fetch(`${url}/api/media/${r.json.finalVideoPath}`);
    expect(media.status).toBe(200);
    expect((await media.arrayBuffer()).byteLength).toBeGreaterThan(50_000);
  }, 240000);

  it("keeps the video when YouTube is not connected and lets approval be retried", async () => {
    delete process.env.YOUTUBE_CLIENT_ID;
    const ap = await api("POST", `/api/projects/${projectId}/approve`);
    expect(ap.status).toBe(202);
    await runOnce("e2e");
    const [p] = await query<any[]>("SELECT stage, error_message FROM projects WHERE id = ?", [projectId]);
    expect(p.stage).toBe("awaiting_approval");
    expect(p.error_message).toContain("YouTube is not configured");
    const [u] = await query<any[]>("SELECT state FROM uploads WHERE project_id = ?", [projectId]);
    expect(u.state).toBe("failed");
  });

  it("uploads, schedules in the next free slot and records the upload once YouTube is connected", async () => {
    const dir = tmpDir("e2e-yt");
    process.env.YOUTUBE_CLIENT_ID = "cid";
    process.env.YOUTUBE_CLIENT_SECRET = "secret";
    process.env.YOUTUBE_TOKEN_FILE = path.join(dir, "t.json");
    fs.writeFileSync(process.env.YOUTUBE_TOKEN_FILE, JSON.stringify({ access_token: "tok", refresh_token: "r", expires_at: Date.now() + 3600_000 }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string, init: any) => {
        if (String(u).startsWith(url)) return realFetch(u, init);
        if (init?.method === "POST") return new Response("", { status: 200, headers: { location: "https://upload.example/s" } });
        return new Response(JSON.stringify({ id: "YT-E2E-1" }), { status: 200 });
      })
    );
    const ap = await api("POST", `/api/projects/${projectId}/approve`);
    expect(ap.status).toBe(202);
    await runOnce("e2e");
    const [p] = await query<any[]>("SELECT stage, publish_at FROM projects WHERE id = ?", [projectId]);
    expect(p.stage).toBe("scheduled");
    expect(p.publish_at).toBeTruthy();
    const ups = await query<any[]>("SELECT * FROM uploads WHERE project_id = ? AND state = 'scheduled'", [projectId]);
    expect(ups.length).toBe(1);
    expect(ups[0].youtube_video_id).toBe("YT-E2E-1");
    const hhmm = String(ups[0].publish_at).slice(11, 16);
    expect(["09:00", "18:00"]).toContain(hhmm);
    vi.unstubAllGlobals();
  }, 60000);

  it("refuses to approve a video that is not waiting for approval, and records rejections", async () => {
    expect((await api("POST", `/api/projects/${projectId}/approve`)).status).toBe(409);
    const plan = planFor("reject");
    made.push(plan.id);
    const imp = await api("POST", "/api/projects/import", { plan, channelId, autoStart: false });
    await runShortProject(imp.json.id, deps);
    expect((await api("POST", `/api/projects/${imp.json.id}/reject`, {})).status).toBe(400);
    const rj = await api("POST", `/api/projects/${imp.json.id}/reject`, { reason: "Hook too slow" });
    expect(rj.status).toBe(200);
    expect((await api("GET", `/api/projects/${imp.json.id}/review`)).json.stage).toBe("rejected");
  }, 240000);

  it("fails a run cleanly, records why, and can restart it", async () => {
    const plan = planFor("fail");
    made.push(plan.id);
    const imp = await api("POST", "/api/projects/import", { plan, channelId, autoStart: false });
    const broken: ClipProvider = { ...fakeClips, generateClip: async () => Promise.reject(new Error("site down")) };
    await expect(runShortProject(imp.json.id, { ...deps, clipOptions: { order: ["fake"], providers: { fake: broken }, quotas: {} } })).rejects.toThrow(/site down/);
    const r = await api("GET", `/api/projects/${imp.json.id}/review`);
    expect(r.json.stage).toBe("failed");
    expect(r.json.error).toContain("site down");
    const rs = await api("POST", `/api/projects/${imp.json.id}/restart`);
    expect(rs.status).toBe(202);
    expect((await api("GET", `/api/projects/${imp.json.id}/review`)).json.stage).toBe("planned");
  }, 120000);

  it("exposes system overview, settings, niches and jobs", async () => {
    const o = await api("GET", "/api/system/overview");
    expect(o.status).toBe(200);
    expect(o.json.usage["google-flow"].quota).toBe(50);
    expect(o.json.providers.clips.find((c: any) => c.id === "veoframe").ok).toBe(false);
    expect((await api("PUT", "/api/system/settings", { provider_order: ["nope"] })).status).toBe(400);
    const s = await api("PUT", "/api/system/settings", { provider_order: ["veoframe", "google-flow"], concurrency: 3 });
    expect(s.json.provider_order).toEqual(["veoframe", "google-flow"]);
    await query("DELETE FROM settings");
    expect((await api("GET", "/api/system/niches")).json[0].id).toBe("space_science_curiosity");
    expect(Array.isArray((await api("GET", "/api/system/jobs")).json)).toBe(true);
  });

  it("serves the hook library and lints hooks over the API", async () => {
    const lib = await api("GET", "/api/hooks/library");
    expect(lib.json.templates.length).toBe(24);
    const good = await api("POST", "/api/hooks/lint", { line: "Saturn is lighter than water.", visual: "A huge golden ringed planet floating like a beach ball on a calm endless dark ocean at dusk.", format: "short", title: "Saturn would float on water" });
    expect(good.json.passed).toBe(true);
    const bad = await api("POST", "/api/hooks/lint", { line: "Hey guys, today we look at Saturn.", format: "short" });
    expect(bad.json.passed).toBe(false);
    expect((await api("POST", "/api/hooks/lint", {})).status).toBe(400);
  });
});
