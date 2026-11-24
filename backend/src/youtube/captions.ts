// SRT subtitle files built from the per-clip word timings written by the narration step
// (words-<clipId>.json, times relative to the start of each clip's narration audio).
import fs from "fs";
import path from "path";

export interface TimedWord {
  word: string;
  start: number;
  end: number;
}

/** hh:mm:ss,mmm */
export function srtTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

/** Groups words into cues of `wordsPerCue` words (a sentence end also closes a cue) and renders SRT. */
export function srtFromWords(words: TimedWord[], wordsPerCue = 6): string {
  const per = Math.max(1, Math.floor(wordsPerCue));
  const cues: string[] = [];
  let group: TimedWord[] = [];
  const flush = () => {
    if (!group.length) return;
    const start = group[0].start;
    // Never let a cue end before it starts, and keep it from overlapping the next word.
    const end = Math.max(group[group.length - 1].end, start + 0.2);
    cues.push(`${cues.length + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${group.map((w) => w.word.trim()).join(" ")}\n`);
    group = [];
  };
  for (const w of words) {
    if (!w.word || !w.word.trim()) continue;
    // A pause of more than a second, or a cue that would run past 6 s, starts a new cue.
    if (group.length && (w.start - group[group.length - 1].end > 1 || w.end - group[0].start > 6)) flush();
    group.push(w);
    if (group.length >= per || /[.!?]["')\]]*$/.test(w.word.trim())) flush();
  }
  flush();
  return cues.join("\n");
}

/**
 * Reads words-<clipId>.json for each clip (missing files are skipped) and offsets the times by the start of
 * the clip (the sum of the previous clips' lengths) plus the narration delay, exactly as shorts/assemble.ts does.
 */
export function srtFromWordFiles(workDir: string, clipIds: string[], clipSeconds: number[], delay: number): string {
  const words: TimedWord[] = [];
  let t = 0;
  clipIds.forEach((id, i) => {
    const file = path.join(workDir, `words-${id}.json`);
    if (fs.existsSync(file)) {
      try {
        const ws: TimedWord[] = JSON.parse(fs.readFileSync(file, "utf-8"));
        for (const w of ws) words.push({ word: w.word, start: w.start + t + delay, end: w.end + t + delay });
      } catch {
        // an unreadable word file only costs those captions
      }
    }
    t += clipSeconds[i] ?? 0;
  });
  return srtFromWords(words);
}
