import type { ImageProviderId, ImageSystemStatus, ImageTestResult, TextSystemStatus, TextTestResult, ProjectWithShots, PublishPrivacy, VeoframeStatus, VideoFormat } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4501";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * A deploy restarts the backend process for a second or two; a request that lands in that
 * window gets a connection-level failure (not an HTTP error), so a couple of short retries
 * absorb that blip instead of surfacing "could not reach the backend" for a transient restart.
 */
async function fetchWithRetry(url: string, init: RequestInit, retries = 2, delayMs = 400): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === "string") return data.error;
  } catch {
    // response body wasn't JSON; fall through to a generic message
  }
  return `Request failed with status ${res.status}`;
}

/** JSON request with the shared error handling; returns the parsed body (or null for an empty body). */
async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${API_URL}${path}`, {
      method,
      cache: "no-store",
      ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }
  if (!res.ok) throw new ApiError(await parseErrorMessage(res), res.status);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export interface NewProjectInput {
  idea: string;
  /** "auto" or a niche profile id */
  niche: string;
  format: VideoFormat;
  lengthSeconds: number;
  reviewEnabled: boolean;
  autoPublish: boolean;
  channelId?: number;
  mode: "plan" | "full";
  imageProvider?: ImageProviderId | string;
  imageFallback?: boolean;
  /** Spoken language: "en" (default), "ur" (Urdu) or "hi" (Hindi). Captions of ur/hi videos are Roman letters. */
  language?: "en" | "ur" | "hi";
}

export function createProject(input: NewProjectInput): Promise<{ id: number }> {
  return request<{ id: number }>("/api/projects", "POST", input);
}

/** Re-runs the whole plan from the idea (the backend has no per-stage replan). */
export function replanProject(projectId: number): Promise<void> {
  return request<void>(`/api/projects/${projectId}/replan`, "POST", {});
}

export function chooseTitle(projectId: number, chosenTitle: string): Promise<void> {
  return request<void>(`/api/projects/${projectId}/seo`, "PATCH", { chosenTitle });
}

export function chooseThumbnail(projectId: number, variant: "A" | "B"): Promise<void> {
  return request<void>(`/api/projects/${projectId}/thumbnail`, "POST", { variant });
}

export function publishProject(projectId: number, privacy: PublishPrivacy, publishAt?: string): Promise<void> {
  return request<void>(`/api/projects/${projectId}/publish`, "POST", { privacy, ...(publishAt ? { publishAt } : {}) });
}

export function fetchVeoframeStatus(): Promise<VeoframeStatus> {
  return request<VeoframeStatus>("/api/system/veoframe", "GET");
}

export async function fetchProject(id: string | number): Promise<ProjectWithShots> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${API_URL}/api/projects/${id}`, { cache: "no-store" });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }

  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json();
}

export function imageUrl(path: string): string {
  return `${API_URL}/api/images/${path}`;
}

/** The finished, narrated video of a project. */
export function finalVideoUrl(path: string): string {
  return `${API_URL}/api/media/${path}`;
}

/** One click: every missing clip is generated through Veoframe (then the fallbacks), then the video is assembled. */
export async function generateFullVideo(projectId: number): Promise<void> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${API_URL}/api/projects/${projectId}/video`, { method: "POST" });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }
  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
}

export async function generateShotVideo(projectId: number, shotId: number): Promise<void> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${API_URL}/api/projects/${projectId}/shots/${shotId}/video`, { method: "POST" });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }

  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
}

export async function regenerateShotImage(projectId: number, shotId: number): Promise<void> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${API_URL}/api/projects/${projectId}/shots/${shotId}/image`, { method: "POST" });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }

  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
}

export async function updateShotDuration(projectId: number, shotId: number, durationSeconds: number): Promise<void> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${API_URL}/api/projects/${projectId}/shots/${shotId}/duration`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationSeconds }),
    });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }

  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
}

export function fetchTextStatus(): Promise<TextSystemStatus> {
  return request<TextSystemStatus>("/api/system/text", "GET");
}

export function saveTextSettings(body: {
  provider?: string;
  geminiModel?: string;
  geminiThinking?: string;
  fallback?: boolean;
  ollamaUrl?: string;
  ollamaModel?: string;
  ollamaThink?: boolean;
  ollamaNumCtx?: number;
}): Promise<TextSystemStatus> {
  return request<TextSystemStatus>("/api/system/text", "PUT", body);
}

export function testTextProvider(provider?: string): Promise<TextTestResult> {
  return request<TextTestResult>("/api/system/text/test", "POST", provider ? { provider } : {});
}

export function fetchImageStatus(): Promise<ImageSystemStatus> {
  return request<ImageSystemStatus>("/api/system/images", "GET");
}

export function testImageProvider(provider?: string): Promise<ImageTestResult> {
  return request<ImageTestResult>("/api/system/images/test", "POST", provider ? { provider } : {});
}

export function saveImageSettings(body: { default?: string; fluxUrl?: string; fluxModel?: string; fluxSteps?: number }): Promise<ImageSystemStatus> {
  return request<ImageSystemStatus>("/api/system/images", "PUT", body);
}
