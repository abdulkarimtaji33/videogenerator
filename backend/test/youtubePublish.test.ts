import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

const { root, calls, rows } = await vi.hoisted(async () => {
  const nodeFs = await import("fs");
  const nodeOs = await import("os");
  const nodePath = await import("path");
  return {
    root: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "pubroot-")) as string,
    calls: [] as { sql: string; params: any[] }[],
    rows: {} as Record<string, any>,
  };
});

vi.mock("../src/db", () => ({
  query: vi.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (/^SELECT \* FROM projects/.test(sql)) return rows.project ? [rows.project] : [];
    if (/FROM shots/.test(sql)) return rows.shots || [];
    if (/^SELECT \* FROM channels/.test(sql)) return [];
    if (/^SELECT u\.publish_at/.test(sql)) return [];
    if (/^INSERT INTO uploads/.test(sql)) return { insertId: 55 };
    return { affectedRows: 1 };
  }),
}));
vi.mock("../src/jobs/worker", () => ({ FatalJobError: class FatalJobError extends Error {} }));
vi.mock("../src/shorts/run", () => ({ STORAGE_ROOT: root, setStage: vi.fn(async () => undefined) }));
vi.mock("../src/log", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../src/youtube/client", () => ({
  isConfigured: vi.fn(() => true),
  hasToken: vi.fn(() => true),
  uploadVideo: vi.fn(async () => "VID9"),
  setThumbnail: vi.fn(async () => undefined),
  uploadCaptions: vi.fn(async () => undefined),
}));

import * as client from "../src/youtube/client";
import { buildProjectMetadata, categoryId, publishProject, slugify } from "../src/youtube/publish";

const seo = {
  mainKeyword: "Saturn Floats on Water?",
  relatedKeywords: [],
  titles: [],
  chosenTitle: "Saturn Would Float On Water. Here Is Why",
  description: "Saturn is less dense than water.\nMain phrase: saturn floats.",
  tags: ["saturn", "space"],
  hashtags: ["space", "#saturn"],
  category: "Science & Technology",
  thumbnailConcepts: [],
};

function project(extra: Record<string, any> = {}) {
  return {
    id: 7,
    format: "short",
    title: "old title",
    final_video_path: "shorts/project-7/final/v.mp4",
    seo_json: JSON.stringify(seo),
    chosen_title: "Saturn Would Float On Water. Here Is Why",
    thumbnail_path: "shorts/project-7/thumb.png",
    thumbnails_json: JSON.stringify([{ variant: "A", path: "shorts/project-7/thumb.png" }]),
    channel_id: null,
    language: "en",
    plan_json: null,
    ...extra,
  };
}

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  fs.mkdirSync(path.join(root, "shorts", "project-7", "work"), { recursive: true });
  fs.writeFileSync(path.join(root, "shorts", "project-7", "thumb.png"), "png");
  fs.writeFileSync(path.join(root, "shorts", "project-7", "work", "words-shot-1.json"), JSON.stringify([{ word: "Saturn", start: 0, end: 0.5 }]));
  rows.project = project();
  rows.shots = [{ shot_number: 1, duration_seconds: 8 }, { shot_number: 2, duration_seconds: 8 }];
});

describe("publish metadata", () => {
  it("slugifies the main keyword and maps categories", () => {
    expect(slugify("Saturn Floats on Water?")).toBe("saturn-floats-on-water");
    expect(categoryId("Science & Technology")).toBe("28");
    expect(categoryId("27")).toBe("27");
    expect(categoryId(undefined)).toBe("28");
  });

  it("builds from seo_json: chosen title, hashtags, #Shorts, file name", () => {
    const m = buildProjectMetadata(project(), 7);
    expect(m.title).toBe("Saturn Would Float On Water. Here Is Why");
    expect(m.tags).toEqual(["saturn", "space"]);
    expect(m.description).toContain("Saturn is less dense than water.");
    expect(m.description).toContain("#space #saturn");
    expect(m.description.trim().endsWith("#Shorts")).toBe(true);
    expect(m.fileName).toBe("saturn-floats-on-water.mp4");
  });

  it("falls back to title, description and plan tags for old projects", () => {
    const m = buildProjectMetadata({ format: "long", title: "Old", description: "Desc", seo_json: null, chosen_title: null, plan_json: JSON.stringify({ tags: ["a"] }) }, 3);
    expect(m).toMatchObject({ title: "Old", description: "Desc", tags: ["a"], categoryId: "28", language: "en", fileName: undefined });
  });
});

