// Edit styles. `default` is a port of the auto-video-edit skill's styles/default.md (grain 2-3%, vignette 12%, one accent,
// music -20 dB under voice, ducked); niche variants only shift the look.

import { GRAIN_PCT, VIGNETTE_PCT } from "./rules";
import type { EditStyle } from "./types";

const GOLD = "&H0000D7FF&"; // ASS colour (BGR): #FFD700, the accent used by the captions

export const DEFAULT_STYLE: EditStyle = {
  id: "default",
  label: "Clean creator",
  grade: { contrast: 1.04, saturation: 1.05, gamma: 1.0, warmth: 0 }, // light grade only (default.md)
  vignette: VIGNETTE_PCT, // §18
  grain: GRAIN_PCT[0] + 0.5, // §18 2-3%
  accent: GOLD,
  musicMood: "calm",
  musicGainDb: -18, // §11 about 0.126 linear, near the 0.14 guideline
  duckDb: 9, // §11 6-12 dB
};

export const STYLES: Record<string, EditStyle> = {
  default: DEFAULT_STYLE,
  space: { ...DEFAULT_STYLE, id: "space", label: "Space (cool, low grain)", grade: { contrast: 1.08, saturation: 1.08, gamma: 0.98, warmth: -0.35 }, grain: GRAIN_PCT[0] - 0.5, musicMood: "wonder", accent: "&H00FFD24D&" },
  history: { ...DEFAULT_STYLE, id: "history", label: "History (warm, more grain)", grade: { contrast: 1.05, saturation: 0.92, gamma: 1.02, warmth: 0.4 }, grain: GRAIN_PCT[1] + 0.8, musicMood: "dark", accent: "&H002FA5FF&" },
  mystery: { ...DEFAULT_STYLE, id: "mystery", label: "Mystery (dark, strong vignette)", grade: { contrast: 1.12, saturation: 0.88, gamma: 0.94, warmth: -0.15 }, vignette: 0.2, grain: GRAIN_PCT[1], musicMood: "tense", accent: "&H0000D7FF&" },
  explainer: { ...DEFAULT_STYLE, id: "explainer", label: "Explainer (clean)", grade: { contrast: 1.03, saturation: 1.1, gamma: 1.0, warmth: 0.05 }, grain: GRAIN_PCT[0] - 1, vignette: 0.08, musicMood: "upbeat" },
};

const NICHE_HINTS: [RegExp, string][] = [
  [/space|planet|astro|cosmos|science_curiosity|physics/i, "space"],
  [/histor|ancient|war|empire|biograph/i, "history"],
  [/mystery|crime|unsolved|paranormal|conspir|horror/i, "mystery"],
  [/explain|how|finance|tech|business|education/i, "explainer"],
];

/** Picks the edit style for a niche id/name; unknown niches get `default`. */
export function styleForNiche(niche: string | null | undefined): EditStyle {
  const n = String(niche || "");
  for (const [re, id] of NICHE_HINTS) if (re.test(n)) return STYLES[id];
  return DEFAULT_STYLE;
}
