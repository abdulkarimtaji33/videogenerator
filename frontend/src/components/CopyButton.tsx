"use client";

import { useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";

export default function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 1500);
    } else {
      setFailed(true);
      setTimeout(() => setFailed(false), 1500);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : failed ? "Copy failed" : "Copy to clipboard"}
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all hover:bg-accent-soft active:scale-95 ${
        failed ? "text-danger" : "text-accent"
      } ${className}`}
    >
      {copied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          Copied
        </>
      ) : failed ? (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
          Couldn&apos;t copy
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}