describe("upload payload", () => {
  it("puts category, language, synthetic and made-for-kids flags into the YouTube request body", async () => {
    const actual = await vi.importActual<typeof import("../src/youtube/client")>("../src/youtube/client");
    const m = actual.buildUploadMetadata({ file: "x", title: "T", description: "D", tags: ["a"], privacy: "private", publishAt: "2030-01-01T09:00:00.000Z", categoryId: "27", language: "ur", containsSyntheticMedia: true, madeForKids: false });
    expect(m.snippet).toMatchObject({ title: "T", description: "D", tags: ["a"], categoryId: "27", defaultLanguage: "ur" });
    expect(m.status).toMatchObject({ privacyStatus: "private", publishAt: "2030-01-01T09:00:00.000Z", containsSyntheticMedia: true, selfDeclaredMadeForKids: false });
  });
});

describe("publishProject (mocked YouTube)", () => {
  it("uploads with the SEO package, thumbnail and captions, flagged synthetic", async () => {
    const r = await publishProject(7, { privacy: "scheduled", publishAt: "2030-01-01T09:00:00.000Z" });
    expect(r).toEqual({ videoId: "VID9", publishAt: "2030-01-01T09:00:00.000Z" });
    const input: any = vi.mocked(client.uploadVideo).mock.calls[0][0];
    expect(input).toMatchObject({
      title: "Saturn Would Float On Water. Here Is Why",
      tags: ["saturn", "space"],
      categoryId: "28",
      privacy: "private",
      publishAt: "2030-01-01T09:00:00.000Z",
      containsSyntheticMedia: true,
      madeForKids: false,
      language: "en",
      fileName: "saturn-floats-on-water.mp4",
      file: path.join(root, "shorts/project-7/final/v.mp4"),
    });
    expect(vi.mocked(client.setThumbnail)).toHaveBeenCalledWith("VID9", path.join(root, "shorts/project-7/thumb.png"));
    const [vid, srt, lang] = vi.mocked(client.uploadCaptions).mock.calls[0];
    expect(vid).toBe("VID9");
    expect(srt).toContain("00:00:00,250 --> 00:00:00,750\nSaturn");
    expect(lang).toBe("en");
    const sql = calls.map((c) => c.sql).join("\n");
    expect(sql).toContain("youtube_video_id = ?");
    const done = calls.find((c) => /stage = 'published'/.test(c.sql))!;
    expect(done.params[0]).toBe("scheduled");
  });

  it("uploads public videos immediately (no publishAt) and records the privacy", async () => {
    await publishProject(7, { privacy: "public" });
    const input: any = vi.mocked(client.uploadVideo).mock.calls[0][0];
    expect(input.privacy).toBe("public");
    expect(input.publishAt).toBeUndefined();
    expect(calls.find((c) => /stage = 'published'/.test(c.sql))!.params[0]).toBe("public");
  });

  it("keeps working for old projects without seo_json", async () => {
    rows.project = project({ seo_json: null, chosen_title: null, thumbnail_path: null, thumbnails_json: null, description: "Old description", plan_json: JSON.stringify({ tags: ["x"] }) });
    await publishProject(7);
    const input: any = vi.mocked(client.uploadVideo).mock.calls[0][0];
    expect(input.title).toBe("old title");
    expect(input.tags).toEqual(["x"]);
    expect(input.description).toBe("Old description\n\n#Shorts");
    expect(input.privacy).toBe("private");
    expect(input.publishAt).toBeTruthy(); // next channel slot, as before
    expect(vi.mocked(client.setThumbnail)).not.toHaveBeenCalled();
  });

  it("does not fail the publish when captions fail, and refuses when YouTube is not connected", async () => {
    vi.mocked(client.uploadCaptions).mockRejectedValueOnce(new Error("captions 403"));
    await expect(publishProject(7, { privacy: "unlisted" })).resolves.toMatchObject({ videoId: "VID9" });
    vi.mocked(client.hasToken).mockReturnValueOnce(false);
    await expect(publishProject(7, { privacy: "unlisted" })).rejects.toThrow(/not connected/);
    expect(calls.some((c) => /publish_status = 'failed'/.test(c.sql))).toBe(true);
  });

  it("marks the project failed when the upload itself fails", async () => {
    vi.mocked(client.uploadVideo).mockRejectedValueOnce(new Error("YouTube upload init failed (403)"));
    await expect(publishProject(7, { privacy: "public" })).rejects.toThrow(/403/);
    expect(calls.some((c) => /publish_status = 'failed'/.test(c.sql) && /Upload failed/.test(String(c.params[0])))).toBe(true);
  });
});
