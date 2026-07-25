import type { Metadata, Viewport } from "next";
import "./globals.css";
import Header from "@/components/Header";
import { THEME_INIT_SCRIPT } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: {
    default: "Shotcraft — AI Video Shot Generator",
    template: "%s",
  },
  description: "Turn one idea into a shot-ready story: an AI-written script, a consistent character, and shot-by-shot images and video prompts.",
  openGraph: {
    title: "Shotcraft — AI Video Shot Generator",
    description: "Turn one idea into a shot-ready story, automatically.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col bg-background text-foreground">
        <Header />
        <div className="flex-1">{children}</div>
        <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
          Shotcraft — AI Video Shot Generator
        </footer>
      </body>
    </html>
  );
}
