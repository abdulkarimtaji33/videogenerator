"use client";

import { useState } from "react";
import type { Shot } from "@/types";
import { imageUrl, generateShotVideo, regenerateShotImage, ApiError } from "@/lib/api";
import StatusBadge from "./StatusBadge";

const BUSY_STATUSES = new Set(["image_prompt", "image", "video"]);

export default function ShotCard({ projectId, shot }: { projectId: number; shot: Shot }) {
  const [detailsOpen, setDetailsOpen] = useState(shot.status !== "done");
  const [copied, setCopied] = useState(false);
  const [videoActionError, setVideoActionError] = useState<string | null>(null);
  const [imageActionError, setImageActionError] = useState<string | null>(null);
  const [videoStarting, setVideoStarting] = useState(false);
  const [imageStarting, setImageStarting] = useState(false);

  const isBusy = BUSY_STATUSES.has(shot.status) || videoStarting || imageStarting;

  async function copyPrompt() {
    if (!shot.video_prompt) return;
    try {
      await navigator.clipboard.writeText(shot.video_prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (e.g. insecure context); fail silently, the prompt text is still visible.
    }
  }

  async function handleGenerateVideo() {
    setVideoActionError(null);
    setVideoStarting(true);
    try {
      await generateShotVideo(projectId, shot.id);
    } catch (err) {
      setVideoActionError(err instanceof ApiError ? err.message : "Failed to start video generation.");
      setVideoStarting(false);
    }
  }

  async function handleRegenerateImage() {
    setImageActionError(null);
    setImageStarting(true);
    try {
      await regenerateShotImage(projectId, shot.id);
    } catch (err) {
      setImageActionError(err instanceof ApiError ? err.message : "Failed to start image regeneration.");
      setImageStarting(false);
    }
  }

  const hasDetails = Boolean(shot.voiceover || shot.image_prompt || shot.video_prompt || shot.error_message);
  const canGenerateVideo = Boolean(shot.image_path && shot.video_prompt) && !shot.video_path && !isBusy;
  const canRegenerateImage = Boolean(shot.image_prompt) && !isBusy;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
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

      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {shot.title || `Shot ${shot.shot_number}`}
          </h3>
          <StatusBadge status={shot.status} />
        </div>

        {hasDetails && (
          <button
            type="button"
            onClick={() => setDetailsOpen((o) => !o)}
            className="mt-3 flex w-full items-center justify-between text-xs font-medium text-muted-foreground transition-colors hover:text-accent"
          >
            Details
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
            <div className="space-y-3 pt-3">
              {shot.voiceover && (
                <p className="text-sm italic leading-relaxed text-muted-foreground">&ldquo;{shot.voiceover}&rdquo;</p>
              )}

              {shot.image_prompt && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Image prompt
                  </p>
                  <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground">
                    {shot.image_prompt}
                  </pre>
                </div>
              )}

              {shot.video_prompt && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Video prompt
                  </p>
                  <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground">
                    {shot.video_prompt}
                  </pre>
                </div>
              )}

              {shot.error_message && (
                <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
                  {shot.error_message}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {shot.video_path ? (
            <a href={imageUrl(shot.video_path)} download className="flex-1">
              <button
                type="button"
                className="w-full rounded-lg border border-border py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted"
              >
                Download video
              </button>
            </a>
          ) : (
            shot.image_path && (
              <a href={imageUrl(shot.image_path)} download className="flex-1">
                <button
                  type="button"
                  className="w-full rounded-lg border border-border py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted"
                >
                  Download
                </button>
              </a>
            )
          )}
          {shot.video_prompt && (
            <button
              type="button"
              onClick={copyPrompt}
              className="flex-1 rounded-lg bg-accent-soft py-2 text-xs font-medium text-accent transition-opacity hover:opacity-80"
            >
              {copied ? "Copied!" : "Copy prompt"}
            </button>
          )}

          {canRegenerateImage && (
            <button
              type="button"
              onClick={handleRegenerateImage}
              disabled={imageStarting}
              className="w-full rounded-lg border border-border py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted disabled:opacity-60"
            >
              {imageStarting ? "Regenerating..." : "Regenerate image"}
            </button>
          )}

          {canGenerateVideo && (
            <button
              type="button"
              onClick={handleGenerateVideo}
              disabled={videoStarting}
              className="w-full rounded-lg bg-accent-soft py-2 text-xs font-medium text-accent transition-opacity hover:opacity-80 disabled:opacity-60"
            >
              {videoStarting ? "Generating video..." : "Generate video"}
            </button>
          )}
        </div>

        {imageActionError && (
          <div className="mt-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            {imageActionError}
          </div>
        )}
        {videoActionError && (
          <div className="mt-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
            {videoActionError}
          </div>
        )}
      </div>
    </div>
  );
}
