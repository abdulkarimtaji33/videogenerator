"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createProject, fetchVeoframeStatus, fetchImageStatus, ApiError } from "@/lib/api";
import { addRecentProject, getRecentProjects, type RecentProject } from "@/lib/recentProjects";
import type { ImageSystemStatus, VeoframeStatus, VideoFormat } from "@/types";

const EXAMPLE_IDEAS = [
  "Why Saturn would float on water",
  "How the Roman Empire actually fell",
  "The lighthouse keeper who vanished from a locked island",
  "What if the Moon disappeared tomorrow?",
];

const NICHES: { id: string; label: string }[] = [
  { id: "auto", label: "Auto (let the AI choose)" },
  { id: "space_science", label: "Space & science" },
  { id: "history_documentary", label: "History documentary" },
  { id: "mystery_horror", label: "Mystery & horror" },
  { id: "curiosity_what_if", label: "Curiosity & what-if" },
  { id: "mythology_folklore", label: "Mythology & folklore" },
  { id: "character_series", label: "Character series" },
  { id: "anime_story", label: "Anime story" },
  { id: "geopolitics_business", label: "Geopolitics & business" },
  { id: "nature_animals", label: "Nature & animals" },
  { id: "tech_explainer", label: "Tech explainer" },
  { id: "generic_explainer", label: "General explainer" },
];

