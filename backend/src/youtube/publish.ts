// Publishing: upload a finished video to YouTube with its SEO package (chosen title, description, tags, category),
// the selected thumbnail and an SRT captions track, always flagged as synthetic media and not made for kids.
//
// Privacy: "private" | "unlisted" | "public" upload as given; "scheduled" (or "private" with a publishAt) uploads as
// private and YouTube publishes it at publishAt. Without a privacy (the older approval flow) the video is scheduled at
// the channel's next free slot (youtube/schedule.ts), honouring its daily cap. Nothing is uploaded before this runs.
import fs from "fs";
import path from "path";
import { query } from "../db";
import { logger } from "../log";
import { FatalJobError } from "../jobs/worker";
import { STORAGE_ROOT, setStage } from "../shorts/run";
import { srtFromWordFiles } from "./captions";
import { hasToken, isConfigured, setThumbnail, uploadCaptions, uploadVideo } from "./client";
import { nextPublishSlot } from "./schedule";

export function notConnectedReason(): string | null {
  if (!isConfigured()) return "YouTube is not configured: set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in backend/.env.";
  if (!hasToken()) return "YouTube is not connected: open /api/youtube/auth-url, sign in with your Google account and approve access.";
  return null;
}

export type PublishPrivacy = "private" | "unlisted" | "public" | "scheduled";
export interface PublishOptions {
  privacy?: PublishPrivacy;
  /** ISO time; used with privacy "scheduled" (or "private"). */
  publishAt?: string;
}

const mysqlDate = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

const CATEGORY_IDS: Record<string, string> = {
  "film & animation": "1",
  "autos & vehicles": "2",
  music: "10",
  "pets & animals": "15",
  sports: "17",
  gaming: "20",
  "people & blogs": "22",
  comedy: "23",
  entertainment: "24",
  "news & politics": "25",
  "howto & style": "26",
  education: "27",
  "science & technology": "28",
  science: "28",
  technology: "28",
  history: "27",
};

/** The SEO package stores a category as an id ("28") or a name ("Science & Technology"). Defaults to Science & Technology. */
export function categoryId(category: unknown): string {
  const c = String(category ?? "").trim();
  if (/^\d+$/.test(c)) return c;
  return CATEGORY_IDS[c.toLowerCase()] || "28";
}

function parseJson<T>(raw: unknown): T | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw as T;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return null;
  }
}

export interface BuiltMetadata {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  language: string;
  fileName?: string;
}

