"use client";

import { useEffect, useState } from "react";
import type { Shot } from "@/types";
import { imageUrl, updateShotDuration, ApiError } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import StatusBadge from "./StatusBadge";
import CopyableBlock from "./CopyableBlock";

const BUSY_STATUSES = new Set(["image_prompt", "image", "video"]);
const MIN_DURATION_SECONDS = 1;
const MAX_DURATION_SECONDS = 30;

export default function ShotCard({ projectId, shot }: { projectId: number; shot: Shot }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [videoPromptCopyState, setVideoPromptCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [pendingDuration, setPendingDuration] = useState<number | null>(null);
  const [durationError, setDurationError] = useState<string | null>(null);

  const isBusy = BUSY_STATUSES.has(shot.status);
  const isUpdatingDuration = shot.status === "video_prompt" || pendingDuration !== null;
  const displayedDuration = pendingDuration ?? shot.duration_seconds;

  // Once the server confirms the new duration (and finishes regenerating the video prompt for
  // it), drop the optimistic override so the UI goes back to trusting the polled value.
  useEffect(() => {
    if (pendingDuration !== null && shot.duration_seconds === pendingDuration && shot.status !== "video_prompt") {
      setPendingDuration(null);
    }
  }, [shot.duration_seconds, shot.status, pendingDuration]);

  async function handleCopyVideoPrompt() {
    if (!shot.video_prompt) return;
    const ok = await copyToClipboard(shot.video_prompt);
    setVideoPromptCopyState(ok ? "copied" : "failed");
    setTimeout(() => setVideoPromptCopyState("idle"), 1500);
  }

  async function handleChangeDuration(delta: number) {
    if (isBusy || isUpdatingDuration || !shot.image_prompt) return;
    const next = Math.min(MAX_DURATION_SECONDS, Math.max(MIN_DURATION_SECONDS, displayedDuration + delta));
    if (next === displayedDuration) return;

    setDurationError(null);
    setPendingDuration(next);
    try {
      await updateShotDuration(projectId, shot.id, next);
    } catch (err) {
      setDurationError(err instanceof ApiError ? err.message : "Failed to update clip length.");
      setPendingDuration(null);
    }
  }

  const hasDetails = Boolean(shot.voiceover || shot.image_prompt || shot.video_prompt || shot.error_message);
  const canCopyVideoPrompt = Boolean(shot.video_prompt);
  const canEditDuration = Boolean(shot.image_prompt);
  const showGenerateVideo = Boolean(shot.image_path && shot.video_prompt) && !shot.video_path;

  return (
    <div className="group overflow-hidden rounded-2xl border border-border bg-surface shadow-card transition-all hover:-translate-y-0.5 hover:shadow-raised">
      <div className="relative">
        {shot.video_path ? (
          <video
            className="aspect-square w-full bg-surface-muted object-cover"
            src={imageUrl(shot.video_path)}
            poster={shot.image_path ? imageUrl(shot.image_path) : undefined}
            controls
            loop
          />
        ) : shot.image_path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="aspect-square w-full bg-surface-muted object-cover"
            src={imageUrl(shot.image_path)}
            alt={shot.title || `Shot ${shot.shot_number}`}
          />
        ) : (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-surface-muted text-muted-foreground">
            {shot.status === "error" ? (
              <span className="text-xs">Image generation failed</span>
            ) : (
              <>
                <span className="spinner" />
                <span className="text-xs">Generating image...</span>
              </>
            )}
          </div>
        )}
        <span className="pointer-events-none absolute left-3 top-3 flex h-7 min-w-7 items-center justify-center rounded-md bg-background/80 px-1.5 font-[family-name:var(--font-display)] text-[13px] font-semibold tabular-nums text-foreground shadow-sm backdrop-blur-sm">
          {String(shot.shot_number).padStart(2, "0")}
        </span>
        <span className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-background/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-foreground shadow-sm backdrop-blur-sm">
          {displayedDuration}s
        </span>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {shot.title || `Shot ${shot.shot_number}`}
          </h3>
          <StatusBadge status={shot.status} />
        </div>

        {shot.voiceover && (
          <p className="mt-2 border-l-2 border-border pl-2.5 text-sm italic leading-relaxed text-muted-foreground">
            &ldquo;{shot.voiceover}&rdquo;
          </p>
        )}

        {canEditDuration && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Clip length</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleChangeDuration(-1)}
                disabled={isBusy || isUpdatingDuration || displayedDuration <= MIN_DURATION_SECONDS}
                aria-label="Decrease clip length"
                className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                −
              </button>
              <span className="flex w-10 items-center justify-center text-xs font-semibold tabular-nums text-foreground">
                {isUpdatingDuration ? <span className="spinner" /> : `${displayedDuration}s`}
              </span>
              <button
                type="button"
                onClick={() => handleChangeDuration(1)}
                disabled={isBusy || isUpdatingDuration || displayedDuration >= MAX_DURATION_SECONDS}
                aria-label="Increase clip length"
                className="flex h-7 w-7 items-center justify-center rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>
        )}

        {hasDetails && (
          <button
            type="button"
            onClick={() => setDetailsOpen((o) => !o)}
            aria-expanded={detailsOpen}
            className="mt-3 flex w-full items-center justify-between text-xs font-medium text-muted-foreground transition-colors hover:text-accent"
          >
            {detailsOpen ? "Hide prompts" : "Show prompts"}
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className={`transition-transform duration-200 ${detailsOpen ? "rotate-180" : ""}`}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        )}

        <div className={`collapsible-content ${detailsOpen ? "open" : ""}`}>
          <div>
            <div className="space-y-2.5 pt-3">
              {shot.image_prompt && <CopyableBlock label="Image prompt" text={shot.image_prompt} />}
              {shot.video_prompt && <CopyableBlock label="Video prompt" text={shot.video_prompt} />}

              {shot.error_message && (
                <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
                  {shot.error_message}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2.5">
          {shot.video_path ? (
            <a href={imageUrl(shot.video_path)} download className="flex-1">
              <button
                type="button"
                className="w-full min-h-[38px] rounded-lg border border-border py-2.5 text-xs font-medium text-foreground transition-all hover:bg-surface-muted active:scale-[0.97]"
              >
                Download video
              </button>
            </a>
          ) : (
            shot.image_path && (
              <a href={imageUrl(shot.image_path)} download className="flex-1">
                <button
                  type="button"
                  className="w-full min-h-[38px] rounded-lg border border-border py-2.5 text-xs font-medium text-foreground transition-all hover:bg-surface-muted active:scale-[0.97]"
                >
                  Download
                </button>
              </a>
            )
          )}

          {canCopyVideoPrompt && (
            <button
              type="button"
              onClick={handleCopyVideoPrompt}
              className={`flex-1 min-h-[38px] rounded-lg border py-2.5 text-xs font-medium transition-all hover:bg-surface-muted active:scale-[0.97] ${
                videoPromptCopyState === "failed" ? "border-danger/30 text-danger" : "border-border text-foreground"
              }`}
            >
              {videoPromptCopyState === "copied"
                ? "Copied"
                : videoPromptCopyState === "failed"
                  ? "Couldn't copy"
                  : "Copy video prompt"}
            </button>
          )}

          {showGenerateVideo && (
            <button
              type="button"
              disabled
              title="Video generation is coming soon"
              className="w-full min-h-[38px] cursor-not-allowed rounded-lg bg-accent/50 py-2.5 text-xs font-semibold text-accent-foreground opacity-70"
            >
              Generate video (coming soon)
            </button>
          )}
        </div>

        {durationError && (
          <div className="mt-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            {durationError}
          </div>
        )}
      </div>
    </div>
  );
}
