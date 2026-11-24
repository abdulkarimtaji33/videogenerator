"use client";
import { useCallback, useEffect, useState } from "react";
import { StudioError } from "@/lib/studio";

export function Card({ title, children, right, className = "" }: { title?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 shadow-card ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="font-[family-name:var(--font-display)] text-[15px] font-semibold tracking-tight">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

const TONE: Record<string, string> = {
  ok: "bg-success-soft text-success",
  warn: "bg-accent-soft text-accent",
  error: "bg-danger-soft text-danger",
  neutral: "bg-surface-muted text-muted-foreground",
};

export function Badge({ tone = "neutral", children }: { tone?: "ok" | "warn" | "error" | "neutral"; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>;
}

export function Button({ children, onClick, disabled, variant = "primary", type = "button" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: "primary" | "ghost" | "danger"; type?: "button" | "submit" }) {
  const v = variant === "primary" ? "bg-accent text-accent-foreground hover:opacity-90" : variant === "danger" ? "bg-danger-soft text-danger hover:opacity-80" : "border border-border hover:border-accent hover:text-accent";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${v}`}>
      {children}
    </button>
  );
}

export const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent";

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>;
}

export function Page({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      <div className="mt-6 space-y-5">{children}</div>
    </main>
  );
}

/** Loads data on mount and (optionally) every `pollMs`, exposing a reload function. */
export function useLoad<T>(loader: () => Promise<T>, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(async () => {
    try {
      setData(await loader());
      setError(null);
    } catch (e) {
      setError(e instanceof StudioError ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    if (!pollMs) return;
    const t = setInterval(() => void load(), pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { data, error, loading, reload: load };
}
