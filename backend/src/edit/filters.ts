// Pure builders for the FFmpeg filter graphs of the edit pass (no ffmpeg is run here, so they are unit-testable).
// assemble.ts feeds them the clip files and runs the result.

import {
  DUCK_ATTACK_MS,
  DUCK_RELEASE_MS,
  FPS,
  GRAIN_MAX,
  LRA,
  LOOP_CROSSFADE_S,
  LUFS_TARGET,
  MUSIC_FADE_IN_S,
  MUSIC_FADE_OUT_S,
  PUNCH_MAX,
  RISER_SILENCE_S,
  SFX_MIN_GAP_S,
  SFX_OFFSET_S,
  TRUE_PEAK_DB,
  VIGNETTE_ANGLE,
  VOICE_COMP_RATIO,
  VOICE_COMP_THRESHOLD_DB,
  VOICE_HIGHPASS_HZ,
} from "./rules";
import type { EditBeat, EditPlan, EditStyle, TransitionKind } from "./types";

export interface TimedWord {
  word: string;
  start: number;
  end: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------- timeline

export interface Timeline {
  starts: number[];
  ends: number[];
  /** Seconds the incoming clip overlaps the one before it (0 for a hard cut). */
  overlaps: number[];
  total: number;
}

/**
 * Where each clip lands on the FINAL timeline. A cross-fade overlaps the incoming clip with the end of the previous one,
 * so every transition shortens the film by its length: start[i] = start[i-1] + clip[i-1] - overlap[i].
 * A beat's `end` is the next beat's start (the overlap belongs to the incoming beat).
 */
export function computeTimeline(clipSeconds: number[], seams: { transitionIn: TransitionKind; transitionSeconds: number }[]): Timeline {
  const n = clipSeconds.length;
  const starts: number[] = [];
  const overlaps: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = seams[i];
    let o = 0;
    if (i > 0 && s && s.transitionIn !== "cut") o = Math.max(0, Math.min(s.transitionSeconds, 0.45 * clipSeconds[i - 1], 0.45 * clipSeconds[i]));
    o = r3(o);
    overlaps.push(o);
    starts.push(i === 0 ? 0 : r3(starts[i - 1] + clipSeconds[i - 1] - o));
  }
  const ends = starts.map((_, i) => (i < n - 1 ? starts[i + 1] : r3(starts[i] + clipSeconds[i])));
  return { starts, ends, overlaps, total: n ? ends[n - 1] : 0 };
}

// ---------------------------------------------------------------- narration placement (J/L cuts)

export interface NarrationPlacement {
  startSec: number;
  endSec: number;
}

const NARRATION_GAP_S = 0.06;

/**
 * One narration timeline instead of per-shot trims. Narration i starts at beat.start + delay + narrationOffset
 * (negative = J-cut, the voice leads the picture; positive = L-cut, it trails). It is never allowed to overlap the
 * narration before it: it is pushed later instead. `durations[i]` null = the shot has no narration.
 */
export function resolveNarration(starts: number[], offsets: number[], durations: (number | null)[], delay: number): (NarrationPlacement | null)[] {
  const out: (NarrationPlacement | null)[] = [];
  let prevEnd = 0;
  for (let i = 0; i < starts.length; i++) {
    const d = durations[i];
    if (d == null || d <= 0) {
      out.push(null);
      continue;
    }
    let s = Math.max(0, starts[i] + delay + (offsets[i] || 0));
    if (s < prevEnd + NARRATION_GAP_S && prevEnd > 0) s = prevEnd + NARRATION_GAP_S;
    s = r3(s);
    out.push({ startSec: s, endSec: r3(s + d) });
    prevEnd = s + d;
  }
  return out;
}

/** Word timings (relative to their narration file) moved onto the final timeline. */
export function shiftWords(words: TimedWord[], by: number): TimedWord[] {
  return words.map((w) => ({ word: w.word, start: r3(w.start + by), end: r3(w.end + by) }));
}

// ---------------------------------------------------------------- video graph

const XFADE: Record<TransitionKind, string> = { cut: "", fade: "fade", fadeblack: "fadeblack", zoomin: "zoomin", smoothleft: "smoothleft", dip: "fadewhite" };
export const xfadeName = (k: TransitionKind) => XFADE[k] || "fade";

