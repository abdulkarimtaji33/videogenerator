"use client";
import { useEffect, useState } from "react";
import { STAGE_LABEL, api, mediaUrl } from "@/lib/studio";
import { Badge, Button, Card, ErrorNote, Page, inputCls, useLoad } from "@/components/ui";

const stageTone = (s: string): "ok" | "warn" | "error" | "neutral" =>
  s === "failed" || s === "rejected" ? "error" : s === "awaiting_approval" ? "warn" : s === "scheduled" || s === "published" ? "ok" : "neutral";

function Detail({ id, onChange }: { id: number; onChange: () => void }) {
  const { data, error, reload } = useLoad<any>(() => api("GET", `/api/projects/${id}/review`), 4000);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function act(path: string, body?: unknown) {
    setMsg(null);
    try {
      await api("POST", `/api/projects/${id}/${path}`, body);
      await reload();
      onChange();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  if (!data) return <ErrorNote error={error} />;
  const qa = data.qaReport;
  return (
    <Card title={`#${data.id} ${data.title ?? ""}`} right={<Badge tone={stageTone(data.stage)}>{STAGE_LABEL[data.stage] ?? data.stage}</Badge>}>
      <ErrorNote error={msg ?? data.error} />
      <div className="mt-3 grid gap-5 md:grid-cols-[260px_1fr]">
        <div>
          {data.finalVideoPath ? (
            <video src={mediaUrl(data.finalVideoPath)} controls className="w-full rounded-lg bg-black" style={{ aspectRatio: data.plan?.aspect === "16:9" ? "16/9" : "9/16", maxHeight: 460 }} />
          ) : (
            <div className="flex aspect-[9/16] max-h-[460px] items-center justify-center rounded-lg bg-surface-muted text-sm text-muted-foreground">No video yet</div>
          )}
          {qa?.frames?.length > 0 && (
            <div className="mt-2 grid grid-cols-3 gap-1">
              {qa.frames.map((f: string) => <img key={f} src={mediaUrl(f)} alt="sample frame" className="rounded" />)}
            </div>
          )}
        </div>
        <div className="space-y-4 text-sm">
          {data.plan && (
            <div>
              <div className="font-medium">Hook ({data.plan.hook.type})</div>
              <div>&ldquo;{data.plan.hook.line}&rdquo;</div>
              <div className="text-xs text-muted-foreground">{data.plan.hook.visual}</div>
            </div>
          )}
          {qa && (
            <div>
              <div className="mb-1 font-medium">Quality checks <Badge tone={data.qaStatus === "passed" ? "ok" : "error"}>{data.qaStatus}</Badge></div>
              <ul className="space-y-0.5">
                {qa.qa.checks.map((c: any) => <li key={c.id} className="flex gap-2"><span className={c.ok ? "text-success" : "text-danger"}>{c.ok ? "✓" : "✗"}</span><span className={c.ok ? "text-muted-foreground" : ""}>{c.message}</span></li>)}
              </ul>
              <div className="mb-1 mt-3 font-medium">Policy and originality</div>
              <ul className="space-y-0.5">
                {[...qa.policy, ...qa.uniqueness.findings].map((f: any, i: number) => <li key={i} className="flex gap-2"><span className={f.level === "ok" ? "text-success" : f.level === "warn" ? "text-accent" : "text-danger"}>{f.level === "ok" ? "✓" : f.level === "warn" ? "!" : "✗"}</span><span className={f.level === "ok" ? "text-muted-foreground" : ""}>{f.message}</span></li>)}
              </ul>
              {qa.warnings?.map((w: string) => <div key={w} className="mt-1 text-xs text-accent">Note: {w}</div>)}
            </div>
          )}
          {data.shots?.length > 0 && (
            <div>
              <div className="mb-1 font-medium">Clips</div>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {data.shots.map((s: any) => <li key={s.id}>{s.title}: {s.status}{s.provider ? ` via ${s.provider}` : ""}</li>)}
              </ul>
            </div>
          )}
          {data.uploads?.length > 0 && (
            <div className="text-xs text-muted-foreground">Uploads: {data.uploads.map((u: any) => `${u.state}${u.youtube_video_id ? ` (${u.youtube_video_id})` : ""}`).join(", ")}</div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {data.stage === "awaiting_approval" && (
              <>
                <Button onClick={() => act("approve")}>Approve and schedule</Button>
                <input className={inputCls + " max-w-xs"} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason to reject" />
                <Button variant="danger" disabled={!reason.trim()} onClick={() => act("reject", { reason })}>Reject</Button>
              </>
            )}
            {data.stage === "failed" && (
              <>
                <Button onClick={() => act("restart")}>Restart</Button>
                <input className={inputCls + " max-w-xs"} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason to reject" />
                <Button variant="danger" disabled={!reason.trim()} onClick={() => act("reject", { reason })}>Reject</Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function ReviewPage() {
  const list = useLoad<any[]>(() => api("GET", "/api/projects"), 6000);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("project");
    if (p) setSelected(Number(p));
  }, []);
  const inbox = list.data?.filter((p) => p.stage === "awaiting_approval") ?? [];
  return (
    <Page title="Review" subtitle="Nothing leaves this machine until you approve it here.">
      <ErrorNote error={list.error} />
      <div className="grid gap-5 md:grid-cols-[260px_1fr]">
        <div className="space-y-4">
          <Card title={`Waiting for approval (${inbox.length})`}>
            {inbox.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting.</p>}
            <ul className="space-y-1">
              {inbox.map((p) => <li key={p.id}><button className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-muted" onClick={() => setSelected(p.id)}>#{p.id} {p.title}</button></li>)}
            </ul>
          </Card>
          <Card title="All videos">
            <ul className="space-y-1">
              {list.data?.map((p) => (
                <li key={p.id}>
                  <button className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-muted" onClick={() => setSelected(p.id)}>
                    <span className="truncate">#{p.id} {p.title}</span>
                    <Badge tone={stageTone(p.stage)}>{STAGE_LABEL[p.stage] ?? p.stage}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div>{selected ? <Detail id={selected} onChange={() => void list.reload()} /> : <Card>Select a video to review.</Card>}</div>
      </div>
    </Page>
  );
}
