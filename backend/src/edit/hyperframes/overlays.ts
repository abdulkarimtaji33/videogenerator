// HyperFrames graphics overlay pass (Editing-Quality-Plan Phase 6). Builds a small transparent HyperFrames project in outDir,
// checks it, renders it with alpha (WebM VP9 alpha, else ProRes 4444 MOV) and returns the file. Never throws: on any failure it
// returns file=null, fallback=true and a warning so the caller can use fallbackCards.ts (FFmpeg drawtext) instead.

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { cardCompositionHtml, planCards, rootHtml } from "./html";
import type { Fact } from "./html";
import type { EditPlan, EditStyle } from "../types";

export interface RenderOverlaysOpts {
  plan: EditPlan;
  width: number;
  height: number;
  fps: number;
  totalSeconds: number;
  outDir: string;
  style: EditStyle;
  facts?: { text: string; value?: string }[];
}

export interface RenderOverlaysResult {
  file: string | null;
  cards: number;
  ms: number;
  fallback: boolean;
  warnings: string[];
}

const PINNED = "hyperframes@0.9.79";
const CHECK_TIMEOUT_MS = 5 * 60_000;
const RENDER_TIMEOUT_MS = 25 * 60_000;

interface Cli {
  cmd: string;
  args: string[];
  /** Directory of the installed package, used to find the vendored GSAP. */
  pkgDir: string | null;
}

/** An already-installed HyperFrames first (env override, project node_modules, npx cache), else the pinned npx download. */
export function locateCli(): Cli {
  const cands: string[] = [];
  if (process.env.HYPERFRAMES_CLI) cands.push(process.env.HYPERFRAMES_CLI);
  cands.push(path.resolve(process.cwd(), "node_modules/hyperframes/bin/hyperframes.mjs"));
  cands.push("E:/projects/video-tools/hf-cache/node_modules/hyperframes/bin/hyperframes.mjs"); // resumable install made for this machine
  const roots = [
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "npm-cache", "_npx"),
    path.join(os.homedir(), ".npm", "_npx"),
  ];
  for (const r of roots) {
    try {
      for (const d of fs.readdirSync(r)) cands.push(path.join(r, d, "node_modules/hyperframes/bin/hyperframes.mjs"));
    } catch {
      /* no cache here */
    }
  }
  for (const c of cands) {
    if (c && fs.existsSync(c)) return { cmd: process.execPath, args: [c], pkgDir: path.resolve(path.dirname(c), "..") };
  }
  return { cmd: process.platform === "win32" ? "npx.cmd" : "npx", args: ["--yes", PINNED], pkgDir: null };
}

/** A full FFmpeg build (with ffprobe) installed by winget or pointed to by FFMPEG_BIN_DIR: HyperFrames needs ffprobe, which ffmpeg-static lacks. */
function fullFfmpegDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.FFMPEG_BIN_DIR) dirs.push(process.env.FFMPEG_BIN_DIR);
  const base = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages");
  try {
    if (base) {
      for (const pkg of fs.readdirSync(base)) {
        if (!/^Gyan\.FFmpeg/i.test(pkg)) continue;
        for (const sub of fs.readdirSync(path.join(base, pkg))) {
          const bin = path.join(base, pkg, sub, "bin");
          if (fs.existsSync(path.join(bin, process.platform === "win32" ? "ffprobe.exe" : "ffprobe"))) dirs.push(bin);
        }
      }
    }
  } catch {
    /* not installed through winget */
  }
  return dirs;
}

function systemChrome(): string | null {
  const c = [process.env.HYPERFRAMES_BROWSER_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"];
  return (c.filter(Boolean) as string[]).find((p) => fs.existsSync(p)) ?? null;
}

function binDirs(): string[] {
  const dirs: string[] = [...fullFfmpegDirs()];
  for (const mod of ["ffmpeg-static", "ffprobe-static"]) {
    try {
      const p = mod === "ffmpeg-static" ? (require(mod) as string) : (require(mod) as { path: string }).path;
      if (p) dirs.push(path.dirname(p));
    } catch {
      /* not installed */
    }
  }
  return dirs;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const chrome = systemChrome();
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: [...binDirs(), process.env.PATH ?? ""].join(path.delimiter), HYPERFRAMES_NO_TELEMETRY: "1", ...(chrome ? { HYPERFRAMES_BROWSER_PATH: chrome } : {}) };
    let out = "";
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, windowsHide: true, shell: /\.cmd$/i.test(cmd) });
    } catch (e) {
      resolve({ code: null, out: String(e) });
      return;
    }
    const timer = setTimeout(() => {
      out += "\n[timeout]";
      child.kill();
    }, timeoutMs);
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, out: out + String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