/** Eased punch-in (smoothstep from 1 to `peak` over `seconds`, starting `at` seconds into the clip): scale then centre crop. */
export function punchFilter(beat: Pick<EditBeat, "punch"> & { punchAt?: number; punchSeconds?: number }, W: number, H: number): string {
  const peak = Math.min(PUNCH_MAX, Math.max(1, beat.punch || 1));
  if (peak <= 1.0005) return "";
  const at = r3(beat.punchAt ?? 0);
  const dur = r3(Math.max(0.1, beat.punchSeconds ?? 0.4));
  const p = `clip((t-${at})/${dur},0,1)`;
  const z = `(1+${r3(peak - 1)}*${p}*${p}*(3-2*${p}))`;
  return `scale=w='trunc(${W}*${z}/2)*2':h='trunc(${H}*${z}/2)*2':eval=frame:flags=bicubic,crop=${W}:${H}`;
}

export interface VideoGraph {
  graph: string;
  label: string;
  total: number;
  starts: number[];
  /** Number of xfade transitions in the chain. */
  transitions: number;
}

/**
 * Per-clip eased punch-ins, hard-cut runs joined with `concat`, and an `xfade` between runs at the offsets the timeline
 * says. Inputs are the prepared clip files in order ([i:v]).
 */
export function buildVideoGraph(beats: EditBeat[], clipSeconds: number[], W: number, H: number): VideoGraph {
  const tl = computeTimeline(clipSeconds, beats);
  const parts: string[] = [];
  beats.forEach((b, i) => {
    const pf = punchFilter(b, W, H);
    parts.push(`[${i}:v]fps=${FPS},setpts=PTS-STARTPTS${pf ? "," + pf : ""},format=yuv420p,setsar=1,settb=AVTB[c${i}]`);
  });
  // Scenes: runs of clips joined by hard cuts.
  const scenes: number[][] = [];
  beats.forEach((b, i) => {
    if (i === 0 || tl.overlaps[i] > 0) scenes.push([i]);
    else scenes[scenes.length - 1].push(i);
  });
  scenes.forEach((idx, j) => {
    if (idx.length === 1) parts.push(`[c${idx[0]}]null[s${j}]`);
    else parts.push(`${idx.map((i) => `[c${i}]`).join("")}concat=n=${idx.length}:v=1:a=0,settb=AVTB[s${j}]`);
  });
  let acc = "s0";
  for (let j = 1; j < scenes.length; j++) {
    const first = scenes[j][0];
    const out = j === scenes.length - 1 ? "vout" : `x${j}`;
    parts.push(`[${acc}][s${j}]xfade=transition=${xfadeName(beats[first].transitionIn)}:duration=${tl.overlaps[first]}:offset=${tl.starts[first]}[${out}]`);
    acc = out;
  }
  if (scenes.length === 1) parts.push(`[s0]null[vout]`);
  return { graph: parts.join(";"), label: "vout", total: tl.total, starts: tl.starts, transitions: scenes.length - 1 };
}

/** True when the video needs the filter graph at all (otherwise the clips can be joined with a stream copy). */
export const needsVideoGraph = (beats: EditBeat[]) => beats.some((b) => b.transitionIn !== "cut" || (b.punch || 1) > 1.0005);

// ---------------------------------------------------------------- audio graphs

/** Narration/ambience clips laid on one timeline with adelay + amix (normalize=0). Output label [out], exactly `total` long. */
export function timelineGraph(items: { input: number; startSec: number }[], total: number, outLabel = "out"): string {
  if (!items.length) return `anullsrc=r=48000:cl=stereo,atrim=0:${r3(total)}[${outLabel}]`;
  const parts = items.map((it, k) => {
    const ms = Math.max(0, Math.round(it.startSec * 1000));
    return `[${it.input}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[t${k}]`;
  });
  const tail = `atrim=0:${r3(total)},apad=whole_dur=${r3(total)}`;
  if (items.length === 1) parts.push(`[t0]${tail}[${outLabel}]`);
  else parts.push(`${items.map((_, k) => `[t${k}]`).join("")}amix=inputs=${items.length}:normalize=0:duration=longest,${tail}[${outLabel}]`);
  return parts.join(";");
}

