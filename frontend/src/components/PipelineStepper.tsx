import type { ProjectWithShots } from "@/types";

const STEPS = [
  { key: "pending", label: "Starting" },
  { key: "story", label: "Story" },
  { key: "character", label: "Character" },
  { key: "scenes", label: "Scenes" },
  { key: "shots", label: "Shots" },
  { key: "done", label: "Done" },
] as const;

/** Which step was in progress when the pipeline failed, inferred from the data it managed to save. */
function reachedIndexOnError(project: ProjectWithShots): number {
  if (project.shots.length > 0) return STEPS.findIndex((s) => s.key === "shots");
  if (project.character_description) return STEPS.findIndex((s) => s.key === "scenes");
  if (project.story_script) return STEPS.findIndex((s) => s.key === "character");
  return STEPS.findIndex((s) => s.key === "story");
}

export default function PipelineStepper({ project }: { project: ProjectWithShots }) {
  const isError = project.status === "error";
  const statusIndex = STEPS.findIndex((s) => s.key === project.status);
  const currentIndex = isError ? reachedIndexOnError(project) : Math.max(statusIndex, 0);

  return (
    <ol className="flex items-center overflow-x-auto pb-1">
      {STEPS.map((step, i) => {
        const active = i === currentIndex;
        const errored = isError && active;
        const done = i < currentIndex;
        return (
          <li key={step.key} className="flex items-center last:flex-none" aria-current={active ? "step" : undefined}>
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                  errored
                    ? "bg-danger-soft text-danger ring-2 ring-danger"
                    : done
                      ? "bg-accent text-accent-foreground"
                      : active
                        ? "bg-accent-soft text-accent ring-2 ring-accent"
                        : "bg-surface-muted text-muted-foreground"
                }`}
              >
                {errored ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                ) : done ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`whitespace-nowrap text-[11px] font-medium ${
                  errored ? "text-danger" : active ? "text-accent" : done ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`mx-1.5 h-0.5 w-8 shrink-0 rounded-full transition-colors sm:w-14 ${
                  done ? "bg-accent" : "bg-surface-muted"
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
