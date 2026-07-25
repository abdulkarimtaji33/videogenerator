import type { ProjectWithShots } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

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

export async function createProject(
  idea: string,
  shotCount: number,
  shotDurationSeconds: number
): Promise<{ id: number }> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${API_URL}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea, shotCount, shotDurationSeconds }),
    });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }

  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json();
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
