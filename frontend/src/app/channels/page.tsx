"use client";
import { useState } from "react";
import { api } from "@/lib/studio";
import { Badge, Button, Card, ErrorNote, Field, Page, inputCls, useLoad } from "@/components/ui";

export default function ChannelsPage() {
  const { data, error, reload } = useLoad<any[]>(() => api("GET", "/api/channels"));
  const [f, setF] = useState({ name: "", language: "hi", niche: "", publishMode: "review", slots: "09:00, 18:00", timezone: "UTC", banned: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function create() {
    setSaving(true);
    setMsg(null);
    try {
      await api("POST", "/api/channels", {
        name: f.name,
        language: f.language,
        niche: f.niche || undefined,
        publishMode: f.publishMode,
        publishSlots: f.slots.split(",").map((s) => s.trim()).filter(Boolean),
        timezone: f.timezone,
        styleGuide: { banned_topics: f.banned.split(",").map((s) => s.trim()).filter(Boolean) },
      });
      setF({ ...f, name: "", niche: "" });
      await reload();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleMode(c: any) {
    await api("PATCH", `/api/channels/${c.id}`, { publishMode: c.publishMode === "review" ? "auto" : "review" });
    await reload();
  }

  return (
    <Page title="Channels" subtitle="One channel per niche and language. Review mode waits for your approval; auto mode publishes in the next free slot once checks pass.">
      <ErrorNote error={error ?? msg} />
      <div className="grid gap-4 sm:grid-cols-2">
        {data?.map((c) => (
          <Card key={c.id} title={c.name} right={<Badge tone={c.status === "active" ? "ok" : "neutral"}>{c.status}</Badge>}>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Niche</dt><dd>{c.niche || "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Language</dt><dd>{c.language}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Slots ({c.timezone})</dt><dd>{c.publishSlots.join(", ")}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Daily cap</dt><dd>{c.dailyCapLong} long · {c.dailyCapShorts} Shorts</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Publishing</dt><dd><Badge tone={c.publishMode === "auto" ? "warn" : "ok"}>{c.publishMode}</Badge></dd></div>
            </dl>
            <div className="mt-3"><Button variant="ghost" onClick={() => toggleMode(c)}>Switch to {c.publishMode === "review" ? "auto" : "review"} mode</Button></div>
          </Card>
        ))}
      </div>
      <Card title="New channel">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Niche"><input className={inputCls} value={f.niche} onChange={(e) => setF({ ...f, niche: e.target.value })} placeholder="space_science_curiosity" /></Field>
          <Field label="Language">
            <select className={inputCls} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
              <option value="hi">Hindi</option><option value="en">English</option>
            </select>
          </Field>
          <Field label="Publishing">
            <select className={inputCls} value={f.publishMode} onChange={(e) => setF({ ...f, publishMode: e.target.value })}>
              <option value="review">Review first</option><option value="auto">Auto</option>
            </select>
          </Field>
          <Field label="Publish slots (HH:MM, comma separated)"><input className={inputCls} value={f.slots} onChange={(e) => setF({ ...f, slots: e.target.value })} /></Field>
          <Field label="Time zone"><input className={inputCls} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} placeholder="Europe/London" /></Field>
          <Field label="Banned topics (comma separated)"><input className={inputCls} value={f.banned} onChange={(e) => setF({ ...f, banned: e.target.value })} /></Field>
        </div>
        <div className="mt-3"><Button onClick={create} disabled={saving || f.name.trim().length < 2}>Create channel</Button></div>
      </Card>
    </Page>
  );
}
