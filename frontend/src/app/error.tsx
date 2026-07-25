"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
      <p className="mt-2 text-muted-foreground">
        This page hit an unexpected error. You can try again, or head back and start over.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center rounded-xl bg-accent px-5 text-[15px] font-semibold text-accent-foreground transition-opacity hover:opacity-90"
        >
          Try again
        </button>
        <a
          href="/"
          className="inline-flex h-11 items-center rounded-xl border border-border px-5 text-[15px] font-semibold text-foreground transition-colors hover:bg-surface-muted"
        >
          Go home
        </a>
      </div>
    </main>
  );
}
