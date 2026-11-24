"use client";
import Link from "next/link";
import { STAGE_LABEL, api } from "@/lib/studio";
import { Badge, Card, ErrorNote, Page, useLoad } from "@/components/ui";

const STAGES = ["planned", "assets", "assembling", "qa", "awaiting_approval", "uploading", "scheduled", "published", "failed", "rejected"];

export default function StudioPage() {
  const { data, error } = useLoad<any>(() => api("GET", "/api/system/overview"), 5000);
  return (
    <Page title="Studio" subtitle="What is being made, what it costs today, and what needs you.">
      <ErrorNote error={error} />
      {!data ? (
        !error && <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <>
          <Card title="Production" right={<Link href="/review" className="text-sm text-accent hover:underline">Review inbox ({data.projectsByStage.awaiting_approval ?? 0})</Link>}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {STAGES.map((s) => (
                <div key={s} className="rounded-lg bg-surface-muted p-3">
                  <div className="text-2xl font-semibold">{data.projectsByStage[s] ?? 0}</div>
                  <div className="text-xs text-muted-foreground">{STAGE_LABEL[s]}</div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-5 md:grid-cols-2">
            <Card title="Today's provider usage">
              <div className="space-y-3">
                {Object.entries<any>(data.usage).map(([id, u]) => (
                  <div key={id}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{id}</span>
                      <span className="text-muted-foreground">
                        {u.used}
                        {u.quota != null ? ` / ${u.quota}` : ""} {u.unit ?? ""}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-muted">
                      <div className="h-2 rounded-full bg-accent" style={{ width: `${u.quota ? Math.min(100, (u.used / u.quota) * 100) : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Job queue">
              <div className="flex flex-wrap gap-2">
                {Object.entries<number>(data.jobs).map(([k, v]) => (
                  <Badge key={k} tone={k === "dead" && v > 0 ? "error" : k === "failed" && v > 0 ? "warn" : "neutral"}>
                    {k}: {v}
                  </Badge>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Jobs survive a restart. Failed and dead jobs can be retried in Settings.</p>
            </Card>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Card title="Video flows">
              <ul className="space-y-2 text-sm">
                {data.providers.clips.map((p: any) => (
                  <li key={p.id} className="flex items-start justify-between gap-3">
                    <span>{p.label}</span>
                    {p.ok ? <Badge tone="ok">ready</Badge> : <span className="max-w-[55%] text-right text-xs text-muted-foreground">{p.reason}</span>}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Connections">
              <div className="flex flex-wrap gap-2">
                {Object.entries<boolean>(data.integrations).map(([k, v]) => (
                  <Badge key={k} tone={v ? "ok" : "neutral"}>
                    {k}: {v ? "set" : "not set"}
                  </Badge>
                ))}
                <Badge tone={data.youtubeReady ? "ok" : "warn"}>YouTube: {data.youtubeReady ? "connected" : "not connected"}</Badge>
              </div>
            </Card>
          </div>

          {data.recentFailures.length > 0 && (
            <Card title="Needs attention">
              <ul className="space-y-2 text-sm">
                {data.recentFailures.map((f: any) => (
                  <li key={f.id}>
                    <Link href={`/review?project=${f.id}`} className="font-medium text-accent hover:underline">
                      #{f.id} {f.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">{f.error_message}</div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {data.recentUploads.length > 0 && (
            <Card title="Recent uploads">
              <ul className="space-y-1 text-sm">
                {data.recentUploads.map((u: any) => (
                  <li key={u.id} className="flex justify-between gap-3">
                    <span>{u.title}</span>
                    <span className="text-muted-foreground">
                      {u.state}
                      {u.publish_at ? ` · ${String(u.publish_at).slice(0, 16)} UTC` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}
