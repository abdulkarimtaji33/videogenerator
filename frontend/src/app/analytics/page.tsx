"use client";
import { useState } from "react";
import { api } from "@/lib/studio";
import { Badge, Button, Card, ErrorNote, Page, useLoad } from "@/components/ui";

export default function AnalyticsPage() {
  const { data, error, reload } = useLoad<any>(() => api("GET", "/api/system/analytics"));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pull() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api("POST", "/api/system/analytics/pull");
      setMsg(`Updated ${r.updated} video(s).`);
      await reload();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Analytics" subtitle="Each video against this channel's own median, since YouTube publishes no universal benchmark. Click-through rate is not available from the Analytics API and is not shown.">
      <ErrorNote error={error} />
      <Card title="Videos" right={<Button variant="ghost" onClick={pull} disabled={busy}>{busy ? "Pulling..." : "Pull latest from YouTube"}</Button>}>
        {msg && <p className="mb-3 text-sm text-muted-foreground">{msg}</p>}
        {data && data.videos.length === 0 && <p className="text-sm text-muted-foreground">No uploaded videos yet.</p>}
        {data && data.videos.length > 0 && (
          <>
            <p className="mb-2 text-xs text-muted-foreground">Median views: {data.medianViews}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr><th className="py-1 pr-3">Video</th><th className="pr-3">Hook</th><th className="pr-3">Views</th><th className="pr-3">vs median</th><th className="pr-3">Avg % viewed</th><th>Subs</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.videos.map((v: any) => (
                    <tr key={v.videoId}>
                      <td className="py-2 pr-3">{v.title}</td>
                      <td className="pr-3">{v.hookType ? <Badge>{v.hookType}</Badge> : "—"}</td>
                      <td className="pr-3">{v.latest?.views ?? "—"}</td>
                      <td className="pr-3">{v.vsMedian ?? "—"}</td>
                      <td className="pr-3">{v.latest ? `${v.latest.averageViewPercentage.toFixed?.(0) ?? v.latest.averageViewPercentage}%` : "—"}</td>
                      <td>{v.latest?.subscribersGained ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </Page>
  );
}
