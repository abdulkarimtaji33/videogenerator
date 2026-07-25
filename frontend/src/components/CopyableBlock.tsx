import CopyButton from "./CopyButton";

export default function CopyableBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-muted px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <CopyButton text={text} />
      </div>
      <div className="max-h-56 overflow-y-auto whitespace-pre-wrap px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-foreground">
        {text}
      </div>
    </div>
  );
}
