// Deterministic edit director: turns the script's beat roles, word timings and facts into an EditPlan (no LLM).
// Rules come from rules.ts (every number carries its research section there).

import { chunkWords, keyNorm } from "../shorts/captions";
import { pickMusic as libPickMusic } from "./audioLib";
import { computeTimeline, resolveNarration } from "./filters";
import type { TimedWord } from "./filters";
import {
  CAPTION_BOTTOM_MAX_Y,
  CAPTION_WORDS_PER_GROUP,
  END_CARD_S,
  HOOK_PUNCH,
  HOOK_PUNCH_S,
  INNER_PUNCH_AFTER_S,
  INNER_PUNCH_AT_S,
  J_CUT_S,
  L_CUT_S,
  MAX_TRANSITION_SHARE,
  MIN_TRANSITIONS_WHEN_FOUR_SHOTS,
  MUSIC_MIN_VIDEO_S,
  PUNCH_LEVELS,
  PUNCH_RAMP_S,
  RISER_S,
  RISER_SILENCE_S,
  SFX_MIN_GAP_S,
  SFX_OFFSET_S,
  SFX_PRIORITY,
  SFX_TAKES,
  TRANSITION_S,
} from "./rules";
import { styleForNiche } from "./styles";
import type { EditBeat, EditLayout, EditPlan, EditStyle, SfxKind, TransitionKind } from "./types";

export interface DirectorShot {
  shot_number?: number;
  index?: number;
  beat_role?: string | null;
  role?: string | null;
  continues_previous?: boolean | number | null;
  continuesPrevious?: boolean;
  voiceover?: string | null;
  narration?: string | null;
  beat_index?: number | null;
  duration_seconds?: number | null;
}

export interface DirectorInput {
  shots: DirectorShot[];
  /** Word timings per shot, relative to the start of that shot's narration file. */
  words: TimedWord[][];
  format: "short" | "long";
  niche?: string | null;
  facts?: { claim: string; source?: string }[];
  tone?: string | null;
  /** Clip length per shot (or one length for all). Default: the shot's duration_seconds, else 8. */
  clipSeconds?: number | number[];
  narrationDelay?: number;
  /** Test hook: replaces the audio library lookup. */
  pickMusic?: (mood: string) => { file: string; mood: string } | null;
  style?: EditStyle;
}

const ROLES = new Set(["hook", "foreshadow", "body", "rehook", "side_story", "payoff", "loop", "bridge"]);
const STOP = new Set(
  "the a an and or but of to in on at is are was were be been it its this that these those with for as by from than then so if not no do does did has have had will would can could just very into about over under more most also still even only".split(" ")
);

/** Longest content word (or a number) of each caption group, normalised with keyNorm; "" when a group has none. */
export function pickKeywordWords(words: TimedWord[], per = CAPTION_WORDS_PER_GROUP): string[] {
  return chunkWords(words, per).map((chunk) => {
    const cands = chunk.map((w) => ({ w, k: keyNorm(w.word) })).filter((c) => c.k && !STOP.has(c.k));
    const num = cands.find((c) => /\d/.test(c.k));
    if (num) return num.k;
    const best = cands.filter((c) => c.k.length >= 4).sort((a, b) => b.k.length - a.k.length)[0];
    return best ? best.k : "";
  });
}

