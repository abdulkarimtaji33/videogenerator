import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import { THEME_INIT_SCRIPT } from "@/components/ThemeToggle";

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display-family",
  display: "swap",
});

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
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0d0c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={displayFont.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-canvas-texture flex min-h-screen flex-col bg-background text-foreground">
        <Header />
        <div className="flex-1">{children}</div>
        <footer className="border-t border-border py-8 text-center text-xs tracking-wide text-muted-foreground">
          Shotcraft — AI Video Shot Generator
        </footer>
      </body>
    </html>
  );
}
