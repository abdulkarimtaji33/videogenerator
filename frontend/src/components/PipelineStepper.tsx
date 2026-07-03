import type { ProjectStatus } from "@/types";

const STEPS: { key: ProjectStatus; label: string }[] = [
  { key: "pending", label: "Starting" },
  { key: "story", label: "Story" },
  { key: "character", label: "Character" },
  { key: "scenes", label: "Scenes" },
  { key: "shots", label: "Shots" },
  { key: "done", label: "Done" },
];

export default function PipelineStepper({ status }: { status: ProjectStatus }) {
  const isError = status === "error";
  const currentIndex = isError ? STEPS.length : STEPS.findIndex((s) => s.key === status);

  return (
    <div className="flex items-center overflow-x-auto pb-1">
      {STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex && !isError;
        return (
          <div key={step.key} className="flex items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                  done
                    ? "bg-accent text-accent-foreground"
                    : active
                      ? "bg-accent-soft text-accent ring-2 ring-accent"
                      : "bg-surface-muted text-muted-foreground"
                }`}
              >
                {done ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`whitespace-nowrap text-[11px] font-medium ${
                  active ? "text-accent" : done ? "text-foreground" : "text-muted-foreground"
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
          </div>
        );
      })}
    </div>
  );
}
