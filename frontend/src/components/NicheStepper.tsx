const STEPS = [
  { key: "brief", label: "Brief" },
  { key: "facts", label: "Facts" },
  { key: "seo", label: "SEO" },
  { key: "hook", label: "Hook" },
  { key: "script", label: "Script" },
  { key: "review", label: "Review" },
  { key: "anchors", label: "Anchors" },
  { key: "shots", label: "Shots" },
  { key: "plan ready", label: "Plan" },
  { key: "clips", label: "Clips" },
  { key: "narration", label: "Voice" },
  { key: "assembling", label: "Assemble" },
  { key: "qa", label: "QA" },
  { key: "thumbnails", label: "Thumbs" },
  { key: "video ready", label: "Video" },
  { key: "publishing", label: "Upload" },
  { key: "published", label: "Live" },
] as const;

function stepKey(stage: string | null): string | null {
  if (!stage) return null;
  if (/^clip \d+ of \d+$/.test(stage) || stage === "queued for video") return "clips";
  return STEPS.some((s) => s.key === stage) ? stage : null;
}

/** Progress through the niche pipeline stages. `failedAt` is the step to mark when the run failed. */
export default function NicheStepper({ stage, failed, hasVideo }: { stage: string | null; failed: boolean; hasVideo: boolean }) {
  let key = stepKey(stage);
  if (!key) key = failed ? (hasVideo ? "video ready" : "clips") : "brief";
  const current = STEPS.findIndex((s) => s.key === key);

  return (
    <div className="overflow-x-auto pb-1">
      <ol className="flex min-w-[640px] items-start justify-between">
        {STEPS.map((step, i) => {
          const active = i === current;
          const done = i < current;
          const errored = failed && active;
          return (
            <li key={step.key} className="relative flex flex-1 flex-col items-center gap-2" aria-current={active ? "step" : undefined}>
              {i > 0 && <span className={`absolute right-1/2 top-[7px] h-px w-full ${i <= current ? "bg-accent" : "bg-border"}`} aria-hidden="true" />}
              <span className={`relative z-[1] block h-3.5 w-3.5 shrink-0 rounded-full ring-4 ring-surface ${errored ? "bg-danger" : done || active ? "bg-accent" : "bg-border"}`}>
                {active && !errored && !failed && stage !== "published" && stage !== "video ready" && stage !== "plan ready" && (
                  <span className="absolute inset-0 -m-1 animate-ping rounded-full bg-accent/40" aria-hidden="true" />
                )}
              </span>
              <span className={`whitespace-nowrap text-[10px] font-medium tracking-wide ${errored ? "text-danger" : active ? "text-foreground" : "text-muted-foreground"}`}>{step.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function nicheProgressPercent(stage: string | null): number {
  const key = stepKey(stage);
  if (!key) return 0;
  return Math.round((STEPS.findIndex((s) => s.key === key) / (STEPS.length - 1)) * 100);
}
