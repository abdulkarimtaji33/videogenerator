import { buildEditPlan } from "../src/edit/director";
import type { DirectorShot } from "../src/edit/director";

export function words(n = 14, start = 0.0, step = 0.42) {
  const text = "Saturn weighs ninety five times Earth but still floats because density decides everything here".split(" ");
  return Array.from({ length: n }, (_, i) => ({ word: text[i % text.length] + (i === n - 1 ? "." : ""), start: start + i * step, end: start + i * step + step - 0.05 }));
}

export function shortShots(roles = ["hook", "foreshadow", "body", "rehook", "body", "payoff", "loop"]): DirectorShot[] {
  return roles.map((r, i) => ({ shot_number: i + 1, beat_role: r, continues_previous: i > 0 && i % 2 === 0, voiceover: "Saturn floats on water.", duration_seconds: 8 }));
}

export function makeShort(roles?: string[], extra: Record<string, unknown> = {}) {
  const shots = shortShots(roles);
  return buildEditPlan({
    shots,
    words: shots.map(() => words()),
    format: "short",
    niche: "space_science_curiosity",
    tone: "wonder",
    facts: [{ claim: "Saturn is 95 times Earth mass", source: "NASA" }],
    pickMusic: () => ({ file: "x.mp3", mood: "wonder" }),
    ...extra,
  });
}
