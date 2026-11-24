// Minimal YouTube Data API client using fetch (no SDK): OAuth for a desktop/web client, resumable upload,
// custom thumbnails. It has not been run against the live API here (no Google credentials on this machine);
// request shapes follow Google's published documentation and are unit-tested with a mocked fetch.
import fs from "fs";
import path from "path";
import { loadConfig } from "../config";

export const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

const TOKEN_FILE = () => process.env.YOUTUBE_TOKEN_FILE || path.join(process.cwd(), "storage", "secrets", "youtube-token.json");

export interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope?: string;
}

export function isConfigured(): boolean {
  const c = loadConfig();
  return !!(c.YOUTUBE_CLIENT_ID && c.YOUTUBE_CLIENT_SECRET);
}

export function hasToken(): boolean {
  return fs.existsSync(TOKEN_FILE());
}

export function buildAuthUrl(state: string): string {
  const c = loadConfig();
  const q = new URLSearchParams({
    client_id: c.YOUTUBE_CLIENT_ID || "",
    redirect_uri: c.YOUTUBE_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

async function tokenRequest(body: Record<string, string>): Promise<any> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google token request failed (${res.status}): ${json.error_description || json.error || "unknown error"}`);
  return json;
}

function saveToken(t: StoredToken) {
  fs.mkdirSync(path.dirname(TOKEN_FILE()), { recursive: true });
  fs.writeFileSync(TOKEN_FILE(), JSON.stringify(t, null, 2), { mode: 0o600 });
}

export async function exchangeCode(code: string): Promise<void> {
  const c = loadConfig();
  const j = await tokenRequest({
    code,
    client_id: c.YOUTUBE_CLIENT_ID || "",
    client_secret: c.YOUTUBE_CLIENT_SECRET || "",
    redirect_uri: c.YOUTUBE_REDIRECT_URI,
    grant_type: "authorization_code",
  });
  if (!j.refresh_token) throw new Error("Google did not return a refresh token; remove the app's access in your Google account and connect again.");
  saveToken({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in - 60) * 1000, scope: j.scope });
}

export async function getAccessToken(): Promise<string> {
  if (!hasToken()) throw new Error("YouTube is not connected. Open /api/youtube/auth-url, sign in, and approve access.");
  const t: StoredToken = JSON.parse(fs.readFileSync(TOKEN_FILE(), "utf-8"));
  if (t.expires_at > Date.now()) return t.access_token;
  const c = loadConfig();
  const j = await tokenRequest({
    client_id: c.YOUTUBE_CLIENT_ID || "",
    client_secret: c.YOUTUBE_CLIENT_SECRET || "",
    refresh_token: t.refresh_token,
    grant_type: "refresh_token",
  });
  saveToken({ ...t, access_token: j.access_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 });
  return j.access_token;
}

export interface UploadInput {
  file: string;
  title: string;
  description: string;
  tags: string[];
  privacy: "private" | "unlisted" | "public";
  /** ISO time; only valid together with privacy 'private'. YouTube then publishes the video at that time. */
  publishAt?: string;
  language?: string;
  categoryId?: string;
  /** Always true for AI-generated realistic footage. */
  containsSyntheticMedia?: boolean;
  /** Defaults to false (these videos are never made for kids). */
  madeForKids?: boolean;
  /** Upload file name hint (sent as the Slug header), e.g. "saturn-floats-on-water.mp4". */
  fileName?: string;
}

export function buildUploadMetadata(i: UploadInput) {
  if (i.publishAt && i.privacy !== "private") throw new Error("publishAt requires privacy 'private'");
  return {
    snippet: {
      title: i.title.slice(0, 100),
      description: i.description.slice(0, 5000),
      tags: i.tags.slice(0, 30),
      categoryId: i.categoryId || "28",
      defaultLanguage: i.language || "en",
      defaultAudioLanguage: i.language || "en",
    },
    status: {
      privacyStatus: i.privacy,
      ...(i.publishAt ? { publishAt: i.publishAt } : {}),
      selfDeclaredMadeForKids: i.madeForKids === true,
      containsSyntheticMedia: i.containsSyntheticMedia !== false,
    },
  };
}

/** Resumable upload (https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol). Returns the video id. */
export async function uploadVideo(i: UploadInput): Promise<string> {
  const token = await getAccessToken();
  const bytes = fs.readFileSync(i.file);
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(bytes.length),
      "X-Upload-Content-Type": "video/mp4",
      ...(i.fileName ? { Slug: i.fileName } : {}),
    },
    body: JSON.stringify(buildUploadMetadata(i)),
  });
  if (!init.ok) throw new Error(`YouTube upload init failed (${init.status}): ${(await init.text().catch(() => "")).slice(0, 300)}`);
  const location = init.headers.get("location");
  if (!location) throw new Error("YouTube did not return an upload URL");
  const put = await fetch(location, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.length) }, body: bytes });
  if (!put.ok) throw new Error(`YouTube upload failed (${put.status}): ${(await put.text().catch(() => "")).slice(0, 300)}`);
  const json: any = await put.json();
  if (!json.id) throw new Error("YouTube upload finished but returned no video id");
  return json.id as string;
}

/** captions.insert (multipart upload of an SRT track). https://developers.google.com/youtube/v3/docs/captions/insert */
export async function uploadCaptions(videoId: string, srt: string, language = "en", name = "Captions"): Promise<void> {
  const token = await getAccessToken();
  const boundary = `cap${Date.now().toString(36)}`;
  const meta = JSON.stringify({ snippet: { videoId, language, name, isDraft: false } });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${srt}\r\n--${boundary}--`;
  const res = await fetch("https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`YouTube captions upload failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
}

export async function setThumbnail(videoId: string, file: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png" },
    body: fs.readFileSync(file),
  });
  if (!res.ok) throw new Error(`YouTube thumbnail upload failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
}
