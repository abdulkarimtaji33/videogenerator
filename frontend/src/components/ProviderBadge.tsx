const LABELS: Record<string, string> = { "flux-local": "FLUX", openai: "OpenAI", fal: "fal" };

export function providerLabel(id: string | null | undefined): string {
  if (!id) return "";
  return LABELS[id] ?? id;
}

/** Small overlay badge showing which image model made a picture and how long it took. Renders nothing on old projects. */
export default function ProviderBadge({ provider, ms, position = "br" }: { provider?: string | null; ms?: number | null; position?: "br" | "bl" }) {
  if (!provider) return null;
  const seconds = typeof ms === "number" && ms > 0 ? ` · ${ms >= 10000 ? Math.round(ms / 1000) : (ms / 1000).toFixed(1)}s` : "";
  return (
    <span
      className={`pointer-events-none absolute bottom-2 ${position === "bl" ? "left-2" : "right-2"} rounded-md bg-background/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-foreground shadow-sm backdrop-blur-sm`}
      title={`Image made by ${providerLabel(provider)}`}
    >
      {providerLabel(provider)}
      {seconds}
    </span>
  );
}
