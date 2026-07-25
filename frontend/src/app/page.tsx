"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createProject, ApiError } from "@/lib/api";
import { addRecentProject, getRecentProjects, type RecentProject } from "@/lib/recentProjects";

const EXAMPLE_IDEAS = [
  "A startup founder overwhelmed by manual work discovers an AI platform that automates everything.",
  "A lone astronaut repairs a failing space station while a storm approaches Earth.",
  "A street food vendor's secret recipe becomes the talk of the city overnight.",
  "A rescue dog trains to become a search-and-rescue hero after a flood.",
];

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

export default function HomePage() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [shotCount, setShotCount] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);

  useEffect(() => {
    setRecentProjects(getRecentProjects());
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const trimmedIdea = idea.trim();
    if (!trimmedIdea) {
      setError("Please describe your video idea first.");
      return;
    }
    if (!Number.isFinite(shotCount) || shotCount < 1 || shotCount > 20) {
      setError("Number of shots must be between 1 and 20.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { id } = await createProject(trimmedIdea, shotCount);
      addRecentProject({ id, idea: trimmedIdea, createdAt: new Date().toISOString() });
      router.push(`/projects/${id}`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to start pipeline. Please try again.";
      setError(message);
      setSubmitting(false);
    }
  }

  function adjustShotCount(delta: number) {
    setShotCount((n) => Math.min(20, Math.max(1, n + delta)));
  }

  function handleShotCountChange(value: string) {
    if (value === "") {
      setShotCount(1);
      return;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      setShotCount(Math.min(20, Math.max(1, Math.trunc(parsed))));
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 pb-24 pt-16">
      <div className="mb-10 text-center">
        <span className="mb-4 inline-block rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
          Idea to shot list, automatically
        </span>
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Turn one idea into a <span className="text-accent">shot-ready</span> story
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
          Describe your video idea. We&apos;ll write the story, design your character, break it into shots, and
          generate images and video prompts for each one.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="rounded-3xl border border-border bg-surface p-6 shadow-sm sm:p-8"
      >
        <label htmlFor="idea" className="mb-2 block text-sm font-medium text-foreground">
          Video idea
        </label>
        <textarea
          id="idea"
          placeholder="e.g. A startup founder overwhelmed by manual work discovers an AI platform that automates everything..."
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          maxLength={4000}
          className="min-h-[140px] w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-[15px] text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />

        <div className="mt-3 flex flex-wrap gap-2">
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

        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <label htmlFor="shotCount" className="mb-2 block text-sm font-medium text-foreground">
              Number of shots
            </label>
            <div className="flex items-center rounded-xl border border-border bg-background">
              <button
                type="button"
                onClick={() => adjustShotCount(-1)}
                aria-label="Decrease shot count"
                className="flex h-11 w-11 items-center justify-center text-lg text-muted-foreground transition-colors hover:text-accent"
              >
                −
              </button>
              <input
                id="shotCount"
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                value={shotCount}
                onChange={(e) => handleShotCountChange(e.target.value)}
                className="w-14 border-x border-border bg-transparent py-2.5 text-center text-[15px] text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              <button
                type="button"
                onClick={() => adjustShotCount(1)}
                aria-label="Increase shot count"
                className="flex h-11 w-11 items-center justify-center text-lg text-muted-foreground transition-colors hover:text-accent"
              >
                +
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex h-12 items-center gap-2 rounded-xl bg-accent px-6 text-[15px] font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <span className="spinner" />}
            {submitting ? "Starting..." : "Generate video shots"}
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
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Your recent projects
          </h2>
          <ul className="space-y-2">
            {recentProjects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition-colors hover:border-accent"
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
