const STORAGE_KEY = "shotcraft:recent-projects";
const MAX_ENTRIES = 12;

export interface RecentProject {
  id: number;
  idea: string;
  createdAt: string;
}

export function getRecentProjects(): RecentProject[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addRecentProject(entry: RecentProject): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getRecentProjects().filter((p) => p.id !== entry.id);
    const next = [entry, ...existing].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage can be unavailable (private mode, quota); recent list is a convenience, not critical.
  }
}
