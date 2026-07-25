"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { ProjectWithShots } from "@/types";
import { fetchProject, imageUrl, ApiError } from "@/lib/api";
import { addRecentProject } from "@/lib/recentProjects";
import Collapsible from "@/components/Collapsible";
import CopyButton from "@/components/CopyButton";
import PipelineStepper from "@/components/PipelineStepper";
import ShotCard from "@/components/ShotCard";

const TERMINAL_STATUSES = new Set(["done", "error"]);
const SHOT_BUSY_STATUSES = new Set(["image_prompt", "image", "video"]);
const STEP_ORDER = ["pending", "story", "character", "scenes", "shots", "done"];

/** Rough overall completion, for a slim progress bar — blends pipeline stage with per-shot progress once shots exist. */
function computeProgressPercent(project: ProjectWithShots): number {
  if (project.status === "done") return 100;
  const idx = STEP_ORDER.indexOf(project.status);
  if (idx === -1) return 0;
  const stepFraction = idx / (STEP_ORDER.length - 1);
  if (project.shots.length > 0) {
    const shotsFraction = project.shots.filter((s) => s.status === "done").length / project.shots.length;
    const shotsStepFraction = STEP_ORDER.indexOf("shots") / (STEP_ORDER.length - 1);
    const doneStepFraction = STEP_ORDER.indexOf("done") / (STEP_ORDER.length - 1);
    return Math.round((shotsStepFraction + (doneStepFraction - shotsStepFraction) * shotsFraction) * 100);
  }
  return Math.round(stepFraction * 100);
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Starting...";
    case "story":
      return "Story written. Designing character...";
    case "character":
      return "Character designed. Generating reference image...";
    case "scenes":
      return "Scenes planned. Generating shots...";
    case "shots":
      return "Generating shot images and video prompts...";
    case "done":
      return "Done";
    case "error":
      return "Failed";
    default:
      return status;
  }
}

