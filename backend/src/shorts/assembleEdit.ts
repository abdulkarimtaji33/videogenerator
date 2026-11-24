// The edit-mode tail of buildShort: runs when plan.edit exists. Clips, ambience and narration files are already
// prepared by buildShort; this lays them on the final timeline (transitions, J/L cuts), mixes music, SFX and ducking,
// and finishes the picture (punch-ins, loop, captions, grade, texture). Graph strings come from src/edit/filters.ts.

import fs from "fs";
import path from "path";
import { sfxFile } from "../edit/audioLib";
import { pickKeywordWords } from "../edit/director";
import {
  COLOR_TAG_ARGS,
  buildVideoGraph,
  computeTimeline,
  dropoutWindows,
  editMixGraph,
  finishVideoGraph,
  loudnormFilter,
  needsVideoGraph,
  resolveNarration,
  sfxEvents,
  shiftWords,
  timelineGraph,
} from "../edit/filters";
import type { EditPlan } from "../edit/types";
import { ensureFont } from "../media/fonts";
import type { BuildResult, LoudnessMeasure, RunPaths } from "./assemble";
import { buildAss } from "./captions";
import { FFMPEG, ff, probe, run } from "./ffmpeg";
import type { ShortPlan } from "./plan";
import type { Word } from "./tts";

export interface EditCtx {
  P: RunPaths;
  plan: ShortPlan;
  edit: EditPlan;
  W: number;
  H: number;
  vertical: boolean;
  useNarr: boolean;
  vList: string[];
  aList: string[];
  narrDur: (number | null)[];
  rawWords: Word[][];
  warnings: string[];
  lap: (step: string) => void;
  outName?: string;
}

const inputsOf = (files: string[]) => files.flatMap((f) => ["-i", f]);

