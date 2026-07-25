import type { ShotStatus } from "@/types";

const DOT_STYLES: Record<string, string> = {
  done: "bg-success",
  error: "bg-danger",
  default: "bg-muted-foreground",
};

const TEXT_STYLES: Record<string, string> = {
  done: "text-success",
  error: "text-danger",
  default: "text-muted-foreground",
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
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${
        TEXT_STYLES[status] ?? TEXT_STYLES.default
      }`}
    >
      {isBusy ? (
        <span className="spinner" />
      ) : (
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_STYLES[status] ?? DOT_STYLES.default}`} />
      )}
      {LABELS[status] ?? status}
    </span>
  );
}
