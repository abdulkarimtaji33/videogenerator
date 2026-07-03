import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import { THEME_INIT_SCRIPT } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "Shotcraft — AI Video Shot Generator",
  description: "Turn one idea into shot-ready images and video prompts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background text-foreground">
        <Header />
        {children}
      </body>
    </html>
  );
}
