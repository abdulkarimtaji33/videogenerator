"use client";

import { useState, type ReactNode } from "react";

export default function Collapsible({
  title,
  subtitle,
  defaultOpen = false,
  loading = false,
  loadingLabel = "Generating...",
  badge,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-surface shadow-card transition-colors ${
        loading ? "border-accent/40" : "border-border"
      }`}
    >
      <div className="flex w-full items-center justify-between gap-3 px-5 py-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="group flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <h2 className="font-[family-name:var(--font-display)] text-[15px] font-semibold text-foreground transition-colors group-hover:text-accent">
                {title}
              </h2>
              {loading && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                  <span className="spinner" />
                  {loadingLabel}
                </span>
              )}
            </span>
            {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
          </span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className={`ml-auto shrink-0 text-muted-foreground transition-all duration-200 group-hover:text-accent ${open ? "rotate-180" : ""}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>
      <div className={`collapsible-content ${open ? "open" : ""}`}>
        <div>
          <div className="border-t border-border px-5 py-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