/** Narration voice chain (research §11): high-pass 80 Hz, compressor 3:1 at -18 dB, de-esser. */
export const voiceChain = () =>
  `highpass=f=${VOICE_HIGHPASS_HZ},acompressor=threshold=${VOICE_COMP_THRESHOLD_DB}dB:ratio=${VOICE_COMP_RATIO}:attack=5:release=120,deesser=i=0.4:m=0.5:f=0.5`;

export interface SfxEvent {
  kind: string;
  at: number;
  gainDb: number;
  take: number;
}

/** All sound-effect events of the plan, in time order. */
export function sfxEvents(edit: Pick<EditPlan, "beats">): SfxEvent[] {
  return edit.beats.flatMap((b) => b.sfx.map((s) => ({ kind: s.kind, at: s.at, gainDb: s.gainDb, take: s.take }))).sort((a, b) => a.at - b.at);
}

/** Pairs of consecutive effects closer than SFX_MIN_GAP_S. A riser followed by its impact is one gesture and is exempt. */
export function sfxGapViolations(events: { kind: string; at: number }[]): [number, number][] {
  const s = [...events].sort((a, b) => a.at - b.at);
  const out: [number, number][] = [];
  for (let i = 1; i < s.length; i++) {
    if (s[i].at - s[i - 1].at < SFX_MIN_GAP_S - 1e-6 && !(s[i - 1].kind === "riser" && s[i].kind === "impact")) out.push([s[i - 1].at, s[i].at]);
  }
  return out;
}

/** Windows where the bed (music + ambience) drops to silence just before an impact (research §20: 1-3 frames of silence). */
export function dropoutWindows(edit: Pick<EditPlan, "beats">): { from: number; to: number }[] {
  return sfxEvents(edit)
    .filter((e) => e.kind === "impact")
    .map((e) => {
      const pic = e.at - SFX_OFFSET_S;
      return { from: r3(Math.max(0, pic - RISER_SILENCE_S)), to: r3(pic) };
    });
}

export interface MixInputs {
  ambient: number; // input index of the ambient bed (already on the final timeline)
  narration: number; // input index of the narration timeline, -1 for none
  music: number; // input index of the music file, -1 for none
  /** One entry per sound effect, with its input index. */
  sfx: { input: number; at: number; gainDb: number }[];
  total: number;
  ambientGain: number;
  musicGain: number;
  musicEntryAt: number;
  duckDb: number;
  dropouts: { from: number; to: number }[];
}

/** Level of the bed in dB, used to place sound effects 3-6 dB over it. */
export const bedDb = (musicGain: number | null, ambientGain: number) => 20 * Math.log10(Math.max(0.001, musicGain ?? ambientGain));

/** Sound-effect gains are written in the plan as dB over the bed; this turns them into the volume applied to the file. */
export const sfxVolumeDb = (gainDb: number, bed: number) => Math.round(Math.min(-3, Math.max(-40, bed + gainDb)) * 10) / 10;

/** Everything up to the pre-loudnorm mix label [mix]: bed, ducking under the voice chain, SFX over the top. */
export function editMixGraph(o: MixInputs): string {
  const T = r3(o.total);
  const parts: string[] = [];
  parts.push(`[${o.ambient}:a]volume=${o.ambientGain}[amb0]`);
  if (o.music >= 0) {
    const entry = Math.round(o.musicEntryAt * 1000);
    parts.push(
      `[${o.music}:a]atrim=0:${T},asetpts=N/SR/TB,volume=${o.musicGain}${entry > 0 ? `,adelay=${entry}|${entry}` : ""},afade=t=in:d=${MUSIC_FADE_IN_S},afade=t=out:st=${r3(Math.max(0, T - MUSIC_FADE_OUT_S))}:d=${MUSIC_FADE_OUT_S}[mus]`
    );
    parts.push(`[amb0][mus]amix=inputs=2:normalize=0:duration=first[bed0]`);
  } else {
    parts.push(`[amb0]anull[bed0]`);
  }
  const gate = o.dropouts.map((d) => `volume=0:enable='between(t,${d.from},${d.to})'`).join(",");
  parts.push(`[bed0]${gate || "anull"}[bed]`);
  const bed = bedDb(o.music >= 0 ? o.musicGain : null, o.ambientGain);
  const sfxLabels: string[] = [];
  o.sfx.forEach((s, k) => {
    const ms = Math.max(0, Math.round(s.at * 1000));
    parts.push(`[${s.input}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${sfxVolumeDb(s.gainDb, bed)}dB,adelay=${ms}|${ms}[sfx${k}]`);
    sfxLabels.push(`[sfx${k}]`);
  });
  const ratio = Math.max(2, Math.round(o.duckDb / 1.5));
  let top = "bed";
  if (o.narration >= 0) {
    parts.push(`[${o.narration}:a]${voiceChain()},asplit=2[n1][n2]`);
    parts.push(`[bed][n1]sidechaincompress=threshold=0.03:ratio=${ratio}:attack=${DUCK_ATTACK_MS}:release=${DUCK_RELEASE_MS}[ducked]`);
    top = "ducked";
    const ins = [`[${top}]`, "[n2]", ...sfxLabels];
    parts.push(`${ins.join("")}amix=inputs=${ins.length}:normalize=0:duration=first[mix]`);
  } else if (sfxLabels.length) {
    const ins = [`[${top}]`, ...sfxLabels];
    parts.push(`${ins.join("")}amix=inputs=${ins.length}:normalize=0:duration=first[mix]`);
  } else {
    parts.push(`[${top}]anull[mix]`);
  }
  return parts.join(";");
}

