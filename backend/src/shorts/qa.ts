// Automatic quality checks on a finished Short, plus sample frames to inspect by eye.
// Thresholds follow YouTube's published encode guidance (H.264 High, about -14 LUFS, faststart) and the
// project's own rules (no frozen or black stretches, no long silences, captions visible).

import fs from "fs";
import path from "path";
import { FFMPEG, probe, run } from "./ffmpeg";
import type { ProbeInfo } from "./ffmpeg";
import { dims } from "./plan";
import type { ShortPlan } from "./plan";
import type { EditPlan } from "../edit/types";
import { sfxEvents, sfxGapViolations } from "../edit/filters";
import { CAPTION_BOTTOM_MAX_Y, MAX_CPS, MAX_TRANSITION_KINDS } from "../edit/rules";
import { chunkWords } from "./captions";
import type { Word } from "./tts";

export interface QaCheck {
  id: string;
  ok: boolean;
  message: string;
}

export interface QaResult {
  ok: boolean;
  checks: QaCheck[];
  info: ProbeInfo;
  frames: string[];
  loudness: { integrated: number; truePeak: number } | null;
}

export interface QaOptions {
  /** The edit plan the video was built from (enables sfx_density and transition_kinds). */
  edit?: EditPlan | null;
  /** The ASS text burnt into the video (enables caption_safe_zone and end_clean). */
  ass?: string | null;
  /** Caption words on the final timeline (enables cps). */
  words?: Word[] | null;
  /** Long-form video: the 60 s Shorts limit does not apply. Defaults to plan.format === "long". */
  long?: boolean;
}

/** Checks that need no ffmpeg: caption position and reading speed, effect density, transition kinds, clean end. */
export function editQaChecks(o: QaOptions & { duration: number }): QaCheck[] {
  const out: QaCheck[] = [];
  const add = (id: string, ok: boolean, message: string) => out.push({ id, ok, message });
  if (o.ass) {
    const ys = [...o.ass.matchAll(/\\pos\(\d+,(\d+)\)/g)].map((m) => Number(m[1]));
    const h = Number((o.ass.match(/PlayResY:\s*(\d+)/) || [])[1] || 1920);
    const w = Number((o.ass.match(/PlayResX:\s*(\d+)/) || [])[1] || 1080);
    const max = h > w ? Math.round((h * CAPTION_BOTTOM_MAX_Y) / 1920) : h;
    const worst = ys.length ? Math.max(...ys) : 0;
    add("caption_safe_zone", worst <= max, ys.length ? `caption bottom edge y ${worst} (want at most ${max})` : "no captions");
    const ends = [...o.ass.matchAll(/^Dialogue: \d+,[\d:.]+,([\d:.]+),/gm)].map((m) => {
      const [hh, mm, ss] = m[1].split(":");
      return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
    });
    const lastEnd = ends.length ? Math.max(...ends) : 0;
    add("end_clean", lastEnd <= o.duration - 0.05, `last caption ends at ${lastEnd.toFixed(2)}s of ${o.duration.toFixed(2)}s`);
  }
  if (o.words && o.words.length) {
    const bad = chunkWords(o.words, 3).filter((c) => {
      const chars = c.reduce((n, w) => n + w.word.length, 0) + c.length - 1;
      const secs = Math.max(0.1, c[c.length - 1].end - c[0].start);
      return chars / secs > MAX_CPS && c.length > 1;
    });
    // Social captions follow the speaker word by word, so a few fast phrases are normal; fail only when many groups are too fast.
    const groups = chunkWords(o.words, 3).length || 1;
    add("cps", bad.length / groups <= 0.3, bad.length ? `${bad.length} of ${groups} caption group(s) faster than ${MAX_CPS} characters per second` : `captions within ${MAX_CPS} characters per second`);
  }
  if (o.edit) {
    const v = sfxGapViolations(sfxEvents(o.edit).map((e) => ({ kind: e.kind, at: e.at })));
    add("sfx_density", v.length === 0, v.length ? `${v.length} sound-effect pair(s) closer than 3 s` : "sound effects at most one per 3 s");
    const kinds = new Set(o.edit.beats.map((b) => b.transitionIn).filter((k) => k !== "cut"));
    add("transition_kinds", kinds.size <= MAX_TRANSITION_KINDS, `${kinds.size} transition kind(s) (want at most ${MAX_TRANSITION_KINDS})`);
  }
  return out;
}

