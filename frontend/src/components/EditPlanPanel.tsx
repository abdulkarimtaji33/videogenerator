"use client";

import Collapsible from "@/components/Collapsible";
import type { EditBeat, ProjectWithShots } from "@/types";

const ROLE_TONE: Record<string, string> = {
  hook: "bg-accent-soft text-accent",
  payoff: "bg-success-soft text-success",
  rehook: "bg-accent-soft text-accent",
};

function Chip({ children, tone = "bg-surface-muted text-muted-foreground" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{children}</span>;
}

function fmt(n: number): string {
  return `${Math.round(n * 10) / 10}s`;
}

function BeatRow({ beat }: { beat: EditBeat }) {
  return (
    <tr className="align-top">
      <td className="py-2 pr-3 font-mono text-xs tabular-nums text-muted-foreground">{beat.index}</td>
      <td className="pr-3">
        <Chip tone={ROLE_TONE[beat.role]}>{beat.role}</Chip>
      </td>
      <td className="pr-3 text-xs">{beat.layout}</td>
      <td className="pr-3 text-xs tabular-nums">{beat.punch > 1 ? `x${beat.punch.toFixed(2)}` : "none"}</td>
      <td className="pr-3 text-xs">
        {beat.transitionIn}
        {beat.transitionIn !== "cut" && <span className="text-muted-foreground"> {fmt(beat.transitionSeconds)}</span>}
      </td>
      <td className="pr-3">
        <div className="flex flex-wrap gap-1">
          {beat.sfx?.length ? beat.sfx.map((s, i) => <Chip key={i}>{s.kind} @{fmt(s.at)}</Chip>) : <span className="text-xs text-muted-foreground">-</span>}
        </div>
      </td>
      <td className="pr-3 text-xs">{beat.keyword ?? <span className="text-muted-foreground">-</span>}</td>
      <td className="text-xs">{beat.card ? <span title={beat.card.text}>{beat.card.type}: {beat.card.text}</span> : <span className="text-muted-foreground">-</span>}</td>
    </tr>
  );
}

export default function EditPlanPanel({ project, onRebuild, rebuilding }: { project: ProjectWithShots; onRebuild: () => void; rebuilding?: boolean }) {
  const edit = project.edit;
  const review = project.editReview;
  const canRebuild = project.shots.length > 0;

  const rebuildBtn = (
    <button
      type="button"
      onClick={onRebuild}
      disabled={rebuilding || !canRebuild}
      className="min-h-[38px] rounded-lg border border-border px-4 text-xs font-medium text-foreground transition-all hover:border-accent hover:text-accent active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {rebuilding ? "Building..." : "Rebuild video"}
    </button>
  );

  if (!edit) {
    return (
      <Collapsible title="Edit plan" subtitle="Music, transitions, punch-ins and sound effects">
        <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
          <p>Edit plan is made when the video is built.</p>
          {rebuildBtn}
        </div>
      </Collapsible>
    );
  }

  const checks = review?.checks ?? [];
  const failed = checks.filter((c) => !c.ok && !c.fixed).length;

  return (
    <Collapsible
      title="Edit plan"
      subtitle={`${edit.style?.label ?? "Edit"} · ${edit.beats?.length ?? 0} beats · ${fmt(edit.totalSeconds)}`}
      badge={review && <Chip tone={review.passed ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}>{review.passed ? "review passed" : `${failed} to fix`}</Chip>}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Chip>style: {edit.style?.label ?? "-"}</Chip>
          <Chip>{fmt(edit.totalSeconds)} total</Chip>
          <Chip>music: {edit.music?.mood ?? edit.style?.musicMood ?? "none"}</Chip>
          <Chip>transitions: {edit.transitionKinds?.length ? edit.transitionKinds.join(", ") : "cuts only"}</Chip>
          {edit.loop && <Chip tone="bg-accent-soft text-accent">loops</Chip>}
          {edit.endCard && <Chip tone="bg-accent-soft text-accent">end card {fmt(edit.endCard.seconds)}</Chip>}
          <span className="ml-auto">{rebuildBtn}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">#</th>
                <th className="pr-3">Role</th>
                <th className="pr-3">Layout</th>
                <th className="pr-3">Punch</th>
                <th className="pr-3">Transition</th>
                <th className="pr-3">SFX</th>
                <th className="pr-3">Keyword</th>
                <th>Card</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(edit.beats ?? []).map((b) => (
                <BeatRow key={`${b.shotId}-${b.index}`} beat={b} />
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Edit review{review ? ` (${review.rounds} round${review.rounds === 1 ? "" : "s"})` : ""}
          </h3>
          {checks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No review has been run yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {checks.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-sm">
                  <span className={`mt-0.5 shrink-0 font-bold ${c.ok ? "text-success" : "text-danger"}`} aria-label={c.ok ? "passed" : "failed"}>
                    {c.ok ? "✓" : "✕"}
                  </span>
                  <span className="min-w-0 flex-1 text-foreground">{c.message}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {c.ref && <Chip>{c.ref}</Chip>}
                    {c.fixed && <Chip tone="bg-accent-soft text-accent">fixed</Chip>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Collapsible>
  );
}
