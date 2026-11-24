"use client";

import { useState, type ReactNode } from "react";
import type { Anchor, ProjectWithShots, PublishPrivacy } from "@/types";
import { ApiError, chooseThumbnail, chooseTitle, finalVideoUrl, imageUrl, publishProject } from "@/lib/api";
import Collapsible from "./Collapsible";
import CopyButton from "./CopyButton";
import ProviderBadge from "@/components/ProviderBadge";

const ROLE_LABEL: Record<string, string> = {
  hook: "Hook",
  foreshadow: "Foreshadow",
  body: "Body",
  rehook: "Re-hook",
  side_story: "Side story",
  payoff: "Payoff",
  loop: "Loop",
  bridge: "Bridge",
};

export function roleLabel(role: string | null | undefined): string {
  return role ? ROLE_LABEL[role] || role : "";
}

function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "ok" | "bad" }) {
  const cls =
    tone === "accent" ? "bg-accent-soft text-accent" : tone === "ok" ? "bg-success-soft text-success" : tone === "bad" ? "bg-danger-soft text-danger" : "bg-surface-muted text-muted-foreground";
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

export function LinkBadge({ link }: { link: "but" | "therefore" | null | undefined }) {
  if (!link) return null;
  return <Pill tone={link === "but" ? "bad" : "ok"}>{link === "but" ? "but" : "therefore"}</Pill>;
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}

function Err({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mt-3 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
      {message}
    </div>
  );
}

const textCls = "max-w-[66ch] whitespace-pre-wrap text-[15px] leading-relaxed text-foreground";

export function BriefPanel({ project }: { project: ProjectWithShots }) {
  const b = project.brief;
  if (!b) return null;
  return (
    <Collapsible title="Brief" subtitle={`${b.niche} · ${b.format} · ${b.lengthSeconds}s`} badge={<CopyButton text={b.promise} />}>
      <div className="space-y-4">
        <div>
          <Label>Promise</Label>
          <p className={textCls}>{b.promise}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone="accent">Niche: {b.niche}</Pill>
          <Pill>Subject mode: {b.subjectMode}</Pill>
          <Pill>Tone: {b.tone}</Pill>
        </div>
        <div>
          <Label>Audience</Label>
          <p className={textCls}>{b.audience}</p>
        </div>
        <div>
          <Label>Style bible</Label>
          <p className={textCls}>{b.styleBible}</p>
        </div>
        {b.avoid.length > 0 && (
          <div>
            <Label>Avoid</Label>
            <p className="text-sm text-muted-foreground">{b.avoid.join(" · ")}</p>
          </div>
        )}
        {project.facts && project.facts.length > 0 && (
          <div>
            <Label>Verified facts ({project.facts.length})</Label>
            <ul className="space-y-1 text-sm text-foreground">
              {project.facts.map((f) => (
                <li key={f.id}>
                  {f.claim} <span className="text-xs text-muted-foreground">({f.source})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Collapsible>
  );
}

function AnchorCard({ anchor }: { anchor: Anchor }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      {anchor.imagePath ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl(anchor.imagePath)} alt={anchor.name} className="aspect-square w-full bg-surface-muted object-cover" />
          <ProviderBadge provider={anchor.imageProviderUsed} ms={anchor.imageMs} />
        </div>
      ) : (
        <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-surface-muted text-xs text-muted-foreground">
          {anchor.status === "error" || anchor.status === "failed" ? (
            "Image failed"
          ) : (
            <>
              <span className="spinner" />
              No image yet
            </>
          )}
        </div>
      )}
      <div className="space-y-1.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">{anchor.name}</h3>
          <Pill tone="accent">{anchor.kind}</Pill>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{anchor.lockedFeatures}</p>
      </div>
    </div>
  );
}

export function AnchorsPanel({ project }: { project: ProjectWithShots }) {
  const anchors = project.anchors;
  if (!anchors || anchors.length === 0) return null;
  return (
    <Collapsible title="Anchors" subtitle={`${anchors.length} recurring subject${anchors.length === 1 ? "" : "s"}`} loading={project.stage === "anchors"} loadingLabel="Making reference images...">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {anchors.map((a) => (
          <AnchorCard key={a.key} anchor={a} />
        ))}
      </div>
    </Collapsible>
  );
}

export function HookPanel({ project }: { project: ProjectWithShots }) {
  const h = project.hook;
  if (!h) return null;
  return (
    <Collapsible title="Hook" subtitle={h.line} badge={<CopyButton text={h.line} />}>
      <div className="space-y-4">
        <div>
          <Label>Line (first words of narration)</Label>
          <p className={textCls}>{h.line}</p>
        </div>
        <div>
          <Label>Opening visual</Label>
          <p className={textCls}>{h.visual}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone="accent">Type: {h.type}</Pill>
          {typeof h.score === "number" && <Pill>Score: {Math.round(h.score * 100) / 100}</Pill>}
        </div>
      </div>
    </Collapsible>
  );
}

export function SeoPanel({ project }: { project: ProjectWithShots }) {
  const seo = project.seo;
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!seo) return null;

  const chosen = picked ?? project.chosen_title ?? seo.chosenTitle;
  const kw = seo.mainKeyword.toLowerCase();
  const firstLines = seo.description.split("\n").slice(0, 2).join(" ").toLowerCase();
  const checks = [
    { ok: chosen.toLowerCase().includes(kw), label: "Main keyword is in the title" },
    { ok: chosen.length <= 70, label: `Title is 70 characters or less (${chosen.length})` },
    { ok: firstLines.includes(kw), label: "Main keyword is in the first lines of the description" },
    { ok: seo.tags.some((t) => t.toLowerCase().includes(kw)), label: "Main keyword is in the tags" },
  ];

  async function pick(title: string) {
    setError(null);
    setPicked(title);
    setSaving(true);
    try {
      await chooseTitle(project.id, title);
    } catch (err) {
      setPicked(null);
      setError(err instanceof ApiError ? err.message : "Couldn't save the title.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Collapsible title="SEO" subtitle={chosen} defaultOpen>
      <div className="space-y-5">
        <fieldset disabled={saving}>
          <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Title (pick one)</legend>
          <div className="space-y-2">
            {seo.titles.map((t) => (
              <label key={t.title} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors ${chosen === t.title ? "border-accent bg-accent-soft" : "border-border hover:border-accent"}`}>
                <input type="radio" name="seo-title" checked={chosen === t.title} onChange={() => pick(t.title)} className="mt-1 accent-accent" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{t.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t.angle} · {t.title.length} chars
                  </span>
                </span>
              </label>
            ))}
          </div>
          <Err message={error} />
        </fieldset>

        <div>
          <Label>Main keyword</Label>
          <p className="text-sm font-medium text-foreground">{seo.mainKeyword}</p>
          {seo.relatedKeywords.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Related: {seo.relatedKeywords.join(", ")}</p>}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label>Description</Label>
            <CopyButton text={seo.description} />
          </div>
          <p className={textCls}>{seo.description}</p>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label>Tags</Label>
            <CopyButton text={seo.tags.join(", ")} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {seo.tags.map((t) => (
              <Pill key={t}>{t}</Pill>
            ))}
          </div>
        </div>

        {seo.hashtags.length > 0 && (
          <div>
            <Label>Hashtags</Label>
            <p className="text-sm text-accent">{seo.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}</p>
          </div>
        )}

        <div>
          <Label>Keyword check</Label>
          <ul className="space-y-1 text-sm">
            {checks.map((c) => (
              <li key={c.label} className={c.ok ? "text-success" : "text-danger"}>
                {c.ok ? "✓" : "✗"} <span className="text-foreground">{c.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Collapsible>
  );
}

export function ScriptPanel({ project }: { project: ProjectWithShots }) {
  const s = project.script;
  if (!s || s.shots.length === 0) return null;
  const text = s.shots.map((x) => x.narration).join("\n");
  return (
    <Collapsible title="Script" subtitle={`${s.shots.length} beats`} badge={<CopyButton text={text} />}>
      <ol className="space-y-3">
        {s.shots.map((x) => (
          <li key={x.index} className="flex gap-3">
            <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{x.index}</span>
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <Pill tone="accent">{roleLabel(x.role)}</Pill>
                <LinkBadge link={x.link} />
                {x.continuesPrevious && <Pill>continues</Pill>}
                {x.anchorKeys.map((k) => (
                  <Pill key={k}>{k}</Pill>
                ))}
              </div>
              <p className="text-[15px] leading-relaxed text-foreground">{x.narration}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{x.visual}</p>
            </div>
          </li>
        ))}
      </ol>
    </Collapsible>
  );
}

export function ReviewPanel({ project }: { project: ProjectWithShots }) {
  const r = project.review;
  const offByToggle = !r && project.script && (project.review_enabled === 0 || project.review_enabled === false);
  if (!r && !offByToggle) return null;
  if (!r || !r.enabled) {
    return (
      <Collapsible title="Review report" subtitle="Review off">
        <p className="text-sm text-muted-foreground">The AI script review was switched off for this project, so the script was not checked or rewritten.</p>
      </Collapsible>
    );
  }
  const failed = r.checks.filter((c) => !c.ok && !c.fixed).length;
  const fixed = r.checks.filter((c) => c.fixed).length;
  return (
    <Collapsible
      title="Review report"
      subtitle={`${r.passed ? "Passed" : "Needs attention"} · ${r.rounds} round${r.rounds === 1 ? "" : "s"} · ${fixed} fixed · ${failed} failed`}
      badge={<Pill tone={r.passed ? "ok" : "bad"}>{r.passed ? "Passed" : "Failed"}</Pill>}
    >
      <ul className="space-y-2">
        {r.checks.map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-sm">
            <span className={`mt-0.5 shrink-0 font-semibold ${c.ok ? "text-success" : c.fixed ? "text-accent" : "text-danger"}`}>{c.ok ? "✓" : c.fixed ? "↻" : "✗"}</span>
            <span className="text-foreground">
              {c.message}
              {c.fixed && <span className="ml-1.5 text-xs text-accent">fixed in a rewrite</span>}
            </span>
          </li>
        ))}
      </ul>
    </Collapsible>
  );
}

export function ThumbnailsPanel({ project }: { project: ProjectWithShots }) {
  const thumbs = project.thumbnails;
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!thumbs || thumbs.length === 0) return null;
  const selected = picked ?? project.thumbnail_path ?? thumbs[0].path;

  async function pick(variant: "A" | "B", path: string) {
    setError(null);
    setPicked(path);
    try {
      await chooseThumbnail(project.id, variant);
    } catch (err) {
      setPicked(null);
      setError(err instanceof ApiError ? err.message : "Couldn't save the thumbnail.");
    }
  }

  return (
    <Collapsible title="Thumbnails" subtitle="Pick the one to upload" defaultOpen>
      <div className="grid gap-4 sm:grid-cols-2">
        {thumbs.map((t) => {
          const active = selected === t.path;
          return (
            <button
              key={t.variant}
              type="button"
              onClick={() => pick(t.variant, t.path)}
              aria-pressed={active}
              className={`overflow-hidden rounded-xl border-2 text-left transition-colors ${active ? "border-accent" : "border-border hover:border-accent/60"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={finalVideoUrl(t.path)} alt={`Thumbnail ${t.variant}`} className="aspect-video w-full bg-surface-muted object-cover" />
              <span className="flex items-center justify-between px-3 py-2 text-sm font-medium text-foreground">
                Variant {t.variant}
                {active && <Pill tone="accent">Selected</Pill>}
              </span>
            </button>
          );
        })}
      </div>
      <Err message={error} />
    </Collapsible>
  );
}

function localToIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const PUBLISH_STATUS_LABEL: Record<string, string> = {
  publishing: "Uploading to YouTube...",
  scheduled: "Scheduled on YouTube",
  private: "Uploaded as private",
  unlisted: "Uploaded as unlisted",
  public: "Public on YouTube",
  published: "Published on YouTube",
  failed: "Upload failed",
};

export function PublishPanel({ project }: { project: ProjectWithShots }) {
  const [privacy, setPrivacy] = useState<PublishPrivacy>("private");
  const [when, setWhen] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!project.final_video_path) return null;

  const status = project.publish_status;
  const publishing = starting || status === "publishing" || project.stage === "publishing";
  const videoId = project.youtube_video_id;

  async function submit() {
    setError(null);
    let publishAt: string | undefined;
    if (privacy === "scheduled") {
      publishAt = localToIso(when);
      if (!publishAt) {
        setError("Pick the date and time to publish.");
        return;
      }
      if (new Date(publishAt).getTime() < Date.now() + 60_000) {
        setError("The publish time must be in the future.");
        return;
      }
    }
    setStarting(true);
    try {
      await publishProject(project.id, privacy, publishAt);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the upload.");
    } finally {
      // polling picks up publish_status; keep the button locked a moment so a double click can't enqueue twice
      setTimeout(() => setStarting(false), 3000);
    }
  }

  return (
    <Collapsible title="Publish to YouTube" subtitle={status ? PUBLISH_STATUS_LABEL[status] || status : "Not uploaded yet"} loading={publishing} loadingLabel="Uploading..." defaultOpen={!videoId}>
      <div className="space-y-4">
        {videoId && (
          <p className="text-sm text-foreground">
            {status ? PUBLISH_STATUS_LABEL[status] || status : "Uploaded"}:{" "}
            <a href={`https://youtu.be/${videoId}`} target="_blank" rel="noreferrer" className="font-medium text-accent underline">
              youtu.be/{videoId}
            </a>
          </p>
        )}
        {status === "failed" && project.error_message && <Err message={project.error_message} />}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div>
            <label htmlFor="privacy" className="mb-1 block text-xs font-medium text-muted-foreground">
              Privacy
            </label>
            <select
              id="privacy"
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value as PublishPrivacy)}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-accent focus:outline-none"
            >
              <option value="private">Private</option>
              <option value="unlisted">Unlisted</option>
              <option value="public">Public</option>
              <option value="scheduled">Scheduled (private until the time)</option>
            </select>
          </div>
          {privacy === "scheduled" && (
            <div>
              <label htmlFor="publishAt" className="mb-1 block text-xs font-medium text-muted-foreground">
                Publish at (your local time)
              </label>
              <input
                id="publishAt"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-accent focus:outline-none"
              />
            </div>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={publishing}
            className="min-h-[40px] rounded-lg bg-accent px-5 text-sm font-semibold text-accent-foreground transition-all hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {publishing ? "Uploading..." : videoId ? "Upload again" : "Upload to YouTube"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">Uploads use the chosen title, description, tags, thumbnail and captions, and are labelled as AI-generated media.</p>
        <Err message={error} />
      </div>
    </Collapsible>
  );
}