export async function qaShort(file: string, plan: ShortPlan | null, frameDir: string, opts: QaOptions = {}): Promise<QaResult> {
  const info = await probe(file);
  const checks: QaCheck[] = [];
  const add = (id: string, ok: boolean, message: string) => checks.push({ id, ok, message });

  const want = dims(plan?.aspect ?? "9:16");
  add("size", info.width === want.W && info.height === want.H, `${info.width}x${info.height} (want ${want.W}x${want.H})`);
  add("fps", Math.abs(info.fps - 30) <= 1, `${info.fps} fps (want 30)`);
  add("codec", info.videoCodec === "h264" && info.audioCodec === "aac", `video ${info.videoCodec}, audio ${info.audioCodec} (want h264 + aac)`);
  add("pix_fmt", info.pixFmt === "yuv420p", `pixel format ${info.pixFmt}`);
  add("audio_present", info.hasAudio, info.hasAudio ? "audio stream present" : "NO audio stream");
  const long = opts.long ?? plan?.format === "long";
  const target = opts.edit?.totalSeconds ?? plan?.clips.reduce((n, c) => n + c.seconds, 0) ?? info.duration;
  add("duration", Math.abs(info.duration - target) <= 0.5 && (long || info.duration <= 60), `${info.duration.toFixed(2)}s (planned ${target}s${long ? ", long-form: no 60 s limit" : ", Shorts limit used here 60s"})`);
  add("bitrate", info.bitrateKbps >= 3000, `${info.bitrateKbps} kbps (want at least 3000)`);

  for (const c of editQaChecks({ ...opts, duration: info.duration })) add(c.id, c.ok, c.message);

  // Loudness of the finished file.
  let loudness: QaResult["loudness"] = null;
  const l = await run(FFMPEG, ["-hide_banner", "-i", file, "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-vn", "-f", "null", "-"]);
  const lm = l.stderr.match(/\{[\s\S]*?\}/g);
  if (lm) {
    const j = JSON.parse(lm[lm.length - 1]);
    loudness = { integrated: Number(j.input_i), truePeak: Number(j.input_tp) };
    add("loudness", Math.abs(loudness.integrated + 14) <= 1.5, `${loudness.integrated} LUFS (want -14 +/- 1.5)`);
    add("true_peak", loudness.truePeak <= -0.9, `${loudness.truePeak} dBTP (want at most -1)`);
  }

  // Frozen picture, black frames, long silence.
  const fz = await run(FFMPEG, ["-hide_banner", "-i", file, "-vf", "freezedetect=n=-60dB:d=1.2", "-an", "-f", "null", "-"]);
  const frozen = [...fz.stderr.matchAll(/freeze_duration:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  add("no_freeze", frozen.length === 0, frozen.length ? `frozen picture for ${frozen.map((f) => f.toFixed(1)).join("s, ")}s` : "no frozen stretches");
  const bk = await run(FFMPEG, ["-hide_banner", "-i", file, "-vf", "blackdetect=d=0.3:pix_th=0.04", "-an", "-f", "null", "-"]);
  const black = [...bk.stderr.matchAll(/black_duration:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  add("no_black", black.length === 0, black.length ? `black frames for ${black.join("s, ")}s` : "no black stretches");
  const sl = await run(FFMPEG, ["-hide_banner", "-i", file, "-af", "silencedetect=n=-50dB:d=1.5", "-vn", "-f", "null", "-"]);
  const quiet = [...sl.stderr.matchAll(/silence_duration:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  add("no_long_silence", quiet.length === 0, quiet.length ? `silence for ${quiet.join("s, ")}s` : "no long silences");

  // Sample frames to look at: hook, mid-points, last frame.
  fs.mkdirSync(frameDir, { recursive: true });
  const times = [0.3, 1.5, 3, Math.min(info.duration / 2, 16), Math.max(info.duration - 6, 1), Math.max(info.duration - 0.5, 0.5)].map((x) => Math.round(x * 10) / 10);
  const frames: string[] = [];
  for (const t of times) {
    const out = path.join(frameDir, `frame-${String(t).replace(".", "_")}s.png`);
    const r = await run(FFMPEG, ["-hide_banner", "-y", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=360:-1", out]);
    if (r.code === 0) frames.push(out);
  }
  return { ok: checks.every((c) => c.ok), checks, info, frames, loudness };
}
