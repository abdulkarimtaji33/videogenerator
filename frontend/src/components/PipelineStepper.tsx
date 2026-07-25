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
  const fillPercent = (currentIndex / (STEPS.length - 1)) * 100;

  return (
    <ol className="relative flex items-start justify-between">
      <div className="absolute left-0 right-0 top-[7px] h-px bg-border" aria-hidden="true" />
      <div
        className={`absolute left-0 top-[7px] h-px transition-[width] duration-500 ease-out ${isError ? "bg-danger" : "bg-accent"}`}
        style={{ width: `${fillPercent}%` }}
        aria-hidden="true"
      />
      {STEPS.map((step, i) => {
        const active = i === currentIndex;
        const errored = isError && active;
        const done = i < currentIndex;
        return (
          <li
            key={step.key}
            className="relative flex flex-1 flex-col items-center gap-2 first:items-start last:items-end"
            aria-current={active ? "step" : undefined}
          >
            <span
              className={`relative z-[1] block h-3.5 w-3.5 shrink-0 rounded-full ring-4 ring-background transition-colors ${
                errored ? "bg-danger" : done ? "bg-accent" : active ? "bg-accent" : "bg-border"
              }`}
            >
              {active && !errored && (
                <span className="absolute inset-0 -m-1 animate-ping rounded-full bg-accent/40" aria-hidden="true" />
              )}
            </span>
            <span
              className={`whitespace-nowrap text-[11px] font-medium tracking-wide ${
                errored ? "text-danger" : active ? "text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/70"
              }`}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
