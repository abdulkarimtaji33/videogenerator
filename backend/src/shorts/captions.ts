// Builds an ASS subtitle file with word-by-word highlighting (the active word is gold) for burning into
// a 1080x1920 video. Captions sit above the bottom Shorts interface area.

import type { Word } from "./tts";

export interface CaptionOptions {
  wordsPerChunk: number;
  fontSize: number;
  marginBottom: number;
  /** Canvas size the font and margin are relative to. Default 1080x1920. */
  width?: number;
  height?: number;
  /** Words (normalised with keyNorm) to colour in the accent: ONE per caption group, the first match. Replaces the moving gold highlight. */
  keywords?: Set<string>;
  /** ASS colour of the keyword accent (default gold). */
  accent?: string;
}

/** Normal form used to match keywords: lower case letters and digits only. */
export const keyNorm = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Index of the one keyword of a caption group, or -1. */
function keywordIndex(chunk: Word[], o: { keywords?: Set<string> }): number {
  if (!o.keywords || !o.keywords.size) return -1;
  return chunk.findIndex((w) => o.keywords!.has(keyNorm(w.word)));
}

/** Highest allowed caption bottom edge on a portrait canvas, as a share of its height (research section 04: y <= 1248 of 1920). */
export const CAPTION_BOTTOM_MAX_Y = 1248;

const GOLD = "&H0000D7FF&";
const WHITE = "&H00FFFFFF&";

