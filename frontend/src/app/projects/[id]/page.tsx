"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { ProjectWithShots } from "@/types";
import { fetchProject, imageUrl, ApiError } from "@/lib/api";
import { addRecentProject } from "@/lib/recentProjects";
import Collapsible from "@/components/Collapsible";
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
    <main className="mx-auto max-w-5xl px-6 pb-24 pt-10">
      <div className="mb-6">
        <div className="skeleton mb-2 h-3 w-24" />
        <div className="skeleton h-8 w-3/4 max-w-xl" />
      </div>
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-7 w-7 shrink-0 rounded-full" />
          ))}
        </div>
        <div className="skeleton mt-4 h-4 w-56 border-t border-border pt-4" />
      </div>
      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
      <main className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h1 className="text-2xl font-bold text-foreground">Project not found</h1>
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
    <main className="mx-auto max-w-5xl px-6 pb-24 pt-10">
      <div className="mb-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Project #{project.id}
        </p>
        <h1
          className="line-clamp-2 text-2xl font-bold leading-tight text-foreground sm:text-3xl"
          title={project.idea_prompt}
        >
          {project.idea_prompt}
        </h1>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5 shadow-card">
        <PipelineStepper project={project} />
        <div
          className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
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
        <div className="mt-3 flex items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground" aria-live="polite">
          {isRunning && <span className="spinner" />}
          <span>{statusLabel(project.status)}</span>
          {project.shots.length > 0 && (
            <span className="ml-auto shrink-0 text-xs tabular-nums">
              {doneShots}/{project.shots.length} shots ready
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
        <div className="mt-6 space-y-4">
          {project.story_script && (
            <Collapsible title="Story script" defaultOpen={project.status === "story"}>
              <div className="max-w-[66ch] whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">
                {project.story_script}
              </div>
            </Collapsible>
          )}

          {project.character_description && (
            <Collapsible title="Character" defaultOpen={project.status === "character"}>
              <div className="flex flex-col gap-4 sm:flex-row">
                {project.character_image_path && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="aspect-[3/4] w-full max-w-[220px] shrink-0 self-start rounded-xl bg-surface-muted object-cover"
                    src={imageUrl(project.character_image_path)}
                    alt="Character reference"
                  />
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
        <div className="mt-8">
          <h2 className="mb-4 text-lg font-semibold text-foreground">Shots</h2>
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
