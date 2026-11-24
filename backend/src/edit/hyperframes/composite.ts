// Renders the HyperFrames graphics overlay (chapter, stat and end cards) for a finished video and composites it over the
// video with FFmpeg. Never throws: on any failure the video is left exactly as built and a warning is returned.

import fs from "fs";
import path from "path";
import { FFMPEG, run } from "../../shorts/ffmpeg";
import type { EditPlan } from "../types";
import { OVERLAY_FILTER, renderOverlays } from "./overlays";

export interface CompositeResult {
  applied: boolean;
  cards: number;
  ms: number;
  warnings: string[];
}

export async function compositeOverlays(opts: {
  videoFile: string;
  edit: EditPlan;
  width: number;
  height: number;
  fps: number;
  totalSeconds: number;
  workDir: string;
  facts?: { text: string; value?: string }[];
}): Promise<CompositeResult> {
  const t0 = Date.now();
  const warnings: string[] = [];
  try {
    const r = await renderOverlays({ plan: opts.edit, width: opts.width, height: opts.height, fps: opts.fps, totalSeconds: opts.totalSeconds, outDir: path.join(opts.workDir, "overlay"), style: opts.edit.style, facts: opts.facts });
    warnings.push(...r.warnings);
    if (!r.file) return { applied: false, cards: r.cards, ms: Date.now() - t0, warnings };
    const tmp = opts.videoFile.replace(/\.mp4$/i, ".overlay.mp4");
    const filter = OVERLAY_FILTER.replace("%FPS%", String(opts.fps));
    const res = await run(FFMPEG, [
      // libvpx-vp9 is needed to read the alpha channel of a WebM overlay; FFmpeg's native VP9 decoder drops it.
      "-hide_banner", "-y", "-i", opts.videoFile, ...(/\.webm$/i.test(r.file) ? ["-c:v", "libvpx-vp9"] : []), "-i", r.file,
      "-filter_complex", filter, "-map", "[vo]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(opts.fps),
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
      "-c:a", "copy", "-movflags", "+faststart", tmp,
    ]);
    if (res.code !== 0 || !fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
      warnings.push(`overlay composite failed: ${String(res.stderr || "").slice(-300)}`);
      fs.rmSync(tmp, { force: true });
      return { applied: false, cards: r.cards, ms: Date.now() - t0, warnings };
    }
    fs.renameSync(tmp, opts.videoFile);
    return { applied: true, cards: r.cards, ms: Date.now() - t0, warnings };
  } catch (e) {
    warnings.push(`overlay pass failed: ${e instanceof Error ? e.message : String(e)}`);
    return { applied: false, cards: 0, ms: Date.now() - t0, warnings };
  }
}
