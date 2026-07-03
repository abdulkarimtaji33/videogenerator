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

async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === "string") return data.error;
  } catch {
    // response body wasn't JSON; fall through to a generic message
  }
  return `Request failed with status ${res.status}`;
}

export async function createProject(idea: string, shotCount: number): Promise<{ id: number }> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea, shotCount }),
    });
  } catch {
    throw new ApiError(`Could not reach the backend at ${API_URL}. Is it running?`, 0);
  }

  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
  return res.json();
}

export async function fetchProject(id: string | number): Promise<ProjectWithShots> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/projects/${id}`, { cache: "no-store" });
  } catch {
    throw new ApiError(`Could not reach the backend at ${API_URL}. Is it running?`, 0);
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
    res = await fetch(`${API_URL}/api/projects/${projectId}/shots/${shotId}/video`, { method: "POST" });
  } catch {
    throw new ApiError(`Could not reach the backend at ${API_URL}. Is it running?`, 0);
  }

  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
}

export async function regenerateShotImage(projectId: number, shotId: number): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/projects/${projectId}/shots/${shotId}/image`, { method: "POST" });
  } catch {
    throw new ApiError(`Could not reach the backend at ${API_URL}. Is it running?`, 0);
  }

  if (!res.ok) {
    throw new ApiError(await parseErrorMessage(res), res.status);
  }
}
