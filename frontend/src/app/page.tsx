"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createProject, ApiError } from "@/lib/api";

const EXAMPLE_IDEAS = [
  "A startup founder overwhelmed by manual work discovers an AI platform that automates everything.",
  "A lone astronaut repairs a failing space station while a storm approaches Earth.",
  "A street food vendor's secret recipe becomes the talk of the city overnight.",
  "A rescue dog trains to become a search-and-rescue hero after a flood.",
];

export default function HomePage() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [shotCount, setShotCount] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
                min={1}
                max={20}
                value={shotCount}
                onChange={(e) => setShotCount(Number(e.target.value))}
                className="w-14 border-x border-border bg-transparent py-2.5 text-center text-[15px] text-foreground focus:outline-none"
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
          <div className="mt-5 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}
      </form>
    </main>
  );
}