export function moodForTone(tone: string | null | undefined, style: EditStyle): EditStyle["musicMood"] {
  const t = String(tone || "").toLowerCase();
  if (/dark|ominous|grim|eerie|creep/.test(t)) return "dark";
  if (/tense|suspense|mystery|thrill|urgent|unsettl/.test(t)) return "tense";
  if (/wonder|awe|curious|cosmic|inspir/.test(t)) return "wonder";
  if (/fun|upbeat|energ|playful|light|humor/.test(t)) return "upbeat";
  if (/calm|sooth|relax|gentle|warm/.test(t)) return "calm";
  return style.musicMood;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const flag = (v: unknown) => v === true || v === 1 || v === "1";

export function buildEditPlan(inp: DirectorInput): EditPlan {
  const n = inp.shots.length;
  const style = inp.style ?? styleForNiche(inp.niche);
  const long = inp.format === "long";
  const delay = inp.narrationDelay ?? 0.25;
  const secs = inp.shots.map((s, i) => {
    const c = Array.isArray(inp.clipSeconds) ? inp.clipSeconds[i] : inp.clipSeconds;
    return Math.min(8, Math.max(2, Number(c ?? s.duration_seconds) || 8));
  });
  const roles = inp.shots.map((s, i) => {
    const r = String(s.beat_role ?? s.role ?? "body");
    return (i === 0 ? "hook" : ROLES.has(r) ? r : "body") as EditBeat["role"];
  });
  const cont = inp.shots.map((s, i) => i > 0 && flag(s.continues_previous ?? s.continuesPrevious));
  const beatIdx = inp.shots.map((s) => Number(s.beat_index) || 0);
  const wordsOf = (i: number) => inp.words[i] || [];

  // ---- transitions: hard cuts by default, visible ones only where the topic changes (§02)
  const kind: TransitionKind[] = new Array(n).fill("cut");
  const prio: number[] = new Array(n).fill(0);
  const chapterAt = new Set<number>();
  for (let i = 1; i < n; i++) {
    if (roles[i] === "payoff") continue; // the impact lands on a clean cut
    if (long && beatIdx[i] && beatIdx[i] !== beatIdx[i - 1]) {
      kind[i] = "smoothleft";
      prio[i] = 4;
      chapterAt.add(i);
    } else if (roles[i] === "rehook") {
      kind[i] = "zoomin";
      prio[i] = 3;
    } else if (roles[i] === "side_story") {
      kind[i] = "fade";
      prio[i] = 3;
    } else if (roles[i] === "bridge") {
      kind[i] = "fade";
      prio[i] = 2;
    }
  }
  const seams = Math.max(0, n - 1);
  const cap = Math.max(MIN_TRANSITIONS_WHEN_FOUR_SHOTS * (n >= 4 ? 1 : 0), Math.floor(seams * MAX_TRANSITION_SHARE));
  const visible = () => kind.map((k, i) => (k !== "cut" ? i : -1)).filter((i) => i >= 0);
  while (visible().length > cap) {
    const worst = visible().sort((a, b) => prio[a] - prio[b] || b - a)[0];
    kind[worst] = "cut";
  }
  // Too few visible transitions on a 4+ shot film: promote body seams (never into the hook or payoff), spread apart.
  if (n >= 4) {
    const want = Math.min(MIN_TRANSITIONS_WHEN_FOUR_SHOTS, cap);
    const cands = [] as number[];
    for (let i = 2; i < n; i++) if (kind[i] === "cut" && roles[i] !== "payoff" && roles[i] !== "hook" && roles[i - 1] !== "payoff") cands.push(i);
    while (visible().length < want && cands.length) {
      const have = visible();
      cands.sort((a, b) => Math.min(...[99, ...have.map((h) => Math.abs(h - b))]) - Math.min(...[99, ...have.map((h) => Math.abs(h - a))]));
      const pick = cands.shift()!;
      kind[pick] = visible().length % 2 === 0 ? "fade" : "zoomin";
    }
  }
  const seam = kind.map((k) => ({ transitionIn: k, transitionSeconds: k === "cut" ? 0 : TRANSITION_S }));
  const tl = computeTimeline(secs, seam);

  // ---- punch-ins: alternate 1.0 / 1.12 / 1.0 / 1.2, never the same twice (§09)
  const punch: number[] = [];
  const punchAt: number[] = new Array(n).fill(0);
  const punchSec: number[] = new Array(n).fill(PUNCH_RAMP_S);
  let k = 2;
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      punch.push(HOOK_PUNCH);
      punchSec[0] = HOOK_PUNCH_S;
      continue;
    }
    let p: number = PUNCH_LEVELS[k++ % PUNCH_LEVELS.length];
    if (p === punch[i - 1]) p = p === 1 ? 1.12 : 1;
    punch.push(p);
  }
  for (let i = 0; i < n; i++) {
    if (secs[i] > INNER_PUNCH_AFTER_S && punch[i] === 1) {
      // Nothing may sit unchanged for long: an inner punch at about 4 s, a level that differs from both neighbours.
      const opts = [1.12, 1.2].filter((p) => p !== punch[i - 1] && p !== punch[i + 1]);
      punch[i] = opts[0] ?? (punch[i - 1] === 1.12 ? 1.2 : 1.12);
      punchAt[i] = INNER_PUNCH_AT_S;
    }
  }
  for (let i = 1; i < n; i++) if (punch[i] > 1 && punch[i] === punch[i - 1]) punch[i] = punch[i] === 1.12 ? 1.2 : 1.12;

  // ---- narration offsets: J-cut on continuing shots, L-cut on the payoff (§01)
  const dur = inp.shots.map((s, i) => {
    const w = wordsOf(i);
    if (w.length) return w[w.length - 1].end;
    const text = String(s.voiceover ?? s.narration ?? "").trim();
    return text ? text.split(/\s+/).length * 0.4 : null;
  });
  const offsets = inp.shots.map((_, i) => (cont[i] ? -J_CUT_S : roles[i] === "payoff" && i < n - 1 ? L_CUT_S : 0));
  let place = resolveNarration(tl.starts, offsets, dur, delay);
  for (let i = 0; i < n; i++) {
    const p = place[i];
    if (p && p.endSec > tl.total) {
      offsets[i] = Math.min(0, offsets[i]);
      place = resolveNarration(tl.starts, offsets, dur, delay);
    }
  }
  place.forEach((p, i) => {
    if (p) offsets[i] = r3(p.startSec - (tl.starts[i] + delay)); // record any push the overlap guard made
  });

  // ---- keywords and stat numbers
  const factText = (inp.facts || []).map((f) => f.claim).join(" ");
  const keyword: string[] = [];
  const keywordAt: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    const w = wordsOf(i);
    const keys = pickKeywordWords(w).filter(Boolean);
    const kw = keys.find((x) => /\d/.test(x)) || keys.sort((a, b) => b.length - a.length)[0] || "";
    keyword.push(kw);
    const hit = kw ? w.find((x) => keyNorm(x.word) === kw) : undefined;
    keywordAt.push(hit && place[i] ? r3(place[i]!.startSec + hit.start) : null);
  }

  // ---- layouts and cards
  const beats: EditBeat[] = [];
  const payoffIdx = roles.indexOf("payoff") >= 0 ? roles.indexOf("payoff") : n >= 3 ? n - 2 : -1;
  const chapters: { at: number; title: string }[] = [];
  for (let i = 0; i < n; i++) {
    let layout: EditLayout = punch[i] > 1 && !punchAt[i] ? "punch" : "full";
    if (roles[i] === "rehook") layout = "keyword";
    let card: EditBeat["card"];
    if (long && (i === 0 || chapterAt.has(i))) {
      const words = String(inp.shots[i].voiceover ?? inp.shots[i].narration ?? "").split(/\s+/).filter(Boolean).slice(0, 5).join(" ").replace(/[.,;:!?]+$/, "");
      const title = i === 0 ? "Intro" : words || `Part ${chapters.length + 1}`;
      chapters.push({ at: tl.starts[i], title });
      if (i > 0) card = { type: "chapter", text: title, at: tl.starts[i] + 0.2, seconds: 2.5 };
    }
    if (i === payoffIdx) {
      const num = keyword[i] && /\d/.test(keyword[i]) && factText.toLowerCase().replace(/[^a-z0-9. ]/g, "").includes(keyword[i]) ? keyword[i] : "";
      if (num) {
        card = { type: "stat", text: num, at: tl.starts[i] + 0.4, seconds: 2.5 };
        layout = "graphic";
      }
    }
    beats.push({
      shotId: `shot-${inp.shots[i].shot_number ?? inp.shots[i].index ?? i + 1}`,
      index: i + 1,
      start: tl.starts[i],
      end: tl.ends[i],
      role: roles[i],
      layout,
      punch: punch[i],
      punchAt: punchAt[i] || undefined,
      punchSeconds: punch[i] > 1 ? punchSec[i] : undefined,
      transitionIn: kind[i],
      transitionSeconds: seam[i].transitionSeconds,
      sfx: [],
      keyword: keyword[i] || undefined,
      card,
      narrationOffset: offsets[i],
    });
  }

  // ---- sound effects: a budget of one per 3 s, impact > riser > whoosh > pop (§20)
  type Cand = { kind: SfxKind; at: number; gainDb: number };
  const cands: Cand[] = [];
  if (payoffIdx >= 0) {
    const pic = tl.starts[payoffIdx];
    cands.push({ kind: "impact", at: r3(pic + SFX_OFFSET_S), gainDb: 6 });
    const riserAt = r3(pic - RISER_SILENCE_S - RISER_S);
    if (riserAt >= 0.5) cands.push({ kind: "riser", at: riserAt, gainDb: 5 });
  }
  for (let i = 1; i < n; i++) if (kind[i] !== "cut") cands.push({ kind: "whoosh", at: r3(tl.starts[i] + SFX_OFFSET_S), gainDb: 4 });
  for (let i = 0; i < n; i++) if (keywordAt[i] != null && /\d/.test(keyword[i])) cands.push({ kind: "pop", at: r3(keywordAt[i]! + SFX_OFFSET_S), gainDb: 3 });
  const kept: Cand[] = [];
  const clash = (c: Cand) =>
    kept.some((o) => {
      const gap = Math.abs(o.at - c.at);
      const pair = (o.kind === "riser" && c.kind === "impact") || (o.kind === "impact" && c.kind === "riser");
      return gap < SFX_MIN_GAP_S - 1e-6 && !pair;
    });
  for (const c of cands.sort((a, b) => SFX_PRIORITY[b.kind] - SFX_PRIORITY[a.kind] || a.at - b.at)) {
    if (c.kind === "riser" && !kept.some((o) => o.kind === "impact")) continue;
    if (!clash(c) && c.at < tl.total) kept.push(c);
  }
  const used: Record<string, number> = {};
  const last: Record<string, number> = {};
  for (const c of kept.sort((a, b) => a.at - b.at)) {
    let take = (used[c.kind] = (used[c.kind] ?? -1) + 1) % SFX_TAKES;
    if (take === last[c.kind]) take = (take + 1) % SFX_TAKES;
    last[c.kind] = take;
    const owner = beats.find((b) => c.at >= b.start && c.at < b.end) ?? beats[beats.length - 1];
    owner.sfx.push({ kind: c.kind, at: c.at, gainDb: c.gainDb, take });
  }

  // ---- music, loop, end card
  const mood = moodForTone(inp.tone, style);
  const song = tlTotalOk(tl.total) ? (inp.pickMusic ?? ((m: string) => libPickMusic(m, 0)))(mood) : null;
  const music: EditPlan["music"] = tlTotalOk(tl.total) ? { file: song?.file ?? null, mood, gain: r3(Math.pow(10, style.musicGainDb / 20)), entryAt: 0 } : null;
  let endCard: EditPlan["endCard"] = null;
  if (long && tl.total > END_CARD_S[1] * 2) {
    endCard = { seconds: END_CARD_S[0] + 2, text: "Watch the next video" };
    const lastBeat = beats[n - 1];
    lastBeat.layout = "end_card";
    lastBeat.card = { type: "end", text: endCard.text, at: Math.max(lastBeat.start, tl.total - endCard.seconds), seconds: Math.min(endCard.seconds, lastBeat.end - lastBeat.start) };
  }
  return {
    version: 1,
    style,
    format: inp.format,
    totalSeconds: tl.total,
    beats,
    music,
    loop: !long,
    endCard,
    chapters,
    transitionKinds: [...new Set(kind.filter((x) => x !== "cut"))],
    captionBottomY: CAPTION_BOTTOM_MAX_Y,
    narrationDelay: delay,
  };
}

const tlTotalOk = (total: number) => total >= MUSIC_MIN_VIDEO_S;