function findGsap(cli: Cli): string | null {
  const cands = [
    cli.pkgDir && path.join(cli.pkgDir, "dist/vendor/npm/gsap@3.15.0/dist/gsap.min.js"),
    path.resolve(process.cwd(), "node_modules/gsap/dist/gsap.min.js"),
  ].filter(Boolean) as string[];
  if (cli.pkgDir) {
    try {
      const v = path.join(cli.pkgDir, "dist/vendor/npm");
      for (const d of fs.readdirSync(v)) if (d.startsWith("gsap@")) cands.unshift(path.join(v, d, "dist/gsap.min.js"));
    } catch {
      /* ignore */
    }
  }
  return cands.find((c) => fs.existsSync(c)) ?? null;
}

/** Writes the HyperFrames project (index.html + one scene per card). Returns the number of cards written. */
export function writeProject(opts: RenderOverlaysOpts, gsapFile: string | null, warnings: string[]): number {
  const { plan, width, height, totalSeconds, outDir, style } = opts;
  const { cards, warnings: w } = planCards(plan, width, height, totalSeconds, opts.facts as Fact[] | undefined);
  warnings.push(...w);
  fs.mkdirSync(path.join(outDir, "compositions"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });
  if (gsapFile) fs.copyFileSync(gsapFile, path.join(outDir, "assets/gsap.min.js"));
  fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify({ id: "overlays", name: "overlays" }, null, 2));
  fs.writeFileSync(
    path.join(outDir, "hyperframes.json"),
    JSON.stringify({ paths: { blocks: "compositions", components: "compositions/components", assets: "assets" } }, null, 2),
  );
  for (const c of cards) fs.writeFileSync(path.join(outDir, "compositions", `${c.id}.html`), cardCompositionHtml(c, width, height, style, plan.captionBottomY));
  fs.writeFileSync(path.join(outDir, "index.html"), rootHtml(cards, width, height, totalSeconds, opts.fps));
  return cards.length;
}

/** Counts errors in `hyperframes check --json` output without depending on its exact shape. */
export function checkErrorCount(out: string): number {
  const i = out.indexOf("{");
  if (i < 0) return /error/i.test(out) && /fail/i.test(out) ? 1 : 0;
  try {
    const j = JSON.parse(out.slice(i, out.lastIndexOf("}") + 1));
    if (typeof j.errorCount === "number") return j.errorCount;
    if (Array.isArray(j.errors)) return j.errors.length;
    const sections = ["lint", "runtime", "layout", "motion", "contrast", "craft", "audio"].map((k) => j[k]?.errorCount).filter((v) => typeof v === "number") as number[];
    const sum = sections.reduce((a, b) => a + b, 0);
    if (sum > 0) return sum;
    return j.ok === false || j.passed === false ? 1 : 0;
  } catch {
    return 0;
  }
}

export async function renderOverlays(opts: RenderOverlaysOpts): Promise<RenderOverlaysResult> {
  const t0 = Date.now();
  const warnings: string[] = [];
  const done = (file: string | null, cards: number, fallback: boolean): RenderOverlaysResult => ({ file, cards, ms: Date.now() - t0, fallback, warnings });
  let cards = 0;
  try {
    const cli = locateCli();
    const gsap = findGsap(cli);
    if (!gsap) warnings.push("vendored gsap not found; the project loads GSAP from assets/gsap.min.js and may fail offline");
    fs.mkdirSync(opts.outDir, { recursive: true });
    cards = writeProject(opts, gsap, warnings);
    if (cards === 0) return done(null, 0, false);

    // check, up to two attempts (the CLI may need a moment to unpack on the first run)
    let errors = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await run(cli.cmd, [...cli.args, "check", "--json"], opts.outDir, CHECK_TIMEOUT_MS);
      if (r.code === null) {
        warnings.push(`hyperframes check could not run: ${r.out.slice(-300)}`);
        continue;
      }
      errors = checkErrorCount(r.out);
      if (errors > 0) warnings.push(`hyperframes check reported ${errors} error(s): ${r.out.slice(0, 600)}`);
      break;
    }
    if (errors > 0) return done(null, cards, true);

    const formats: [string, string][] = [["webm", "overlay.webm"], ["mov", "overlay.mov"]];
    for (const [fmt, name] of formats) {
      const file = path.join(opts.outDir, name);
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* ignore */
      }
      const r = await run(cli.cmd, [...cli.args, "render", "--format", fmt, "--fps", String(opts.fps), "-o", file, "--quiet"], opts.outDir, RENDER_TIMEOUT_MS);
      if (r.code === 0 && fs.existsSync(file) && fs.statSync(file).size > 0) return done(file, cards, false);
      warnings.push(`hyperframes render (${fmt}) failed (exit ${r.code}): ${r.out.slice(-400)}`);
    }
    return done(null, cards, true);
  } catch (e) {
    warnings.push(`hyperframes overlay pass failed: ${e instanceof Error ? e.message : String(e)}`);
    return done(null, cards, true);
  }
}

/** The ffmpeg `overlay` filter line for compositing overlay.webm/.mov (alpha) over the graded video: `[v][ov]` -> `[vo]`. */
export const OVERLAY_FILTER = "[1:v]format=yuva420p,fps=%FPS%[ov];[0:v][ov]overlay=0:0:format=auto:eof_action=pass:shortest=0[vo]";
