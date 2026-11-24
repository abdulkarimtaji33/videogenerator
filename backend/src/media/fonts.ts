import fs from "fs";
import path from "path";

/** Bold fonts per language, best first. Latin-only fonts (Arial Black) have no Arabic or Devanagari glyphs. */
const FONTS: Record<string, [string, string][]> = {
  ur: [
    ["C:/Windows/Fonts/urdtype.ttf", "Urdu Typesetting"],
    ["C:/Windows/Fonts/segoeuib.ttf", "Segoe UI"],
    ["C:/Windows/Fonts/tahomabd.ttf", "Tahoma"],
    ["C:/Windows/Fonts/arialbd.ttf", "Arial"],
  ],
  hi: [
    ["C:/Windows/Fonts/nirmalab.ttf", "Nirmala UI"],
    ["C:/Windows/Fonts/mangalb.ttf", "Mangal"],
    ["C:/Windows/Fonts/segoeuib.ttf", "Segoe UI"],
  ],
  en: [
    ["C:/Windows/Fonts/ariblk.ttf", "Arial Black"],
    ["C:/Windows/Fonts/arialbd.ttf", "Arial"],
    ["C:/Windows/Fonts/segoeuib.ttf", "Segoe UI"],
    ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "DejaVu Sans"],
    ["/Library/Fonts/Arial Bold.ttf", "Arial"],
  ],
};

/** Copies a bold system font for the language into <workDir>/fonts so ffmpeg filters can load it with a short relative path. */
export function ensureFont(workDir: string, language = "en"): { dir: string; file: string; name: string } {
  const dir = path.join(workDir, "fonts");
  fs.mkdirSync(dir, { recursive: true });
  const candidates = FONTS[language] ?? FONTS.en;
  for (const [file, name] of candidates) {
    if (fs.existsSync(file)) {
      const base = path.basename(file).replace(/\s+/g, "_");
      fs.copyFileSync(file, path.join(dir, base));
      return { dir, file: base, name };
    }
  }
  throw new Error("No bold system font found (looked for Arial Black, Arial Bold, Segoe UI Bold, DejaVu Sans Bold).");
}

/** Wraps text at roughly `width` characters per line, without breaking words. */
export function wrapText(text: string, width: number): string {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((cur + " " + w).trim().length > width && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}
