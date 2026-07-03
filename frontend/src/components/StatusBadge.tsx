import type { ShotStatus } from "@/types";

const STYLES: Record<string, string> = {
  done: "bg-success-soft text-success",
  error: "bg-danger-soft text-danger",
  default: "bg-surface-muted text-muted-foreground",
};

const LABELS: Record<ShotStatus, string> = {
  pending: "Queued",
  image_prompt: "Planning shot",
  image: "Rendering image",
  video_prompt: "Writing video prompt",
  video: "Rendering video",
  done: "Done",
  error: "Failed",
};

export default function StatusBadge({ status }: { status: ShotStatus }) {
  const isBusy = status !== "done" && status !== "error" && status !== "pending";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
        STYLES[status] ?? STYLES.default
      }`}
    >
      {isBusy && <span className="spinner" />}
      {LABELS[status] ?? status}
    </span>
  );
}
