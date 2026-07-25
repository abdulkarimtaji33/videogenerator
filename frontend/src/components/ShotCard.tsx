"use client";

import { useState } from "react";
import type { Shot } from "@/types";
import { imageUrl } from "@/lib/api";
import StatusBadge from "./StatusBadge";
import CopyableBlock from "./CopyableBlock";

const BUSY_STATUSES = new Set(["image_prompt", "image", "video"]);

export default function ShotCard({ shot }: { projectId: number; shot: Shot }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [videoPromptCopied, setVideoPromptCopied] = useState(false);

  const isBusy = BUSY_STATUSES.has(shot.status);

  async function handleCopyVideoPrompt() {
    if (!shot.video_prompt) return;
    try {
      await navigator.clipboard.writeText(shot.video_prompt);
      setVideoPromptCopied(true);
      setTimeout(() => setVideoPromptCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (e.g. insecure context); fail silently, the text is still visible to select.
    }
  }

  const hasDetails = Boolean(shot.voiceover || shot.image_prompt || shot.video_prompt || shot.error_message);
  const canCopyVideoPrompt = Boolean(shot.video_prompt);
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
        {shot.duration && (
          <span className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-background/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-foreground shadow-sm backdrop-blur-sm">
            {shot.duration}
          </span>
        )}
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
              className="flex-1 min-h-[38px] rounded-lg border border-border py-2.5 text-xs font-medium text-foreground transition-all hover:bg-surface-muted active:scale-[0.97]"
            >
              {videoPromptCopied ? "Copied" : "Copy video prompt"}
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
      </div>
    </div>
  );
}