const IDEA_MAX_LENGTH = 4000;
const SHORT_RANGE = { min: 15, max: 60, def: 32 }; // seconds
const LONG_RANGE = { min: 3, max: 30, def: 10 }; // minutes
const SECONDS_PER_CLIP = 8;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background px-4 py-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-accent" />
      <span>
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [niche, setNiche] = useState("auto");
  const [format, setFormat] = useState<VideoFormat>("short");
  const [shortSeconds, setShortSeconds] = useState(SHORT_RANGE.def);
  const [longMinutes, setLongMinutes] = useState(LONG_RANGE.def);
  const [reviewEnabled, setReviewEnabled] = useState(true);
  const [autoPublish, setAutoPublish] = useState(false);
  const [submitting, setSubmitting] = useState<"plan" | "full" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [veoframe, setVeoframe] = useState<VeoframeStatus | null>(null);
  const [images, setImages] = useState<ImageSystemStatus | null>(null);
  const [imageProvider, setImageProvider] = useState("default");
  const [imageFallback, setImageFallback] = useState(false);
  const [language, setLanguage] = useState<"en" | "ur" | "hi">("hi");

  useEffect(() => {
    setRecentProjects(getRecentProjects());
    fetchVeoframeStatus()
      .then(setVeoframe)
      .catch(() => setVeoframe(null));
    fetchImageStatus()
      .then(setImages)
      .catch(() => setImages(null));
  }, []);

  const lengthSeconds = format === "short" ? shortSeconds : longMinutes * 60;
  const clips = Math.ceil(lengthSeconds / SECONDS_PER_CLIP);
  const estimatedMinutes = clips * 2 + 5;
  const effectiveProvider = imageProvider === "default" ? images?.default : imageProvider;
  const selectedProvider = images?.providers?.find((p) => p.id === effectiveProvider);
  const overQuota = veoframe !== null && clips > veoframe.quotaLeft;

  function clampNumber(value: string, min: number, max: number, fallback: number): number {
    const parsed = Number(value);
    if (value === "" || !Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
  }

  async function start(mode: "plan" | "full") {
    if (submitting) return;
    const trimmedIdea = idea.trim();
    if (!trimmedIdea) {
      setError("Please describe your video idea first.");
      return;
    }
    setSubmitting(mode);
    setError(null);
    try {
      const { id } = await createProject({ idea: trimmedIdea, niche, format, lengthSeconds, reviewEnabled, autoPublish, mode, language, ...(imageProvider !== "default" ? { imageProvider } : {}), imageFallback });
      addRecentProject({ id, idea: trimmedIdea, createdAt: new Date().toISOString() });
      router.push(`/projects/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start the project. Please try again.");
      setSubmitting(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void start("full");
  }

  function handleIdeaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void start("full");
    }
  }

  const segBtn = (active: boolean) =>
    `min-h-[44px] flex-1 px-5 text-sm font-medium transition-colors ${active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-accent"}`;

  return (
    <main className="mx-auto max-w-3xl px-6 pb-24 pt-12 sm:pt-16">
      <div className="mb-10 text-center">
        <span className="mb-4 inline-block rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
          Idea to finished video, automatically
        </span>
        <h1
          className="font-[family-name:var(--font-display)] font-semibold tracking-tight text-foreground"
          style={{ fontSize: "clamp(2rem, 1.4rem + 3vw, 3.25rem)", lineHeight: 1.1 }}
        >
          Turn one idea into a <span className="text-accent">finished</span> video
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
          Pick a niche and a format. We research the hook, write and check the script, make the visuals and the voice, package the title and thumbnail, and can post it to YouTube.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="rounded-3xl border border-border bg-surface p-6 shadow-card sm:p-8">
        <div className="mb-2 flex items-baseline justify-between">
          <label htmlFor="idea" className="block text-sm font-medium text-foreground">
            Video idea
          </label>
          <span className="text-xs tabular-nums text-muted-foreground" aria-hidden="true">
            {idea.length}/{IDEA_MAX_LENGTH}
          </span>
        </div>
        <textarea
          id="idea"
          placeholder="e.g. Why Saturn would float on water..."
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={handleIdeaKeyDown}
          maxLength={IDEA_MAX_LENGTH}
          className="min-h-[120px] w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">Tip: press ⌘/Ctrl + Enter to make the video.</p>

        <p className="mb-2 mt-4 text-xs font-medium text-muted-foreground">Or try an example:</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_IDEAS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setIdea(example)}
              title={example}
              className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-accent hover:text-accent"
            >
              {example.length > 42 ? `${example.slice(0, 42)}…` : example}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="niche" className="mb-2 block text-sm font-medium text-foreground">
              Niche
            </label>
            <select
              id="niche"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              {NICHES.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="language" className="mb-2 block text-sm font-medium text-foreground">
              Spoken language
            </label>
            <select
              id="language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as "en" | "ur" | "hi")}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              <option value="hi">Hindi (हिन्दी), Roman captions</option>
              <option value="en">English</option>
            </select>
            {language !== "en" && <p className="mt-1.5 text-xs text-muted-foreground">Characters get their own voices; captions are Roman letters.</p>}
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium text-foreground">Format</span>
            <div className="flex overflow-hidden rounded-xl border border-border bg-background" role="group" aria-label="Format">
              <button type="button" aria-pressed={format === "short"} onClick={() => setFormat("short")} className={segBtn(format === "short")}>
                Short (9:16)
              </button>
              <button type="button" aria-pressed={format === "long"} onClick={() => setFormat("long")} className={`${segBtn(format === "long")} border-l border-border`}>
                Long (16:9)
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="length" className="mb-2 block text-sm font-medium text-foreground">
              Length
            </label>
            {format === "short" ? (
              <div className="flex items-center gap-2">
                <input
                  id="length"
                  type="number"
                  inputMode="numeric"
                  min={SHORT_RANGE.min}
                  max={SHORT_RANGE.max}
                  value={shortSeconds}
                  onChange={(e) => setShortSeconds(clampNumber(e.target.value, SHORT_RANGE.min, SHORT_RANGE.max, SHORT_RANGE.def))}
                  className="h-11 w-24 rounded-xl border border-border bg-background px-3 text-center text-base text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
                <span className="text-sm text-muted-foreground">seconds ({SHORT_RANGE.min}-{SHORT_RANGE.max})</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  id="length"
                  type="number"
                  inputMode="numeric"
                  min={LONG_RANGE.min}
                  max={LONG_RANGE.max}
                  value={longMinutes}
                  onChange={(e) => setLongMinutes(clampNumber(e.target.value, LONG_RANGE.min, LONG_RANGE.max, LONG_RANGE.def))}
                  className="h-11 w-24 rounded-xl border border-border bg-background px-3 text-center text-base text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
                <span className="text-sm text-muted-foreground">minutes ({LONG_RANGE.min}-{LONG_RANGE.max})</span>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Toggle id="review" label="AI script review" hint="Checks the script against the research and rewrites weak parts." checked={reviewEnabled} onChange={setReviewEnabled} />
          <Toggle id="autopublish" label="Auto-post to YouTube" hint="Uploads when the video passes quality checks (needs YouTube connected)." checked={autoPublish} onChange={setAutoPublish} />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="imageModel" className="mb-2 block text-sm font-medium text-foreground">
              Image model
            </label>
            <select
              id="imageModel"
              value={imageProvider}
              onChange={(e) => setImageProvider(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            >
              <option value="default">Server default{images ? ` (${images.providers?.find((p) => p.id === images.default)?.label ?? images.default})` : ""}</option>
              {images?.providers?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {selectedProvider && (
              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {!selectedProvider.configured ? (
                  <span className="rounded-full bg-danger-soft px-2 py-0.5 font-medium text-danger">Not configured</span>
                ) : selectedProvider.online === false ? (
                  <span className="rounded-full bg-danger-soft px-2 py-0.5 font-medium text-danger">Offline</span>
                ) : (
                  <span className="rounded-full bg-success-soft px-2 py-0.5 font-medium text-success">{selectedProvider.online ? "Online" : "Ready"}</span>
                )}
                {selectedProvider.avgSeconds ? <span>about {Math.round(selectedProvider.avgSeconds)} s per image</span> : null}
              </p>
            )}
            {effectiveProvider === "flux-local" && (
              <p className="mt-1.5 text-xs text-muted-foreground">FLUX runs on this computer. On CPU, each image takes minutes.</p>
            )}
          </div>
          <Toggle
            id="imagefallback"
            label="Fall back to OpenAI if the image server is down"
            hint="Off by default: a down image server stops the run with a clear error."
            checked={imageFallback}
            onChange={setImageFallback}
          />
        </div>

        <div className="mt-5 rounded-xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground" aria-live="polite">
          <p>
            About <span className="font-semibold text-foreground">{clips} clips</span>, roughly{" "}
            <span className="font-semibold text-foreground">{estimatedMinutes} min</span> to make.
            {veoframe && (
              <>
                {" "}
                Veoframe: <span className="font-semibold text-foreground">{veoframe.quotaLeft}</span> of {veoframe.perDay} clips left today
                {!veoframe.signedIn && <span className="text-danger"> (not signed in)</span>}.
              </>
            )}
          </p>
          {overQuota && veoframe && (
            <p className="mt-1.5 text-accent">
              This needs {clips} clips but only {veoframe.quotaLeft} are left today. The run makes today&apos;s share and continues tomorrow.
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => start("plan")}
            disabled={submitting !== null}
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-border px-6 text-[15px] font-semibold text-foreground transition-all hover:border-accent hover:text-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting === "plan" && <span className="spinner" />}
            {submitting === "plan" ? "Starting..." : "Write plan only"}
          </button>
          <button
            type="submit"
            disabled={submitting !== null}
            className="flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-6 text-[15px] font-semibold text-accent-foreground shadow-card transition-all hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
          >
            {submitting === "full" && <span className="spinner" />}
            {submitting === "full" ? "Starting..." : "Make video"}
          </button>
        </div>

        {error && (
          <div className="mt-5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
            {error}
          </div>
        )}
      </form>

      {recentProjects.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Your recent projects</h2>
          <ul className="space-y-2">
            {recentProjects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-all hover:border-accent hover:shadow-card"
                >
                  <span className="truncate text-sm text-foreground">{p.idea}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(p.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
