import Link from "next/link";
import ThemeToggle from "./ThemeToggle";

export default function Header() {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground transition-transform group-hover:-rotate-3">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
          <span className="font-[family-name:var(--font-display)] text-[17px] font-semibold tracking-tight text-foreground">
            Shotcraft
          </span>
        </Link>
        <nav className="hidden items-center gap-1 text-sm md:flex" aria-label="Studio">
          {[
            ["/studio", "Studio"],
            ["/hooks", "Hooks"],
            ["/channels", "Channels"],
            ["/topics", "Topics"],
            ["/review", "Review"],
            ["/analytics", "Analytics"],
            ["/settings", "Settings"],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground">
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="hidden items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-accent hover:text-accent sm:flex"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New project
          </Link>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
