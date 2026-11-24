import { spawn } from "child_process";

// ffmpeg-static / ffprobe-static ship real binaries inside node_modules, so no system install is needed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const FFMPEG: string = require("ffmpeg-static");
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const FFPROBE: string = require("ffprobe-static").path;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(bin: string, args: string[], opts: { cwd?: string } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: opts.cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** Runs ffmpeg and throws with the tail of stderr when it fails. */
export async function ff(args: string[], opts: { cwd?: string } = {}): Promise<RunResult> {
  const r = await run(FFMPEG, ["-hide_banner", "-y", ...args], opts);
  if (r.code !== 0) throw new Error(`ffmpeg failed (exit ${r.code}): ${r.stderr.slice(-1800)}`);
  return r;
}

export interface ProbeInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
  videoCodec: string;
  audioCodec: string;
  bitrateKbps: number;
  sizeBytes: number;
  pixFmt: string;
  profile: string;
}

export async function probe(file: string): Promise<ProbeInfo> {
  const r = await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  if (r.code !== 0) throw new Error(`ffprobe failed for ${file}: ${r.stderr.slice(-500)}`);
  const j = JSON.parse(r.stdout);
  const v = (j.streams || []).find((s: any) => s.codec_type === "video");
  const a = (j.streams || []).find((s: any) => s.codec_type === "audio");
  const [num, den] = String(v?.avg_frame_rate || "0/1").split("/").map(Number);
  return {
    duration: Number(j.format?.duration || v?.duration || 0),
    width: Number(v?.width || 0),
    height: Number(v?.height || 0),
    fps: den ? Math.round((num / den) * 100) / 100 : 0,
    hasAudio: !!a,
    hasVideo: !!v,
    videoCodec: v?.codec_name || "",
    audioCodec: a?.codec_name || "",
    bitrateKbps: Math.round(Number(j.format?.bit_rate || 0) / 1000),
    sizeBytes: Number(j.format?.size || 0),
    pixFmt: v?.pix_fmt || "",
    profile: v?.profile || "",
  };
}
