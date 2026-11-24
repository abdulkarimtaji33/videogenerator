// API client for the channel studio pages. Same backend and error style as lib/api.ts.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4501";

export class StudioError extends Error {
  readonly status: number;
  readonly details: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "StudioError";
    this.status = status;
    this.details = details;
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new StudioError("Couldn't reach the server. Is the backend running?", 0);
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) throw new StudioError((json && json.error) || `Request failed with status ${res.status}`, res.status, json);
  return json as T;
}

/** Finished videos, frames and clips live under /api/media/shorts; paths from the API already start with "shorts/". */
export const mediaUrl = (storagePath: string) => `${API_URL}/api/media/${storagePath}`;

export const STAGE_LABEL: Record<string, string> = {
  draft: "Draft",
  planned: "Planned",
  assets: "Making clips",
  assembling: "Assembling",
  qa: "Quality check",
  awaiting_approval: "Awaiting approval",
  uploading: "Uploading",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Failed",
  rejected: "Rejected",
};
