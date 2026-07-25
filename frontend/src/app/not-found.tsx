import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
      <p className="mt-2 text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link
        href="/"
        className="mt-6 inline-flex h-11 items-center rounded-xl bg-accent px-5 text-[15px] font-semibold text-accent-foreground transition-opacity hover:opacity-90"
      >
        Go home
      </Link>
    </main>
  );
}
