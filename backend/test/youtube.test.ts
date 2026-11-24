import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { query } from "../src/db";
import { nextPublishSlot, zonedTimeToUtc } from "../src/youtube/schedule";
import { SCOPES, buildAuthUrl, buildUploadMetadata, exchangeCode, getAccessToken, setThumbnail, uploadVideo } from "../src/youtube/client";
import { fetchVideoStats, pullAllStats, weeklyReportData } from "../src/youtube/analytics";
import { notifyAwaitingApproval, reviewUrl, sendEmail } from "../src/notify/email";
import { parsePlan } from "../src/shorts/plan";
import { makeImage, tmpDir } from "./helpers";

const require = createRequire(import.meta.url);
const raw = () => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "sample-plan.json"), "utf-8"));

beforeAll(async () => {
  const { migrate } = require("../scripts/migrate.js");
  await migrate({ database: "videogenerator_test" });
});

afterEach(() => vi.unstubAllGlobals());

describe("publish slots in a time zone", () => {
  it("converts local wall-clock time to UTC, including daylight saving", () => {
    expect(zonedTimeToUtc(2026, 11, 21, 9, 0, "America/New_York").toISOString()).toBe("2026-11-21T14:00:00.000Z"); // EST, UTC-5
    expect(zonedTimeToUtc(2026, 3, 9, 9, 0, "America/New_York").toISOString()).toBe("2026-03-09T13:00:00.000Z"); // EDT, UTC-4
    expect(zonedTimeToUtc(2026, 11, 21, 9, 0, "Asia/Tokyo").toISOString()).toBe("2026-11-21T00:00:00.000Z"); // UTC+9
    expect(zonedTimeToUtc(2026, 11, 21, 9, 0, "UTC").toISOString()).toBe("2026-11-21T09:00:00.000Z");
  });

  it("picks the next free slot, skipping taken slots, the daily cap and the lead time", () => {
    const now = new Date("2026-11-21T10:00:00Z");
    const slots = ["09:00", "18:00"];
    expect(nextPublishSlot({ slots, timeZone: "UTC", now }).toISOString()).toBe("2026-11-21T18:00:00.000Z");
    expect(nextPublishSlot({ slots, timeZone: "UTC", now, taken: ["2026-11-21T18:00:00.000Z"] }).toISOString()).toBe("2026-11-22T09:00:00.000Z");
    expect(nextPublishSlot({ slots, timeZone: "UTC", now, taken: ["2026-11-21T18:00:00.000Z"], dailyCap: 1 }).toISOString()).toBe("2026-11-22T09:00:00.000Z");
    expect(nextPublishSlot({ slots: ["10:05"], timeZone: "UTC", now, leadMinutes: 15 }).toISOString()).toBe("2026-11-22T10:05:00.000Z"); // 10:05 is inside the 15-minute lead
  });
});

describe("YouTube client (mocked network)", () => {
  const env = (tokenFile: string) => {
    process.env.YOUTUBE_CLIENT_ID = "cid";
    process.env.YOUTUBE_CLIENT_SECRET = "secret";
    process.env.YOUTUBE_TOKEN_FILE = tokenFile;
  };
  const writeToken = (file: string, expiresAt: number) => fs.writeFileSync(file, JSON.stringify({ access_token: "tok", refresh_token: "ref", expires_at: expiresAt }));

  it("builds the sign-in URL with offline access and every scope", () => {
    env(path.join(tmpDir("tok"), "t.json"));
    const u = new URL(buildAuthUrl("abc"));
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("state")).toBe("abc");
    for (const s of SCOPES) expect(u.searchParams.get("scope")).toContain(s);
  });

  it("marks uploads as synthetic and only schedules private videos", () => {
    const base = { file: "x", title: "t".repeat(150), description: "d", tags: ["a"], privacy: "private" as const, publishAt: "2026-11-22T09:00:00.000Z" };
    const m = buildUploadMetadata(base);
    expect(m.status.privacyStatus).toBe("private");
    expect(m.status.publishAt).toBe(base.publishAt);
    expect(m.status.containsSyntheticMedia).toBe(true);
    expect(m.status.selfDeclaredMadeForKids).toBe(false);
    expect(m.snippet.title.length).toBe(100);
    expect(() => buildUploadMetadata({ ...base, privacy: "public" })).toThrow(/private/);
  });

  it("uploads with the resumable protocol and returns the video id", async () => {
    const dir = tmpDir("up");
    env(path.join(dir, "t.json"));
    writeToken(path.join(dir, "t.json"), Date.now() + 3600_000);
    const video = path.join(dir, "v.mp4");
    fs.writeFileSync(video, Buffer.alloc(2048, 1));
    const calls: { url: string; init: any }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: any) => {
        calls.push({ url, init });
        if (init.method === "POST") return new Response("", { status: 200, headers: { location: "https://upload.example/session1" } });
        return new Response(JSON.stringify({ id: "VID123" }), { status: 200 });
      })
    );
    const id = await uploadVideo({ file: video, title: "Saturn floats", description: "d", tags: [], privacy: "private", publishAt: "2026-11-22T09:00:00.000Z" });
    expect(id).toBe("VID123");
    expect(calls[0].url).toContain("uploadType=resumable");
    expect(calls[0].init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(calls[0].init.body).status.containsSyntheticMedia).toBe(true);
    expect(calls[1].url).toBe("https://upload.example/session1");
    expect(calls[1].init.method).toBe("PUT");
  });

  it("refreshes an expired access token and stores the new one", async () => {
    const dir = tmpDir("ref");
    env(path.join(dir, "t.json"));
    writeToken(path.join(dir, "t.json"), Date.now() - 1000);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 }), { status: 200 })));
    expect(await getAccessToken()).toBe("fresh");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "t.json"), "utf-8")).access_token).toBe("fresh");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "t.json"), "utf-8")).refresh_token).toBe("ref");
  });

  it("explains when YouTube is not connected, and when Google returns no refresh token", async () => {
    const dir = tmpDir("none");
    env(path.join(dir, "missing.json"));
    await expect(getAccessToken()).rejects.toThrow(/not connected/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "a", expires_in: 3600 }), { status: 200 })));
    await expect(exchangeCode("code")).rejects.toThrow(/refresh token/);
  });

  it("surfaces upload and thumbnail errors with the status code", async () => {
    const dir = tmpDir("err");
    env(path.join(dir, "t.json"));
    writeToken(path.join(dir, "t.json"), Date.now() + 3600_000);
    const video = path.join(dir, "v.mp4");
    fs.writeFileSync(video, "x");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quotaExceeded", { status: 403 })));
    await expect(uploadVideo({ file: video, title: "t", description: "", tags: [], privacy: "private" })).rejects.toThrow(/403/);
    const img = path.join(dir, "t.png");
    await makeImage(img, 320, 180);
    await expect(setThumbnail("VID", img)).rejects.toThrow(/403/);
  });
});