// The AAC encode after loudnorm raises peaks by up to about half a dB, so loudnorm aims 0.5 dB below the -1 dBTP limit (§11)
// to land at or under -1 in the finished file.
export const TRUE_PEAK_TARGET_DB = TRUE_PEAK_DB - 0.5;
export const loudnormFilter = (extra = "") => `loudnorm=I=${LUFS_TARGET}:TP=${TRUE_PEAK_TARGET_DB}:LRA=${LRA}${extra}`;

// ---------------------------------------------------------------- finishing chain (loop, captions, grade, texture)

export interface FinishOptions {
  total: number;
  style: EditStyle;
  /** ASS file name relative to the work dir; null for no captions. */
  captions: string | null;
  loop: boolean;
}

/** From [0:v] to [v]: loop cross-fade, captions, grade, vignette, grain. The texture is last, as the research prescribes. */
export function finishVideoGraph(o: FinishOptions): string {
  const { style } = o;
  const parts: string[] = [];
  let cur = "0:v";
  const step = (graph: string, out: string) => {
    parts.push(graph.replace("IN", `[${cur}]`) + `[${out}]`);
    cur = out;
  };
  if (o.loop && o.total > LOOP_CROSSFADE_S * 2) {
    const L = LOOP_CROSSFADE_S;
    parts.push(`[0:v]split=2[lm][lf]`);
    parts.push(`[lf]trim=end_frame=1,loop=loop=-1:size=1,setpts=N/FRAME_RATE/TB,fade=t=in:st=${r3(o.total - L)}:d=${L}:alpha=1,format=yuva420p[lff]`);
    parts.push(`[lm]format=yuv420p[lmm]`);
    parts.push(`[lmm][lff]overlay=shortest=1:format=auto,format=yuv420p[loop]`);
    cur = "loop";
  }
  if (o.captions) step(`IN` + `ass=${o.captions}:fontsdir=fonts`, "cap");
  const g = style.grade;
  const warm = r3(g.warmth * 0.08);
  step(`INeq=contrast=${g.contrast}:saturation=${g.saturation}:gamma=${g.gamma},colorbalance=rm=${warm}:bm=${-warm}:rh=${r3(warm / 2)}:bh=${r3(-warm / 2)},format=yuv420p`, "grd");
  if (style.vignette > 0) {
    parts.push(`[${cur}]split=2[vg0][vg1]`);
    parts.push(`[vg1]vignette=angle=${VIGNETTE_ANGLE}[vg2]`);
    parts.push(`[vg0][vg2]blend=all_mode=normal:all_opacity=${r3(Math.min(1, style.vignette))},format=yuv420p[vgn]`);
    cur = "vgn";
  }
  const grain = Math.min(GRAIN_MAX, Math.max(0, style.grain));
  if (grain > 0) step(`INnoise=alls=${r3(grain)}:allf=t,format=yuv420p`, "v");
  else step(`INnull`, "v");
  return parts.join(";");
}

/** Output flags for bt709 colour tags (research §22). */
export const COLOR_TAG_ARGS = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
