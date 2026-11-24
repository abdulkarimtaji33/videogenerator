"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/studio";
import { Badge, Button, Card, ErrorNote, Field, Page, inputCls, useLoad } from "@/components/ui";

const TONE: Record<string, "ok" | "warn" | "error" | "neutral"> = { idea: "neutral", approved: "ok", planned: "warn", used: "ok", rejected: "error" };

export default function TopicsPage() {
  const channels = useLoad<any[]>(() => api("GET", "/api/channels"));
  const [channelId, setChannelId] = useState<number | null>(null);
  const [topics, setTopics] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [angle, setAngle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (channelId == null && channels.data?.length) setChannelId(channels.data[0].id);
  }, [channels.data, channelId]);

  async function reload(id = channelId) {
    if (id == null) return;
    try {
      setTopics(await api("GET", `/api/topics?channelId=${id}`));
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <Page title="Topic queue" subtitle="Ideas move from idea to approved to planned to used. Every topic should carry its sources.">
      <ErrorNote error={channels.error ?? error} />
      {channels.data && channels.data.length === 0 && <Card>Create a channel first (Channels page).</Card>}
      {channels.data && channels.data.length > 0 && (
        <>
          <Card>
            <Field label="Channel">
              <select className={inputCls} value={channelId ?? ""} onChange={(e) => setChannelId(Number(e.target.value))}>
                {channels.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </Card>
          <Card title="Add a topic">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Title"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Saturn would float on water" /></Field>
              <Field label="Angle"><input className={inputCls} value={angle} onChange={(e) => setAngle(e.target.value)} placeholder="Why density, not size, decides it" /></Field>
              <Field label="Source link"><input className={inputCls} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://..." /></Field>
            </div>
            <div className="mt-3">
              <Button
                disabled={title.trim().length < 3 || channelId == null}
                onClick={() => act(async () => {
                  await api("POST", "/api/topics", { channelId, title, angle: angle || undefined, sources: sourceUrl ? [{ url: sourceUrl }] : [] });
                  setTitle(""); setAngle(""); setSourceUrl("");
                })}
              >
                Add topic
              </Button>
            </div>
          </Card>
          <Card title={`Topics (${topics.length})`}>
            <ul className="divide-y divide-border">
              {topics.map((t) => (
                <li key={t.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{t.title}</div>
                      {t.angle && <div className="text-sm text-muted-foreground">{t.angle}</div>}
                      {t.sources.length > 0 && <div className="text-xs text-muted-foreground">{t.sources.length} source(s)</div>}
                      {t.rejectReason && <div className="text-xs text-danger">Rejected: {t.rejectReason}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={TONE[t.status]}>{t.status}</Badge>
                      {["idea", "rejected"].includes(t.status) && <Button variant="ghost" onClick={() => act(() => api("POST", `/api/topics/${t.id}/approve`))}>Approve</Button>}
                      {["idea", "approved"].includes(t.status) && <Button variant="danger" onClick={() => setRejecting(rejecting === t.id ? null : t.id)}>Reject</Button>}
                    </div>
                  </div>
                  {rejecting === t.id && (
                    <div className="mt-2 flex gap-2">
                      <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? (required)" />
                      <Button variant="danger" disabled={!reason.trim()} onClick={() => act(async () => { await api("POST", `/api/topics/${t.id}/reject`, { reason }); setRejecting(null); setReason(""); })}>Confirm</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </Page>
  );
}
