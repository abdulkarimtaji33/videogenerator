// Assembles a finished video (9:16 Short or 16:9 long-form) from AI clips, Ken Burns stills and text cards,
// the narration, optional music and word-timed captions.
// All intermediate audio is PCM and all intermediate video is a single H.264 pass, then one final encode,
// so narration, ambient sound and picture never drift apart across clip boundaries.

import fs from "fs";
import path from "path";
import { logger } from "../log";
import { kenBurns, textCard } from "../media/clips";
import { ensureFont } from "../media/fonts";
import { finishEdited } from "./assembleEdit";
import { buildAss } from "./captions";
import { FFMPEG, ff, probe, run } from "./ffmpeg";
import { ShortPlan, dims } from "./plan";
import type { Word } from "./tts";

export interface RunPaths {
  runDir: string;
  clips: string;
  work: string;
  final: string;
}

export function runPaths(storageRoot: string, id: string): RunPaths {
  const runDir = path.join(storageRoot, "shorts", id);
  const p = { runDir, clips: path.join(runDir, "clips"), work: path.join(runDir, "work"), final: path.join(runDir, "final") };
  for (const d of [p.runDir, p.clips, p.work, p.final]) fs.mkdirSync(d, { recursive: true });
  return p;
}

export interface LoudnessMeasure {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

function lastJson(text: string): any {
  const m = text.match(/\{[\s\S]*?\}/g);
  if (!m) throw new Error("Could not read loudnorm measurement");
  return JSON.parse(m[m.length - 1]);
}

export interface BuildResult {
  file: string;
  duration: number;
  loudness: LoudnessMeasure;
  warnings: string[];
  captionsFile: string | null;
  /** Caption word timings on the final timeline (edit mode only). */
  words?: Word[];
  /** The ASS text that was burnt in (edit mode only), for QA. */
  ass?: string;
}

export async function buildShort(storageRoot: string, plan: ShortPlan, outName?: string): Promise<BuildResult> {
  const P = runPaths(storageRoot, plan.id);
  const { W, H } = dims(plan.aspect);
  const vertical = plan.aspect === "9:16";
  const warnings: string[] = [];
  const useNarr = plan.narration.mode === "tts";
  // Edit mode: plan.edit (src/edit) drives transitions, punch-ins, J/L cuts, SFX, music and grade. Without it, nothing changes.
  const E = plan.edit && plan.edit.beats.length === plan.clips.length ? plan.edit : undefined;
  if (plan.edit && !E) warnings.push("The edit plan does not match the clips; assembled without it.");
  const rawWords: Word[][] = [];
  const narrDur: (number | null)[] = [];
  const vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=30,format=yuv420p,setsar=1`;

  const vList: string[] = [];
  const aList: string[] = [];
  const nList: string[] = [];
  const words: Word[] = [];
  let t = 0;
  const t0 = Date.now();
  const lap = (step: string) => logger.info("assemble", { plan: plan.id, step, ms: Date.now() - t0 });

  for (let idx = 0; idx < plan.clips.length; idx++) {
    const clip = plan.clips[idx];
    const secs = clip.seconds;
    const vOut = `n-${clip.id}.mp4`;
    const aOut = `amb-${clip.id}.wav`;
    // A clip with no sound of its own gets a very quiet pink-noise room tone instead of digital silence,
    // which would sound like an audio dropout between clips that do have ambience.
    const silent = async () =>
      ff(["-f", "lavfi", "-i", `anoisesrc=color=pink:amplitude=0.05:sample_rate=48000:duration=${secs}`, "-af", "aformat=channel_layouts=stereo", "-t", String(secs), "-c:a", "pcm_s16le", path.join(P.work, aOut)]);

    if (clip.type === "still_kenburns") {
      const img = path.isAbsolute(clip.image!) ? clip.image! : path.join(P.runDir, clip.image!);
      if (!fs.existsSync(img)) throw new Error(`Missing image for clip ${clip.id}: ${img}`);
      await kenBurns(img, path.join(P.work, vOut), secs, W, H, idx);
      await silent();
    } else if (clip.type === "card") {
      await textCard(clip.text!, path.join(P.work, vOut), secs, W, H, P.work);
      await silent();
    } else {
      const src = path.join(P.clips, `${clip.id}.mp4`);
      if (!fs.existsSync(src)) throw new Error(`Missing clip file: ${src}`);
      const info = await probe(src);
      if (!info.hasVideo) throw new Error(`Clip ${clip.id} has no video stream`);
      const srcVertical = info.height > info.width;
      if (srcVertical !== vertical) warnings.push(`Clip ${clip.id} is ${info.width}x${info.height} but the video is ${plan.aspect}; the centre was cropped.`);
      if (info.duration + 0.05 < clip.trimStart + secs) {
        warnings.push(`Clip ${clip.id} is ${info.duration.toFixed(2)}s, shorter than the planned ${clip.trimStart + secs}s; the last frame may repeat.`);
      }
      await ff(["-ss", String(clip.trimStart), "-i", src, "-t", String(secs), "-an", "-vf", vf + ",tpad=stop_mode=clone:stop_duration=1", "-t", String(secs), "-c:v", "libx264", "-preset", "fast", "-crf", "14", "-r", "30", "-pix_fmt", "yuv420p", path.join(P.work, vOut)]);
      const fade = `afade=t=in:d=0.04,afade=t=out:st=${(secs - 0.04).toFixed(3)}:d=0.04`;
      if (info.hasAudio) {
        await ff(["-ss", String(clip.trimStart), "-i", src, "-t", String(secs), "-vn", "-af", `aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${secs},atrim=0:${secs},${fade}`, "-c:a", "pcm_s16le", path.join(P.work, aOut)]);
      } else {
        await silent();
      }
    }
    vList.push(vOut);
    aList.push(aOut);

    if (E) {
      // Edit mode: each narration becomes a plain wav; the edit pass lays them on ONE timeline (J/L cuts).
      let dur: number | null = null;
      let raw: Word[] = [];
      if (useNarr && clip.narration.trim()) {
        const mp3 = path.join(P.work, `narr-${clip.id}.mp3`);
        if (!fs.existsSync(mp3)) throw new Error(`Missing narration for ${clip.id}; run the narration step first.`);
        await ff(["-i", mp3, "-af", "aresample=48000,aformat=channel_layouts=stereo", "-c:a", "pcm_s16le", path.join(P.work, `ns-${clip.id}.wav`)]);
        dur = (await probe(mp3)).duration;
        const wf = path.join(P.work, `words-${clip.id}.json`);
        if (fs.existsSync(wf)) raw = JSON.parse(fs.readFileSync(wf, "utf-8"));
      }
      narrDur.push(dur);
      rawWords.push(raw);
    } else if (useNarr && clip.narration.trim()) {
      const mp3 = path.join(P.work, `narr-${clip.id}.mp3`);
      if (!fs.existsSync(mp3)) throw new Error(`Missing narration for ${clip.id}; run the narration step first.`);
      const d = Math.round(plan.narration.delay * 1000);
      const nOut = `nw-${clip.id}.wav`;
      await ff(["-i", mp3, "-af", `aresample=48000,aformat=channel_layouts=stereo,adelay=${d}|${d},apad=whole_dur=${secs},atrim=0:${secs}`, "-c:a", "pcm_s16le", path.join(P.work, nOut)]);
      nList.push(nOut);
      const wf = path.join(P.work, `words-${clip.id}.json`);
      if (fs.existsSync(wf)) {
        const ws: Word[] = JSON.parse(fs.readFileSync(wf, "utf-8"));
        for (const w of ws) words.push({ word: w.word, start: w.start + t + plan.narration.delay, end: w.end + t + plan.narration.delay });
      }
    } else if (useNarr) {
      await ff(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(secs), "-c:a", "pcm_s16le", path.join(P.work, `nw-${clip.id}.wav`)]);
      nList.push(`nw-${clip.id}.wav`);
    }
    t += secs;
  }

  if (E) {
    lap("clips and narration prepared");
    const r = await finishEdited({ P, plan, edit: E, W, H, vertical, useNarr, vList, aList, narrDur, rawWords, warnings, lap, outName });
    return r;
  }

  const concat = async (files: string[], listName: string, out: string) => {
    fs.writeFileSync(path.join(P.work, listName), files.map((f) => `file '${f}'`).join("\n"));
    await ff(["-f", "concat", "-safe", "0", "-i", listName, "-c", "copy", out], { cwd: P.work });
  };
  lap("clips and narration prepared");
  await concat(vList, "list-v.txt", "video.mp4");
  await concat(aList, "list-a.txt", "amb.wav");
  if (useNarr) await concat(nList, "list-n.txt", "narr.wav");

  let captionsFile: string | null = null;
  if (plan.captions.enabled && useNarr && words.length) {
    const font = ensureFont(P.work, plan.language);
    const ass = buildAss(words, {
      wordsPerChunk: plan.captions.wordsPerChunk,
      style: plan.captions.style,
      fontSize: plan.captions.fontSize ?? (vertical ? 92 : 60),
      marginBottom: plan.captions.marginBottom ?? (vertical ? 672 : 110),
      width: W,
      height: H,
    }).replace("Arial Black", font.name);
    captionsFile = path.join(P.work, "captions.ass");
    fs.writeFileSync(captionsFile, ass);
  }

  // Inputs: 0 video, 1 ambient, then narration and music if present.
  const inputs = ["-i", "video.mp4", "-i", "amb.wav"];
  let next = 2;
  const nIdx = useNarr ? next++ : -1;
  if (useNarr) inputs.push("-i", "narr.wav");
  const mIdx = plan.music ? next++ : -1;
  if (plan.music) {
    if (!fs.existsSync(plan.music.file)) throw new Error(`Music file not found: ${plan.music.file}`);
    inputs.push("-stream_loop", "-1", "-i", path.resolve(plan.music.file));
  }

  const gain = useNarr ? plan.ambientGain : 1;
  const vChain = captionsFile ? "[0:v]ass=captions.ass:fontsdir=fonts[v]" : "[0:v]null[v]";
  const bed = plan.music
    ? `[1:a]volume=${gain}[amb0];[${mIdx}:a]atrim=0:${t},asetpts=N/SR/TB,volume=${plan.music.gain},afade=t=in:d=1,afade=t=out:st=${Math.max(0, t - 2)}:d=2[mus];[amb0][mus]amix=inputs=2:normalize=0:duration=first[bed]`
    : `[1:a]volume=${gain}[bed]`;
  const mix = useNarr
    ? `[${nIdx}:a]asplit=2[n1][n2];[bed][n1]sidechaincompress=threshold=0.03:ratio=8:attack=10:release=300[ducked];[ducked][n2]amix=inputs=2:normalize=0:duration=first[mix]`
    : `[bed]anull[mix]`;
  // The video chain is only included for the final encode; the measuring pass is audio only (an unmapped
  // video output makes ffmpeg refuse to run).
  const loud = (extra: string, withVideo = true) => `${withVideo ? vChain + ";" : ""}${bed};${mix};[mix]loudnorm=I=-14:TP=-1.5:LRA=11${extra}[a]`;

  // Pass 1: measure.
  const m = await run(FFMPEG, ["-hide_banner", "-y", ...inputs, "-filter_complex", loud(":print_format=json", false), "-map", "[a]", "-t", String(t), "-f", "null", "-"], { cwd: P.work });
  if (m.code !== 0) throw new Error(`Loudness measurement failed: ${m.stderr.slice(-1500)}`);
  const meas = lastJson(m.stderr) as LoudnessMeasure;
  lap("loudness measured");

  // Pass 2: encode with the measured values (linear loudness correction).
  const outFile = path.join(P.final, `${outName || plan.id}.mp4`);
  const second = `:measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:measured_LRA=${meas.input_lra}:measured_thresh=${meas.input_thresh}:offset=${meas.target_offset}:linear=true`;
  await ff([...inputs, "-filter_complex", loud(second), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-maxrate", vertical ? "10M" : "14M", "-bufsize", vertical ? "20M" : "28M", "-profile:v", "high", "-level", "4.2", "-pix_fmt", "yuv420p", "-r", "30", "-g", "60", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", String(t), "-movflags", "+faststart", outFile], { cwd: P.work });

  lap("final encode done");
  const info = await probe(outFile);
  return { file: outFile, duration: info.duration, loudness: meas, warnings, captionsFile };
}
