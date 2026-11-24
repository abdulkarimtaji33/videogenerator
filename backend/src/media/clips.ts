// Non-AI clip types: Ken Burns stills, text cards, thumbnails and the 9:16 reframer. Pure ffmpeg, no network.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { ff } from "../shorts/ffmpeg";
import { ensureFont, wrapText } from "./fonts";

/** A still image with slow motion. Variants: 0 zoom in, 1 zoom out, 2 slow pan. */
export async function kenBurns(image: string, out: string, seconds: number, W: number, H: number, variant = 0): Promise<void> {
  const frames = Math.round(seconds * 30);
  const v = variant % 3;
  const z = v === 0 ? "min(1.0+0.0006*on,1.2)" : v === 1 ? "max(1.2-0.0006*on,1.0)" : "1.12";
  const x = v === 2 ? `(iw-iw/zoom)*on/${frames}` : "iw/2-(iw/zoom/2)";
  const y = "ih/2-(ih/zoom/2)";
  const vf = `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${W}x${H}:fps=30,format=yuv420p,setsar=1`;
  await ff(["-loop", "1", "-i", image, "-vf", vf, "-t", String(seconds), "-c:v", "libx264", "-preset", "fast", "-crf", "14", "-r", "30", "-pix_fmt", "yuv420p", out]);
}

/** A plain dark card with centred, wrapped text. */
export async function textCard(text: string, out: string, seconds: number, W: number, H: number, workDir: string): Promise<void> {
  const font = ensureFont(workDir);
  const name = `card-${crypto.createHash("md5").update(text).digest("hex").slice(0, 8)}.txt`;
  fs.writeFileSync(path.join(workDir, name), wrapText(text.toUpperCase(), W === 1080 ? 18 : 30));
  const size = W === 1080 ? 88 : 72;
  const vf = `drawtext=fontfile=fonts/${font.file}:textfile=${name}:fontcolor=white:fontsize=${size}:line_spacing=20:x=(w-text_w)/2:y=(h-text_h)/2:borderw=4:bordercolor=black@0.6,format=yuv420p`;
  await ff(["-f", "lavfi", "-i", `color=c=0x1b2a52:s=${W}x${H}:r=30:d=${seconds}`, "-vf", vf, "-t", String(seconds), "-c:v", "libx264", "-preset", "fast", "-crf", "14", "-r", "30", "-pix_fmt", "yuv420p", path.resolve(out)], { cwd: workDir });
}

export interface ThumbnailInput {
  image: string;
  /** 3 to 6 words; large text reads better and survives shrinking to phone size. */
  text: string;
  out: string;
  /** A: bottom-left white on a dark band. B: top-left yellow. */
  variant?: "A" | "B";
  workDir: string;
}

/** 1280x720 thumbnail: cropped hero image, contrast lift, short bold text. */
export async function makeThumbnail(i: ThumbnailInput): Promise<void> {
  const words = i.text.trim().split(/\s+/);
  if (words.length < 1 || words.length > 6) throw new Error("Thumbnail text must be 1 to 6 words.");
  const font = ensureFont(i.workDir);
  const tf = `thumb-${crypto.createHash("md5").update(i.text + (i.variant || "A")).digest("hex").slice(0, 8)}.txt`;
  fs.writeFileSync(path.join(i.workDir, tf), wrapText(i.text.toUpperCase(), 14));
  const b = i.variant === "B";
  const text = `drawtext=fontfile=fonts/${font.file}:textfile=${tf}:fontcolor=${b ? "0xFFD700" : "white"}:fontsize=${b ? 130 : 120}:line_spacing=10:x=60:y=${b ? "60" : "h-text_h-70"}:borderw=9:bordercolor=black`;
  const band = b ? "" : ",drawbox=x=0:y=ih*0.5:w=iw:h=ih*0.5:color=black@0.45:t=fill";
  const vf = `scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,eq=contrast=1.12:saturation=1.2${band},${text}`;
  await ff(["-i", path.resolve(i.image), "-vf", vf, "-frames:v", "1", path.resolve(i.out)], { cwd: i.workDir });
}

/**
 * Writes the last frame of a video as a PNG and returns its path. It is the start frame of the next clip, so two
 * shots of one scene join without a visible jump.
 */
export async function extractLastFrame(video: string, outPng: string): Promise<string> {
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  await ff(["-sseof", "-0.12", "-i", video, "-frames:v", "1", "-q:v", "1", outPng]);
  if (!fs.existsSync(outPng)) throw new Error(`Could not read the last frame of ${video}`);
  return outPng;
}

/** Cuts a vertical 9:16 Short from a 16:9 master: centred crop, scaled to 1080x1920. */
export async function reframeToVertical(input: string, out: string, start: number, duration: number): Promise<void> {
  await ff(["-ss", String(start), "-i", input, "-t", String(duration), "-vf", "crop=ih*9/16:ih:(iw-ow)/2:0,scale=1080:1920,setsar=1,fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
}
