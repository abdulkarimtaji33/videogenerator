"use client";
import { useState } from "react";
import { api } from "@/lib/studio";
import { Badge, Button, Card, ErrorNote, Field, Page, inputCls, useLoad } from "@/components/ui";

function Report({ r }: { r: any }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span className="text-3xl font-semibold">{r.score}</span>
        <span className="text-sm text-muted-foreground">/ 100</span>
        <Badge tone={r.passed ? "ok" : "error"}>{r.passed ? "passes" : "needs work"}</Badge>
        <span className="text-xs text-muted-foreground">
          {r.words} words · about {r.estSeconds}s · reading grade {r.readingGrade}
        </span>
      </div>
      <ul className="space-y-1 text-sm">
        {r.checks.map((c: any) => (
          <li key={c.id} className="flex gap-2">
            <span className={c.ok ? "text-success" : c.critical ? "text-danger" : "text-accent"}>{c.ok ? "✓" : c.critical ? "✗" : "!"}</span>
            <span className={c.ok ? "text-muted-foreground" : ""}>{c.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function HooksPage() {
  const [line, setLine] = useState("");
  const [visual, setVisual] = useState("");
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<"short" | "long">("short");
  const [report, setReport] = useState<any>(null);
  const [topic, setTopic] = useState("");
  const [facts, setFacts] = useState("");
  const [gen, setGen] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lib = useLoad<any>(() => api("GET", "/api/hooks/library"));

  async function check() {
    setError(null);
    try {
      setReport(await api("POST", "/api/hooks/lint", { line, visual, title, format }));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setGen(await api("POST", "/api/hooks/generate", { topic, title, format, niche: "space and science curiosity", facts: facts.split("\n").map((f) => f.trim()).filter(Boolean) }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Hook lab" subtitle="The first seconds decide whether anyone stays. Check a hook against the research rules, or generate and rank new ones.">
      <ErrorNote error={error} />
      <Card title="Check a hook">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Hook line (what is said first)">
            <input className={inputCls} value={line} onChange={(e) => setLine(e.target.value)} placeholder="Saturn is lighter than water." />
          </Field>
          <Field label="Working title">
            <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Saturn would float on water" />
          </Field>
          <Field label="First-frame visual" hint="One focal subject. No people, text, labels or split screens.">
            <input className={inputCls} value={visual} onChange={(e) => setVisual(e.target.value)} placeholder="A huge golden ringed planet floating on a calm dark ocean at dusk." />
          </Field>
          <Field label="Format">
            <select className={inputCls} value={format} onChange={(e) => setFormat(e.target.value as any)}>
              <option value="short">Short (about 3 seconds)</option>
              <option value="long">Long-form (first line)</option>
            </select>
          </Field>
        </div>
        <div className="mt-3">
          <Button onClick={check} disabled={!line.trim()}>Check hook</Button>
        </div>
        {report && <div className="mt-4 border-t border-border pt-4"><Report r={report} /></div>}
      </Card>

      <Card title="Generate and rank hooks">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Topic">
            <input className={inputCls} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Saturn is less dense than water" />
          </Field>
          <Field label="Verified facts (one per line)" hint="The generator may only use these numbers.">
            <textarea className={inputCls} rows={3} value={facts} onChange={(e) => setFacts(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3">
          <Button onClick={generate} disabled={busy || !topic.trim()}>{busy ? "Generating..." : "Generate 12 and rank"}</Button>
        </div>
        {gen && !gen.factChecked && (
          <p className="mt-4 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">No verified facts were supplied, so the claims in these hooks are unchecked. The rule checker cannot tell what is true.</p>
        )}
        {gen && (
          <ul className="mt-4 space-y-3 border-t border-border pt-4">
            {gen.ranked.slice(0, 6).map((h: any, i: number) => (
              <li key={i} className="rounded-lg bg-surface-muted p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">&ldquo;{h.line}&rdquo;</span>
                  <span className="flex items-center gap-2">
                    {h.factOk === false ? <Badge tone="error">unsupported claim</Badge> : h.factOk ? <Badge tone="ok">facts ok</Badge> : null}
                    <Badge tone={h.report.passed ? "ok" : "warn"}>{h.report.score}</Badge>
                    <Badge>{h.type}</Badge>
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Visual: {h.visual}</div>
                <button className="mt-2 text-xs text-accent hover:underline" onClick={() => { setLine(h.line); setVisual(h.visual); setReport(h.report); }}>
                  Load into the checker
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Hook library (from the research)">
        {lib.data && (
          <>
            <p className="mb-3 text-xs text-muted-foreground">Recently used types (rotated automatically): {lib.data.recentTypes.length ? lib.data.recentTypes.join(", ") : "none yet"}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {lib.data.templates.map((t: any) => (
                <div key={t.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge>{t.id}</Badge>
                    <span className="text-xs text-muted-foreground">{lib.data.types[t.type].label}</span>
                  </div>
                  <div>{t.formula}</div>
                  {t.example && <div className="mt-1 text-xs italic text-muted-foreground">&ldquo;{t.example}&rdquo; ({t.source})</div>}
                  <div className="mt-1 text-xs text-muted-foreground">Rule: {t.rule}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </Page>
  );
}