/** Pure: the YouTube metadata of a project row (uses seo_json when present, falls back to title/description/plan tags). */
export function buildProjectMetadata(proj: any, projectId: number): BuiltMetadata {
  const seo = parseJson<any>(proj.seo_json);
  const plan = parseJson<any>(proj.plan_json) || {};
  const isShort = proj.format === "short";
  const title = String(proj.chosen_title || seo?.chosenTitle || proj.title || plan.title || `Video ${projectId}`).trim();
  let description = String(seo?.description ?? proj.description ?? plan.description ?? "");
  const hashtags: string[] = (seo?.hashtags || []).map((h: string) => (h.startsWith("#") ? h : `#${h}`));
  const missing = hashtags.filter((h) => !description.toLowerCase().includes(h.toLowerCase()));
  if (missing.length) description += `\n\n${missing.join(" ")}`;
  if (isShort && !/#shorts\b/i.test(description)) description += `${missing.length ? " " : "\n\n"}#Shorts`;
  const tags: string[] = seo?.tags?.length ? seo.tags : plan.tags || [];
  const slug = seo?.mainKeyword ? slugify(String(seo.mainKeyword)) : "";
  return {
    title,
    description,
    tags,
    categoryId: categoryId(seo?.category),
    language: proj.language || "en",
    fileName: slug ? `${slug}.mp4` : undefined,
  };
}

/** The thumbnail to upload: the selected one (thumbnail_path), else the first of thumbnails_json. Shorts only when a thumbnail was made on purpose. */
export function pickThumbnail(proj: any): string | null {
  const list = parseJson<{ variant: string; path: string }[]>(proj.thumbnails_json);
  if (proj.thumbnail_path && (proj.format !== "short" || list?.length)) return proj.thumbnail_path;
  if (list?.length) return list[0].path;
  return null;
}

async function srtForProject(proj: any, projectId: number): Promise<string> {
  const shots = await query<any[]>("SELECT shot_number, duration_seconds FROM shots WHERE project_id = ? ORDER BY shot_number", [projectId]);
  if (!shots.length) return "";
  const ids = shots.map((s) => `shot-${s.shot_number}`);
  const secs = shots.map((s) => Math.min(8, Math.max(2, Number(s.duration_seconds) || 8)));
  const work = path.join(STORAGE_ROOT, "shorts", `project-${projectId}`, "work");
  const plan = parseJson<any>(proj.plan_json);
  const delay = typeof plan?.narration?.delay === "number" ? plan.narration.delay : 0.25;
  return srtFromWordFiles(work, ids, secs, delay);
}

export async function publishProject(projectId: number, opts: PublishOptions = {}): Promise<{ videoId: string; publishAt: string | null }> {
  const [proj] = await query<any[]>("SELECT * FROM projects WHERE id = ?", [projectId]);
  if (!proj) throw new FatalJobError(`Project ${projectId} not found`);
  if (!proj.final_video_path) throw new FatalJobError("Project has no finished video to upload.");
  const modern = !!(proj.seo_json || proj.chosen_title);

  const fail = async (message: string) => {
    if (modern) {
      await query("UPDATE projects SET stage = 'video ready', publish_status = 'failed', error_message = ? WHERE id = ?", [message.slice(0, 1000), projectId]);
    } else {
      await setStage(projectId, "awaiting_approval", { error: message });
    }
  };

  const reason = notConnectedReason();
  if (reason) {
    await query("INSERT INTO uploads (project_id, privacy, state, error) VALUES (?, ?, 'failed', ?)", [projectId, opts.privacy === "scheduled" || !opts.privacy ? "private" : opts.privacy, reason]);
    await fail(reason);
    throw new FatalJobError(reason);
  }

  // Resolve privacy and the publish time.
  let privacy: "private" | "unlisted" | "public" = "private";
  let when: Date | null = null;
  if (opts.privacy === "unlisted" || opts.privacy === "public") {
    privacy = opts.privacy;
  } else if (opts.publishAt) {
    when = new Date(opts.publishAt);
    if (Number.isNaN(when.getTime())) throw new FatalJobError(`Invalid publishAt: ${opts.publishAt}`);
  } else if (opts.privacy !== "private") {
    // "scheduled" without a time, or the older flow: the channel's next free slot.
    let channel: any = null;
    if (proj.channel_id) [channel] = await query<any[]>("SELECT * FROM channels WHERE id = ?", [proj.channel_id]);
    const timeZone = channel?.timezone || "UTC";
    let slots: string[] = [];
    try {
      slots = JSON.parse(channel?.publish_slots || "[]");
    } catch {
      slots = [];
    }
    const takenRows = await query<any[]>(
      "SELECT u.publish_at FROM uploads u JOIN projects p ON p.id = u.project_id WHERE u.publish_at IS NOT NULL AND u.state IN ('scheduled','public','private') AND (? IS NULL OR p.channel_id = ?)",
      [proj.channel_id ?? null, proj.channel_id ?? null]
    );
    const cap = proj.format === "short" ? channel?.daily_cap_shorts : channel?.daily_cap_long;
    when = nextPublishSlot({ slots, timeZone, now: new Date(), taken: takenRows.map((r) => String(r.publish_at).replace(" ", "T") + "Z"), dailyCap: cap || undefined });
  }

  const meta = buildProjectMetadata(proj, projectId);
  const up = await query<any>("INSERT INTO uploads (project_id, privacy, publish_at, state) VALUES (?, ?, ?, 'uploading')", [projectId, privacy, when ? mysqlDate(when) : null]);
  const uploadId = Number(up.insertId);
  if (modern) await query("UPDATE projects SET stage = 'publishing', publish_status = 'publishing', error_message = NULL WHERE id = ?", [projectId]);

  try {
    const videoId = await uploadVideo({
      file: path.join(STORAGE_ROOT, proj.final_video_path),
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      privacy,
      publishAt: when ? when.toISOString() : undefined,
      language: meta.language,
      categoryId: meta.categoryId,
      containsSyntheticMedia: true,
      madeForKids: false,
      fileName: meta.fileName,
    });
    // The video is up from here on: a failed thumbnail or captions upload is recorded but does not fail the publish.
    await query("UPDATE projects SET youtube_video_id = ? WHERE id = ?", [videoId, projectId]);

    let thumbnailSet = false;
    const thumb = pickThumbnail(proj);
    if (thumb) {
      try {
        const file = path.join(STORAGE_ROOT, thumb);
        if (fs.existsSync(file)) {
          await setThumbnail(videoId, file);
          thumbnailSet = true;
        }
      } catch (err) {
        logger.warn("thumbnail upload failed", { projectId, videoId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    let captionsSet = false;
    try {
      const srt = await srtForProject(proj, projectId);
      if (srt.trim()) {
        await uploadCaptions(videoId, srt, meta.language, "Captions");
        captionsSet = true;
      }
    } catch (err) {
      logger.warn("captions upload failed", { projectId, videoId, error: err instanceof Error ? err.message : String(err) });
    }

    const state = privacy === "private" && when ? "scheduled" : privacy;
    await query("UPDATE uploads SET youtube_video_id = ?, state = ? WHERE id = ?", [videoId, state, uploadId]);
    try {
      await query("UPDATE uploads SET seo_snapshot_json = ?, thumbnail_set = ?, captions_set = ? WHERE id = ?", [JSON.stringify(meta), thumbnailSet ? 1 : 0, captionsSet ? 1 : 0, uploadId]);
    } catch {
      // these columns come from migration 005; older databases simply do not record them
    }
    if (when) await query("UPDATE projects SET publish_at = ? WHERE id = ?", [mysqlDate(when), projectId]);
    if (modern) {
      await query("UPDATE projects SET stage = 'published', publish_status = ?, error_message = NULL WHERE id = ?", [when ? "scheduled" : privacy, projectId]);
    } else {
      await setStage(projectId, "scheduled");
    }
    logger.info("video uploaded to YouTube", { projectId, videoId, privacy, publishAt: when?.toISOString() ?? null, thumbnailSet, captionsSet });
    return { videoId, publishAt: when ? when.toISOString() : null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await query("UPDATE uploads SET state = 'failed', error = ? WHERE id = ?", [message.slice(0, 1000), uploadId]);
    await fail(`Upload failed: ${message}`);
    throw err;
  }
}
