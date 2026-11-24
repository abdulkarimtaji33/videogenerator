// YouTube Analytics API pulls (views, watch time, average view duration and percentage, subscribers,
// audience retention curve) stored as dated snapshots on the uploads row. Click-through rate for thumbnails
// is NOT available from this API (it comes from the Reporting API, which needs a separate report job); it is
// deliberately not faked here. Not run live: no Google credentials on this machine; tested with a mocked fetch.
import { query } from "../db";
import { getAccessToken } from "./client";

export interface VideoStats {
  date: string;
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number;
  averageViewPercentage: number;
  subscribersGained: number;
  retention?: { ratio: number; watch: number }[];
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function report(params: Record<string, string>): Promise<{ columnHeaders: { name: string }[]; rows?: number[][] }> {
  const token = await getAccessToken();
  const res = await fetch("https://youtubeanalytics.googleapis.com/v2/reports?" + new URLSearchParams(params).toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`YouTube Analytics failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return (await res.json()) as any;
}

export async function fetchVideoStats(videoId: string, since: Date, now = new Date()): Promise<VideoStats> {
  const base = { ids: "channel==MINE", startDate: ymd(since), endDate: ymd(now), filters: `video==${videoId}` };
  const main = await report({ ...base, metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained" });
  const row = main.rows?.[0] ?? [];
  const get = (name: string) => Number(row[main.columnHeaders.findIndex((h) => h.name === name)] ?? 0);
  const stats: VideoStats = {
    date: ymd(now),
    views: get("views"),
    estimatedMinutesWatched: get("estimatedMinutesWatched"),
    averageViewDuration: get("averageViewDuration"),
    averageViewPercentage: get("averageViewPercentage"),
    subscribersGained: get("subscribersGained"),
  };
  try {
    const ret = await report({ ...base, metrics: "audienceWatchRatio", dimensions: "elapsedVideoTimeRatio" });
    stats.retention = (ret.rows ?? []).map((r) => ({ ratio: Number(r[0]), watch: Number(r[1]) }));
  } catch {
    /* retention is optional (needs enough views) */
  }
  return stats;
}

/** Appends a snapshot to every recent upload that has a YouTube id. Returns how many were updated. */
export async function pullAllStats(opts: { days?: number; now?: Date; fetcher?: typeof fetchVideoStats } = {}): Promise<number> {
  const rows = await query<any[]>(
    "SELECT id, youtube_video_id, stats, created_at FROM uploads WHERE youtube_video_id IS NOT NULL AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)",
    [opts.days ?? 60]
  );
  const fetcher = opts.fetcher ?? fetchVideoStats;
  let n = 0;
  for (const r of rows) {
    const created = new Date(String(r.created_at).replace(" ", "T") + "Z");
    const snap = await fetcher(r.youtube_video_id, created, opts.now);
    let history: VideoStats[] = [];
    try {
      history = JSON.parse(r.stats || "[]");
    } catch {
      history = [];
    }
    history = [...history.filter((h) => h.date !== snap.date), snap].slice(-90);
    await query("UPDATE uploads SET stats = ? WHERE id = ?", [JSON.stringify(history), r.id]);
    n++;
  }
  return n;
}

/** Plain data for the weekly review: each video's latest numbers next to the channel's own median. */
export async function weeklyReportData(): Promise<{ videos: any[]; medianViews: number }> {
  const rows = await query<any[]>(
    `SELECT p.id, p.title, p.format, p.plan_json, u.youtube_video_id, u.stats FROM uploads u JOIN projects p ON p.id = u.project_id
     WHERE u.youtube_video_id IS NOT NULL ORDER BY u.id DESC LIMIT 50`
  );
  const videos = rows.map((r) => {
    let hist: VideoStats[] = [];
    try {
      hist = JSON.parse(r.stats || "[]");
    } catch {
      hist = [];
    }
    const latest = hist[hist.length - 1] ?? null;
    let hookType: string | null = null;
    try {
      hookType = JSON.parse(r.plan_json || "{}").hook?.type ?? null;
    } catch {
      hookType = null;
    }
    return { projectId: r.id, title: r.title, format: r.format, videoId: r.youtube_video_id, hookType, latest };
  });
  const views = videos.map((v) => v.latest?.views ?? 0).sort((a, b) => a - b);
  const medianViews = views.length ? views[Math.floor(views.length / 2)] : 0;
  return { videos: videos.map((v) => ({ ...v, vsMedian: medianViews && v.latest ? Math.round((v.latest.views / medianViews) * 100) / 100 : null })), medianViews };
}
