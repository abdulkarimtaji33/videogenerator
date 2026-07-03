"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { ProjectWithShots } from "@/types";
import { fetchProject, imageUrl, ApiError } from "@/lib/api";
import Collapsible from "@/components/Collapsible";
import PipelineStepper from "@/components/PipelineStepper";
import ShotCard from "@/components/ShotCard";

const TERMINAL_STATUSES = new Set(["done", "error"]);
const SHOT_BUSY_STATUSES = new Set(["image_prompt", "image", "video"]);

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

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<ProjectWithShots | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<string | null>(null);

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

  if (notFound) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h1 className="text-2xl font-bold text-foreground">Project not found</h1>
        <p className="mt-2 text-muted-foreground">This project doesn&apos;t exist, or the backend database was reset.</p>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="spinner" />
          Loading project...
        </div>
        {loadError && (
          <div className="mt-4 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            {loadError}
          </div>
        )}
      </main>
    );
  }

  const isRunning = !TERMINAL_STATUSES.has(project.status);
  const doneShots = project.shots.filter((s) => s.status === "done").length;

  return (
    <main className="mx-auto max-w-5xl px-6 pb-24 pt-10">
      <div className="mb-6">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Project #{project.id}
        </p>
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{project.idea_prompt}</h1>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <PipelineStepper status={project.status} />
        <div className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
          {isRunning && <span className="spinner" />}
          <span>{statusLabel(project.status)}</span>
          {project.shots.length > 0 && (
            <span className="ml-auto text-xs">
              {doneShots}/{project.shots.length} shots ready
            </span>
          )}
        </div>
      </div>

      {loadError && (
        <div className="mt-6 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {loadError}
        </div>
      )}

      {project.status === "error" && project.error_message && (
        <div className="mt-6 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {project.error_message}
        </div>
      )}

      {(project.story_script || project.character_description) && (
        <div className="mt-6 space-y-4">
          {project.story_script && (
            <Collapsible title="Story script" defaultOpen={project.status === "story"}>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                {project.story_script}
              </pre>
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
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                  {project.character_description}
                </pre>
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