describe("analytics (mocked network)", () => {
  it("reads stats and the retention curve from the Analytics API", async () => {
    const dir = tmpDir("an");
    process.env.YOUTUBE_TOKEN_FILE = path.join(dir, "t.json");
    fs.writeFileSync(process.env.YOUTUBE_TOKEN_FILE, JSON.stringify({ access_token: "tok", refresh_token: "r", expires_at: Date.now() + 3600_000 }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url.includes("dimensions=elapsedVideoTimeRatio")
          ? { columnHeaders: [{ name: "elapsedVideoTimeRatio" }, { name: "audienceWatchRatio" }], rows: [[0.01, 1.0], [0.5, 0.62]] }
          : { columnHeaders: [{ name: "views" }, { name: "estimatedMinutesWatched" }, { name: "averageViewDuration" }, { name: "averageViewPercentage" }, { name: "subscribersGained" }], rows: [[1200, 340, 21, 66.5, 9]] };
        return new Response(JSON.stringify(body), { status: 200 });
      })
    );
    const s = await fetchVideoStats("VID", new Date("2026-11-01"), new Date("2026-11-21"));
    expect(s).toMatchObject({ views: 1200, averageViewPercentage: 66.5, subscribersGained: 9, date: "2026-11-21" });
    expect(s.retention).toEqual([{ ratio: 0.01, watch: 1 }, { ratio: 0.5, watch: 0.62 }]);
  });

  it("stores dated snapshots per upload and builds the weekly report data", async () => {
    await query("DELETE FROM uploads");
    await query("DELETE FROM shots");
    await query("DELETE FROM projects");
    const plan = JSON.stringify({ hook: { type: "contrarian" } });
    const p1 = await query<any>("INSERT INTO projects (idea_prompt, title, plan_json, format) VALUES ('a', 'Video A', ?, 'short')", [plan]);
    const p2 = await query<any>("INSERT INTO projects (idea_prompt, title, plan_json, format) VALUES ('b', 'Video B', ?, 'short')", [plan]);
    await query("INSERT INTO uploads (project_id, youtube_video_id, state) VALUES (?, 'A1', 'scheduled'), (?, 'B1', 'scheduled')", [p1.insertId, p2.insertId]);
    const fetcher = async (id: string): Promise<any> => ({ date: "2026-11-21", views: id === "A1" ? 1000 : 100, estimatedMinutesWatched: 1, averageViewDuration: 1, averageViewPercentage: 1, subscribersGained: 0 });
    expect(await pullAllStats({ fetcher })).toBe(2);
    expect(await pullAllStats({ fetcher })).toBe(2); // same day: replaced, not duplicated
    const r = await weeklyReportData();
    expect(r.videos.length).toBe(2);
    const a = r.videos.find((v) => v.videoId === "A1");
    expect(a.latest.views).toBe(1000);
    expect(a.hookType).toBe("contrarian");
    expect(r.medianViews).toBe(1000);
    await query("DELETE FROM uploads");
    await query("DELETE FROM projects");
  });
});

describe("email notification", () => {
  beforeEach(() => {
    delete process.env.SMTP_HOST;
  });

  it("sends through a transport and includes the review link", async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const plan = parsePlan(raw());
    const spy = vi.spyOn(transport, "sendMail");
    expect(await notifyAwaitingApproval(7, plan, transport)).toBe(true);
    const sent: any = spy.mock.calls[0][0];
    expect(sent.subject).toContain(plan.title);
    expect(sent.text).toContain(reviewUrl(7));
  });

  it("is skipped quietly when SMTP is not configured", async () => {
    expect(await sendEmail({ subject: "x", text: "y" })).toBe(false);
  });
});