function ProjectSkeleton() {
  return (
    <main className="mx-auto max-w-5xl px-6 pb-24 pt-10 sm:pt-14">
      <div className="mb-8">
        <div className="skeleton mb-3 h-3 w-28 rounded-full" />
        <div className="skeleton h-10 w-3/4 max-w-xl" />
      </div>
      <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <div className="flex items-start justify-between gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-3.5 w-3.5 shrink-0 rounded-full" />
          ))}
        </div>
        <div className="skeleton mt-5 h-4 w-56 border-t border-border pt-4" />
      </div>
      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="skeleton aspect-square w-full rounded-none" />
            <div className="space-y-2 p-4">
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectWithShots | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<string | null>(null);
  const savedRecentRef = useRef(false);

  const poll = useCallback(async () => {
    try {
      const data = await fetchProject(params.id);
      setProject(data);
      setLoadError(null);
      setNotFound(false);
      statusRef.current = TERMINAL_STATUSES.has(data.status) && data.shots.some((s) => SHOT_BUSY_STATUSES.has(s.status))
        ? "shots-busy"
        : data.status;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
        statusRef.current = "error";
        return; // stop polling, nothing will ever appear for a missing project
      }
      setLoadError(err instanceof ApiError ? err.message : "Failed to load project. Retrying...");
    }

    const isTerminal = statusRef.current !== null && TERMINAL_STATUSES.has(statusRef.current);
    timeoutRef.current = setTimeout(poll, isTerminal ? 5000 : 2000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    poll();
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [poll]);

  useEffect(() => {
    if (!project) return;
    document.title = `${project.idea_prompt.slice(0, 60)} — Shotcraft`;
    if (!savedRecentRef.current) {
      savedRecentRef.current = true;
      addRecentProject({ id: project.id, idea: project.idea_prompt, createdAt: project.created_at });
    }
    return () => {
      document.title = "Shotcraft — AI Video Shot Generator";
    };
  }, [project]);

  if (notFound) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20 text-center">
        <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
        </span>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold text-foreground">
          Project not found
        </h1>
        <p className="mt-2 text-muted-foreground">This project doesn&apos;t exist, or the backend database was reset.</p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center rounded-xl bg-accent px-5 text-[15px] font-semibold text-accent-foreground shadow-card transition-all hover:opacity-90 active:scale-[0.98]"
        >
          Start a new project
        </Link>
      </main>
    );
  }

  if (!project) {
    return (
      <>
        <ProjectSkeleton />
        {loadError && (
          <div className="mx-auto -mt-16 max-w-3xl px-6" role="alert">
            <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{loadError}</div>
          </div>
        )}
      </>
    );
  }

  const isRunning = !TERMINAL_STATUSES.has(project.status);
  const isError = project.status === "error";
  const doneShots = project.shots.filter((s) => s.status === "done").length;
  const progressPercent = computeProgressPercent(project);

  return (
    <main className="mx-auto max-w-5xl px-6 pb-24 pt-10 sm:pt-14">
      <div className="animate-fade-up mb-8">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="rounded-full border border-border bg-surface px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide text-muted-foreground">
            #{String(project.id).padStart(4, "0")}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${
              isError ? "text-danger" : isRunning ? "text-accent" : "text-success"
            }`}
          >
            {isRunning ? <span className="spinner" /> : <span className={`h-1.5 w-1.5 rounded-full ${isError ? "bg-danger" : "bg-success"}`} />}
            {isError ? "Failed" : isRunning ? "In progress" : "Complete"}
          </span>
        </div>
        <h1
          className="line-clamp-3 font-[family-name:var(--font-display)] text-[clamp(1.75rem,1.35rem+2vw,2.75rem)] font-semibold leading-[1.1] tracking-tight text-foreground"
          title={project.idea_prompt}
        >
          {project.idea_prompt}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {project.shot_count} shot{project.shot_count === 1 ? "" : "s"} · created{" "}
          {new Date(project.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6">
        <PipelineStepper project={project} />
        <div
          className="mt-5 h-1 w-full overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Pipeline progress"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${isError ? "bg-danger" : "bg-accent"}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground" aria-live="polite">
          {isRunning && <span className="spinner" />}
          <span>{statusLabel(project.status)}</span>
          {project.shots.length > 0 && (
            <span className="ml-auto shrink-0 font-mono text-xs tabular-nums">
              {doneShots}/{project.shots.length} ready
            </span>
          )}
        </div>
      </div>

      {loadError && (
        <div className="mt-6 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
          {loadError}
        </div>
      )}

      {project.status === "error" && project.error_message && (
        <div className="mt-6 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
          {project.error_message}
        </div>
      )}

      {(project.story_script || project.character_description) && (
        <div className="mt-8 space-y-4">
          {project.story_script && (
            <Collapsible title="Story script" badge={<CopyButton text={project.story_script} />}>
              <div className="max-w-[66ch] whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">
                {project.story_script}
              </div>
            </Collapsible>
          )}

          {project.character_description && (
            <Collapsible
              title="Character"
              loading={project.status === "character" && !project.character_image_path}
              loadingLabel="Generating reference image..."
              badge={<CopyButton text={project.character_description} />}
            >
              <div className="flex flex-col gap-5 sm:flex-row">
                {project.character_image_path ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="aspect-[3/4] w-full max-w-[220px] shrink-0 self-start rounded-xl bg-surface-muted object-cover shadow-card"
                    src={imageUrl(project.character_image_path)}
                    alt="Character reference"
                  />
                ) : (
                  project.status === "character" && (
                    <div className="flex aspect-[3/4] w-full max-w-[220px] shrink-0 flex-col items-center justify-center gap-2 self-start rounded-xl bg-surface-muted text-muted-foreground">
                      <span className="spinner" />
                      <span className="text-xs">Generating image...</span>
                    </div>
                  )
                )}
                <div className="max-w-[66ch] whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">
                  {project.character_description}
                </div>
              </div>
            </Collapsible>
          )}
        </div>
      )}

      {project.shots.length > 0 && (
        <div className="mt-10">
          <div className="mb-4 flex items-baseline gap-2.5 border-b border-border pb-3">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-foreground">Shots</h2>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{project.shots.length} total</span>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {project.shots.map((shot) => (
              <ShotCard key={shot.id} projectId={project.id} shot={shot} />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