export async function finishEdited(c: EditCtx): Promise<BuildResult> {
  const { P, plan, edit: E, W, H, vertical, warnings } = c;
  const clipSecs = plan.clips.map((x) => x.seconds);
  const tl = computeTimeline(clipSecs, E.beats);
  const T = tl.total;
  if (Math.abs(T - E.totalSeconds) > 0.1) warnings.push(`Edit plan length ${E.totalSeconds}s differs from the clips' ${T}s; the clips' timeline was used.`);
  const delay = plan.narration.delay;

  // ---- picture: eased punch-ins, hard-cut runs and xfades in one H.264 pass (stream copy when nothing needs it)
  if (needsVideoGraph(E.beats)) {
    const vg = buildVideoGraph(E.beats, clipSecs, W, H);
    await ff([...inputsOf(c.vList), "-filter_complex", vg.graph, "-map", `[${vg.label}]`, "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "14", "-r", "30", "-pix_fmt", "yuv420p", "-t", String(T), "video.mp4"], { cwd: P.work });
  } else {
    fs.writeFileSync(path.join(P.work, "list-v.txt"), c.vList.map((f) => `file '${f}'`).join("\n"));
    await ff(["-f", "concat", "-safe", "0", "-i", "list-v.txt", "-c", "copy", "video.mp4"], { cwd: P.work });
  }
  c.lap("edited picture built");

  // ---- ambience on the final timeline (cross-fades shorten it just like the picture)
  if (tl.overlaps.some((o) => o > 0)) {
    await ff([...inputsOf(c.aList), "-filter_complex", timelineGraph(c.aList.map((_, i) => ({ input: i, startSec: tl.starts[i] })), T), "-map", "[out]", "-c:a", "pcm_s16le", "amb.wav"], { cwd: P.work });
  } else {
    fs.writeFileSync(path.join(P.work, "list-a.txt"), c.aList.map((f) => `file '${f}'`).join("\n"));
    await ff(["-f", "concat", "-safe", "0", "-i", "list-a.txt", "-c", "copy", "amb.wav"], { cwd: P.work });
  }

  // ---- one narration timeline with J/L-cut offsets
  const place = resolveNarration(tl.starts, E.beats.map((b) => b.narrationOffset), c.narrDur, delay);
  const words: Word[] = [];
  if (c.useNarr) {
    const items = place.flatMap((p, i) => (p ? [{ input: 0, startSec: p.startSec, file: `ns-${plan.clips[i].id}.wav` }] : []));
    items.forEach((it, k) => (it.input = k));
    await ff([...inputsOf(items.map((i) => i.file)), "-filter_complex", timelineGraph(items, T), "-map", "[out]", "-c:a", "pcm_s16le", "narr.wav"], { cwd: P.work });
    place.forEach((p, i) => p && words.push(...shiftWords(c.rawWords[i], p.startSec)));
  }

  // ---- captions: bottom edge at y 1248, one accent keyword per group
  let captionsFile: string | null = null;
  let ass = "";
  if (plan.captions.enabled && c.useNarr && words.length) {
    const font = ensureFont(P.work, plan.language);
    const per = plan.captions.wordsPerChunk;
    ass = buildAss(words, {
      wordsPerChunk: per,
      style: plan.captions.style,
      fontSize: plan.captions.fontSize ?? (vertical ? 92 : 60),
      marginBottom: plan.captions.marginBottom ?? (vertical ? 672 : 110),
      width: W,
      height: H,
      keywords: new Set(pickKeywordWords(words, per).filter(Boolean)),
      accent: E.style.accent,
    }).replace("Arial Black", font.name);
    captionsFile = path.join(P.work, "captions.ass");
    fs.writeFileSync(captionsFile, ass);
  }

  // ---- inputs: 0 video, 1 ambience, narration, music, then one per sound effect
  const files = ["video.mp4", "amb.wav"];
  const nIdx = c.useNarr ? files.push("narr.wav") - 1 : -1;
  const inputs = inputsOf(files);
  const musicFile = E.music?.file ?? plan.music?.file ?? null;
  let mIdx = -1;
  if (musicFile && fs.existsSync(musicFile)) {
    mIdx = files.length;
    files.push(musicFile);
    inputs.push("-stream_loop", "-1", "-i", path.resolve(musicFile));
  } else if (musicFile) warnings.push(`Music file not found: ${musicFile}; made without music.`);
  const sfx: { input: number; at: number; gainDb: number }[] = [];
  let next = 2 + (nIdx >= 0 ? 1 : 0) + (mIdx >= 0 ? 1 : 0);
  for (const ev of sfxEvents(E)) {
    const f = sfxFile(ev.kind as never, ev.take);
    if (!f) continue;
    inputs.push("-i", f);
    sfx.push({ input: next++, at: ev.at, gainDb: ev.gainDb });
  }
  if (!sfx.length && E.beats.some((b) => b.sfx.length)) warnings.push("No sound-effect files found in assets/audio/sfx; made without effects.");

  const musicGain = E.music?.gain ?? plan.music?.gain ?? 0.126;
  const mix = editMixGraph({
    ambient: 1,
    narration: nIdx,
    music: mIdx,
    sfx,
    total: T,
    ambientGain: c.useNarr ? plan.ambientGain : 1,
    musicGain,
    musicEntryAt: E.music?.entryAt ?? 0,
    duckDb: E.style.duckDb,
    dropouts: dropoutWindows(E),
  });
  const audio = (extra: string) => `${mix};[mix]${loudnormFilter(extra)}[a]`;
  const picture = finishVideoGraph({ total: T, style: E.style, captions: captionsFile ? "captions.ass" : null, loop: E.loop });

  const m = await run(FFMPEG, ["-hide_banner", "-y", ...inputs, "-filter_complex", audio(":print_format=json"), "-map", "[a]", "-t", String(T), "-f", "null", "-"], { cwd: P.work });
  if (m.code !== 0) throw new Error(`Loudness measurement failed: ${m.stderr.slice(-1500)}`);
  const lm = m.stderr.match(/\{[\s\S]*?\}/g);
  if (!lm) throw new Error("Could not read loudnorm measurement");
  const meas = JSON.parse(lm[lm.length - 1]) as LoudnessMeasure;
  c.lap("loudness measured");

  const outFile = path.join(P.final, `${c.outName || plan.id}.mp4`);
  const second = `:measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:measured_LRA=${meas.input_lra}:measured_thresh=${meas.input_thresh}:offset=${meas.target_offset}:linear=true`;
  await ff(
    [...inputs, "-filter_complex", `${picture};${audio(second)}`, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-maxrate", vertical ? "10M" : "14M", "-bufsize", vertical ? "20M" : "28M", "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p", ...COLOR_TAG_ARGS, "-r", "30", "-g", "60", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", String(T), "-movflags", "+faststart", outFile],
    { cwd: P.work }
  );
  c.lap("final encode done");
  const info = await probe(outFile);
  return { file: outFile, duration: info.duration, loudness: meas, warnings, captionsFile, words, ass };
}
