// Audio library: music beds by mood and sound effects by kind, read from backend/assets/audio.
//   music/<mood>/*.mp3      sfx/<kind>/*.wav
// Every function returns null (never throws) when a folder is missing or empty, so an edit without the pack still runs.

import fs from "fs";
import path from "path";
import type { SfxKind } from "./types";

export const AUDIO_DIR = process.env.AUDIO_LIB_DIR || path.resolve(__dirname, "../../assets/audio");

const musicTurn = new Map<string, number>();

function list(dir: string, ext: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(ext))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** All takes of one sound effect, sorted by name (so a take number always means the same file). */
export function sfxTakes(kind: SfxKind, root = AUDIO_DIR): string[] {
  return list(path.join(root, "sfx", kind), ".wav");
}

/** A music bed for a mood. With a seed the choice is deterministic; without, beds rotate between calls. */
export function pickMusic(mood: string, seed?: number, root = AUDIO_DIR): { file: string; mood: string } | null {
  const files = list(path.join(root, "music", mood), ".mp3");
  if (!files.length) return null;
  let i = seed;
  if (i === undefined) {
    i = musicTurn.get(mood) ?? 0;
    musicTurn.set(mood, i + 1);
  }
  return { file: files[Math.abs(Math.floor(i)) % files.length], mood };
}

/** A sound effect take, rotating through the available takes and skipping `avoidTake` (the one used last). */
export function pickSfx(kind: SfxKind, avoidTake?: number, root = AUDIO_DIR): { file: string; take: number } | null {
  const files = sfxTakes(kind, root);
  if (!files.length) return null;
  const start = avoidTake === undefined ? 0 : avoidTake + 1;
  const take = files.length > 1 ? start % files.length : 0;
  return { file: files[take], take };
}

/** The file for a take number written into an EditPlan (wraps around when fewer takes exist). Null when none exist. */
export function sfxFile(kind: SfxKind, take: number, root = AUDIO_DIR): string | null {
  const files = sfxTakes(kind, root);
  return files.length ? files[Math.abs(Math.floor(take)) % files.length] : null;
}