function ts(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s - h * 3600 - m * 60;
  const whole = Math.floor(rest);
  let cs = Math.round((rest - whole) * 100);
  let sec2 = whole;
  if (cs === 100) {
    cs = 0;
    sec2 += 1;
  }
  return `${h}:${String(m).padStart(2, "0")}:${String(sec2).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

const esc = (t: string) => t.replace(/\\/g, "").replace(/[{}]/g, "").toUpperCase();

const textWidth = (words: Word[]) => words.reduce((n, w) => n + w.word.length, 0) + Math.max(0, words.length - 1);

/**
 * Groups words into caption chunks: up to `per` words, ending at a sentence end or a pause. With `maxChars`, a chunk
 * is also closed before it would be too wide for one line (a single long word is still allowed on its own).
 */
export function chunkWords(words: Word[], per: number, maxChars?: number): Word[][] {
  const chunks: Word[][] = [];
  let cur: Word[] = [];
  words.forEach((w, i) => {
    if (maxChars && cur.length && textWidth([...cur, w]) > maxChars) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(w);
    const next = words[i + 1];
    const endsSentence = /[.!?]$/.test(w.word);
    const pause = next ? next.start - w.end > 0.5 : true;
    if (cur.length >= per || endsSentence || pause) {
      chunks.push(cur);
      cur = [];
    }
  });
  if (cur.length) chunks.push(cur);
  return chunks;
}

// Arial Black capitals average about 0.8 em per character. A chunk must fit one line between the side margins.
const CHAR_EM = 0.8;
const SIDE_MARGINS = 70;
const MIN_FONT_FRACTION = 0.85;

/** Most characters one line can hold at the smallest font size a chunk may shrink to. */
export function maxCharsPerLine(width: number, fontSize: number): number {
  return Math.floor((width - 2 * SIDE_MARGINS) / (fontSize * MIN_FONT_FRACTION * CHAR_EM));
}

/** Font size that makes the chunk fit one line (never larger than the configured size, never below 85% of it). */
export function fitFontSize(width: number, fontSize: number, chars: number): number {
  const fit = Math.floor((width - 2 * SIDE_MARGINS) / (Math.max(1, chars) * CHAR_EM));
  return Math.max(Math.round(fontSize * MIN_FONT_FRACTION), Math.min(fontSize, fit));
}

/**
 * Animated caption styles (all done with ASS override tags, so no extra software is needed):
 *  - classic: three words on screen, the spoken word turns gold (the original look)
 *  - pop:     words appear one by one with a springy pop-in; the newest word is gold, earlier ones white
 *  - karaoke: the three words are visible and a gold fill sweeps through each word as it is spoken
 *  - slam:    one big word at a time that slams in from large with a blur and settles
 */
export type CaptionStyle = "classic" | "pop" | "karaoke" | "slam";
export const CAPTION_STYLES: CaptionStyle[] = ["classic", "pop", "karaoke", "slam"];

const ms = (sec: number) => Math.max(0, Math.round(sec * 1000));

/**
 * Pins every caption to one exact spot (bottom-centre, `marginBottom` above the bottom edge). A caption with an
 * explicit position is never pushed aside by the renderer. Without it, a caption that starts while another is still
 * showing (even for one frame) is moved up a line and then drops back down: the "jumping up and down" bug.
 */
export function captionY(o: Pick<CaptionOptions, "width" | "height" | "marginBottom">): number {
  const W = o.width ?? 1080;
  const H = o.height ?? 1920;
  let y = H - o.marginBottom;
  // Portrait: the caption bottom edge is never lower than 65% of the height (y 1248 on 1920), clear of every platform UI.
  if (H > W) y = Math.min(y, Math.round((H * CAPTION_BOTTOM_MAX_Y) / 1920));
  return y;
}

function fixedPos(o: CaptionOptions): string {
  return `{\\an2\\pos(${Math.round((o.width ?? 1080) / 2)},${captionY(o)})}`;
}

function popEvent(chunk: Word[], limit = Infinity, o: CaptionOptions = { wordsPerChunk: 3, fontSize: 92, marginBottom: 0 }): string {
  const t0 = chunk[0].start;
  const kw = keywordIndex(chunk, o);
  const text = chunk
    .map((w, j) => {
      const a = ms(w.start - t0);
      const b = ms((chunk[j + 1]?.start ?? w.end) - t0);
      // Invisible and small until its moment, then it pops in (overshoot, settle) and turns white once the next word starts.
      const col = j === kw ? o.accent ?? GOLD : GOLD;
      const back = j === kw ? "" : `\\t(${b},${b + 1},\\1c${WHITE})`;
      return `{\\alpha&HFF&\\fscx55\\fscy55\\1c${WHITE}\\t(${a},${a + 1},\\alpha&H00&\\1c${col})\\t(${a},${a + 110},\\fscx122\\fscy122)\\t(${a + 110},${a + 230},\\fscx100\\fscy100)${back}}${esc(w.word)}`;
    })
    .join(" ");
  const end = Math.min(chunk[chunk.length - 1].end + 0.25, limit);
  return `Dialogue: 0,${ts(t0)},${ts(end)},Cap,,0,0,0,,${text}`;
}

function karaokeEvent(chunk: Word[], limit = Infinity, o: CaptionOptions = { wordsPerChunk: 3, fontSize: 92, marginBottom: 0 }): string {
  const t0 = chunk[0].start;
  const kw = keywordIndex(chunk, o);
  const end = Math.min(chunk[chunk.length - 1].end + 0.2, limit);
  // \kf sweeps the fill from SecondaryColour (white) to PrimaryColour (gold) over the word's duration.
  const text = chunk
    .map((w, j) => {
      const until = chunk[j + 1]?.start ?? w.end;
      const cs = Math.max(1, Math.round((until - w.start) * 100));
      return `{${j === kw ? `\\1c${o.accent ?? GOLD}` : ""}\\kf${cs}}${esc(w.word)}`;
    })
    .join(" ");
  return `Dialogue: 0,${ts(t0)},${ts(end)},Karaoke,,0,0,0,,{\\fad(80,60)}${text}`;
}

function slamEvents(chunk: Word[], limit = Infinity, o: CaptionOptions = { wordsPerChunk: 3, fontSize: 92, marginBottom: 0 }): string[] {
  return chunk.map((w, j) => {
    const start = w.start;
    const end = Math.min(Math.max(chunk[j + 1]?.start ?? w.end + 0.15, start + 0.12), limit);
    return `Dialogue: 0,${ts(start)},${ts(end)},Slam,,0,0,0,,{${o.keywords?.has(keyNorm(w.word)) ? `\\1c${o.accent ?? GOLD}` : ""}\\fscx170\\fscy170\\blur7\\alpha&H80&\\t(0,130,\\fscx100\\fscy100\\blur0\\alpha&H00&)}${esc(w.word)}`;
  });
}

export function buildAss(words: Word[], o: CaptionOptions & { style?: CaptionStyle }): string {
  const style = o.style ?? "classic";
  if (style !== "classic") return buildAnimatedAss(words, o, style);
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${o.width ?? 1080}`,
    `PlayResY: ${o.height ?? 1920}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,Arial Black,${o.fontSize},${WHITE},&H000000FF,&H00000000,&H78000000,0,0,0,0,100,100,0,0,1,8,3,2,70,70,${o.marginBottom},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events: string[] = [];
  const W = o.width ?? 1080;
  const chunks = chunkWords(words, o.wordsPerChunk, maxCharsPerLine(W, o.fontSize));
  chunks.forEach((chunk, ci) => {
    // One caption per group of words; the spoken word turns gold INSIDE it (colour changes at word times), so the
    // text never redraws and cannot move. It is gone before the next caption starts.
    const limit = chunks[ci + 1]?.[0].start ?? Infinity;
    const t0 = chunk[0].start;
    const end = Math.min(chunk[chunk.length - 1].end + 0.18, limit);
    if (end <= t0) return;
    const fs = fitFontSize(W, o.fontSize, textWidth(chunk));
    const size = fs < o.fontSize ? `{\\fs${fs}}` : "";
    const kw = keywordIndex(chunk, o);
    const text = chunk
      .map((w, j) => {
        // With keywords: one accent word per group, no moving highlight and no bounce.
        if (o.keywords && o.keywords.size) return `{\\1c${j === kw ? o.accent ?? GOLD : WHITE}}${esc(w.word)}`;
        const a = ms(w.start - t0);
        const b = ms((chunk[j + 1]?.start ?? w.end) - t0);
        return `{\\1c${WHITE}\\t(${a},${a + 1},\\1c${GOLD})\\t(${b},${b + 1},\\1c${WHITE})}${esc(w.word)}`;
      })
      .join(" ");
    events.push(`Dialogue: 0,${ts(t0)},${ts(end)},Cap,,0,0,0,,${fixedPos(o)}${size}${text}`);
  });
  return [...header, ...events, ""].join("\n");
}

function buildAnimatedAss(words: Word[], o: CaptionOptions, style: Exclude<CaptionStyle, "classic">): string {
  const W = o.width ?? 1080;
  const H = o.height ?? 1920;
  const common = `0,0,0,0,100,100,0,0,1`;
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,Arial Black,${o.fontSize},${WHITE},&H000000FF,&H00000000,&H78000000,${common},8,3,2,70,70,${o.marginBottom},1`,
    // Karaoke: unspoken text is SecondaryColour (white), the sweep turns it PrimaryColour (gold).
    `Style: Karaoke,Arial Black,${o.fontSize},${GOLD},${WHITE},&H00000000,&H78000000,${common},8,3,2,70,70,${o.marginBottom},1`,
    // Slam: one big word, a little larger than the others, gold.
    `Style: Slam,Arial Black,${Math.round(o.fontSize * 1.35)},${GOLD},&H000000FF,&H00000000,&H78000000,${common},10,3,2,70,70,${o.marginBottom},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  // Slam shows one word at a time; the others show up to three.
  const per = style === "slam" ? 1 : o.wordsPerChunk;
  const events: string[] = [];
  const chunks = chunkWords(words, per, style === "slam" ? undefined : maxCharsPerLine(W, o.fontSize));
  chunks.forEach((chunk, ci) => {
    const limit = chunks[ci + 1]?.[0].start ?? Infinity;
    const made = style === "pop" ? [popEvent(chunk, limit, o)] : style === "karaoke" ? [karaokeEvent(chunk, limit, o)] : slamEvents(chunk, limit, o);
    // Every caption gets the same fixed position (see fixedPos).
    for (const line of made) events.push(line.replace(/^(Dialogue: (?:[^,]*,){9})/, `$1${fixedPos(o)}`));
  });
  return [...header, ...events, ""].join("\n");
}
