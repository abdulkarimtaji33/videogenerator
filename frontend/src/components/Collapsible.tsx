"use client";

import { useState, type ReactNode } from "react";

export default function Collapsible({
  title,
  subtitle,
  defaultOpen = true,
  badge,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  defaultOpen?: boolean;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-surface-muted"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
            {title}
            {badge}
          </h2>
          {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div className={`collapsible-content ${open ? "open" : ""}`}>
        <div>
          <div className="border-t border-border px-5 py-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
