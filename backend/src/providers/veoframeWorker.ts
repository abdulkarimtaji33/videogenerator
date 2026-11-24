/// <reference lib="dom" />
// (The page.evaluate callbacks below run inside the browser, so they use DOM types.)
// Drives the Veoframe web Studio in the worker's own Chrome profile (separate from the owner's normal Chrome, so
// the owner can keep using their browser). The owner signs in once with `node scripts/veoframe-login.js`; the
// session lives in storage/browser-profile/veoframe (gitignored). This class never types a password.
//
// One browser, one job at a time, with a pause between submissions, which keeps usage close to a person working
// by hand (Veoframe's fair-use note restricts automated abuse and excessive parallel use).
//
// Page facts (mapped 2026-11-22): Studio at /user/generate.php, form #studioForm posts to /api/generate.php?ajax=1.
// Controls: button.input-tab[data-mode=video], #modelSelect (Veo 3.1 Fast = model_4), #qualitySelect, #aspectSelect,
// #durationSelect, #promptTextarea, #sourceFile (start frame), #generateSubmitBtn. A community announcement overlay
// (#vfWhatsAppPrompt) can cover the page and is closed with #vfWaClose. Job cards carry data-job-id; a finished job
// page (/user/job.php?id=ID) has a Download link (/media.php?id=ID&dl=1).

import fs from "fs";
import path from "path";
import type { BrowserContext, Page } from "playwright-core";
import { logger } from "../log";
import { ff, probe } from "../shorts/ffmpeg";

const BASE = "https://veoframe.com";
const STUDIO = `${BASE}/user/generate.php`;
export const PROFILE_DIR = path.join(process.cwd(), "storage", "browser-profile", "veoframe");

export const VEO_FAST_MODEL_VALUE = "model_4";

export interface VeoframeRequest {
  prompt: string;
  outFile: string;
  /** Image used as the first frame (image-to-video). */
  startFrame?: string;
  aspect: "9:16" | "16:9";
  /** 720p works today; 1080p was rejected by Veoframe (provider balance error) on 2026-11-22. */
  quality?: "720p" | "1080p";
  /** Optional progress callback, for logs and the UI. */
  onStatus?: (message: string) => void;
}

export class VeoframeSignedOutError extends Error {
  constructor() {
    super("Veoframe is signed out. Run `node scripts/veoframe-login.js` in backend/ and sign in once.");
    this.name = "VeoframeSignedOutError";
  }
}

let contextPromise: Promise<BrowserContext> | null = null;
let chain: Promise<unknown> = Promise.resolve();
let lastSubmitAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getContext(): Promise<BrowserContext> {
  if (!contextPromise) {
    contextPromise = (async () => {
      const { chromium } = await import("playwright-core");
      fs.mkdirSync(PROFILE_DIR, { recursive: true });
      const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
        channel: "chrome",
        headless: process.env.VEOFRAME_HEADLESS === "true",
        viewport: { width: 1280, height: 900 },
        acceptDownloads: true,
        chromiumSandbox: true,
        ignoreDefaultArgs: ["--enable-automation"],
        args: ["--hide-crash-restore-bubble"],
      });
      ctx.on("close", () => {
        contextPromise = null;
      });
      return ctx;
    })();
    contextPromise.catch(() => {
      contextPromise = null;
    });
  }
  return contextPromise;
}

export async function closeVeoframeBrowser(): Promise<void> {
  if (!contextPromise) return;
  const p = contextPromise;
  contextPromise = null;
  try {
    await (await p).close();
  } catch {
    /* already closed */
  }
}

async function dismissOverlay(page: Page): Promise<void> {
  // The announcement overlay intercepts every click until it is closed with its X.
  const close = page.locator("#vfWaClose");
  if (await close.isVisible().catch(() => false)) {
    await close.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(400);
  }
}

async function openStudio(page: Page): Promise<void> {
  await page.goto(STUDIO, { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname.includes("login")) throw new VeoframeSignedOutError();
  await page.waitForSelector("#promptTextarea", { state: "attached", timeout: 30_000 });
  await page.waitForTimeout(1200); // the overlay appears shortly after load
  await dismissOverlay(page);
}

/** Centre-crops an image to exactly 9:16 or 16:9 (even dimensions) and returns the cropped file. */
export async function fitStartFrame(src: string, aspect: "9:16" | "16:9", outDir: string): Promise<string> {
  const info = await probe(src);
  const ratio = aspect === "9:16" ? 9 / 16 : 16 / 9;
  let cw = info.width;
  let ch = info.height;
  if (info.width / info.height > ratio) cw = Math.floor((info.height * ratio) / 2) * 2;
  else ch = Math.floor(info.width / ratio / 2) * 2;
  if (cw === info.width && ch === info.height) return src;
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `startframe-${path.basename(src, path.extname(src))}-${aspect.replace(":", "x")}.png`);
  await ff(["-i", src, "-vf", `crop=${cw}:${ch}`, "-frames:v", "1", out]);
  return out;
}

async function setUpVideoForm(page: Page, req: VeoframeRequest): Promise<void> {
  await dismissOverlay(page);
  await page.locator('button.input-tab[data-mode="video"]').click({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.locator("#subtabTextBtn").click({ timeout: 5000 }).catch(() => undefined); // Frame & Text
  await page.selectOption("#modelSelect", VEO_FAST_MODEL_VALUE);
  await page.selectOption("#qualitySelect", req.quality ?? "720p");
  await page.selectOption("#aspectSelect", req.aspect);
  await page.selectOption("#durationSelect", "8");
  if (req.startFrame) {
    if (!fs.existsSync(req.startFrame)) throw new Error(`Start frame not found: ${req.startFrame}`);
    // Veoframe pads a start frame whose shape differs from the video (a dark strip), so crop it to the exact shape.
    const fitted = await fitStartFrame(req.startFrame, req.aspect, path.dirname(req.outFile));
    await page.setInputFiles("#sourceFile", fitted);
    await page.waitForTimeout(800);
  }
  await page.fill("#promptTextarea", req.prompt);
}

async function currentJobIds(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll("[data-job-id]")).map((e) => (e as HTMLElement).dataset.jobId || "").filter(Boolean));
}

/** Submits the form and returns the new job id (from the response when possible, otherwise from the new card). */
async function submit(page: Page): Promise<string> {
  const before = new Set(await currentJobIds(page));
  const responsePromise = page.waitForResponse((r) => r.url().includes("/api/generate.php") && r.request().method() === "POST", { timeout: 60_000 }).catch(() => null);
  await dismissOverlay(page);
  await page.locator("#generateSubmitBtn").click({ timeout: 15_000 });
  const res = await responsePromise;
  let responseText = "";
  if (res) {
    responseText = await res.text().catch(() => "");
    try {
      const j = JSON.parse(responseText);
      const id = j?.job_id ?? j?.jobId ?? j?.id ?? j?.job?.id;
      if (id) return String(id);
    } catch {
      /* not JSON; fall back to the card */
    }
  }
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const failure = await page.evaluate(() => (document.querySelector(".card-error, .job-error, [data-status='failed']") as HTMLElement | null)?.innerText || "");
    const ids = await currentJobIds(page);
    const fresh = ids.find((id) => !before.has(id));
    if (fresh) return fresh;
    if (failure) throw new Error(`Veoframe rejected the request: ${failure.slice(0, 300)}`);
  }
  throw new Error(`Veoframe did not create a job. Response was: ${responseText.slice(0, 300) || "(none)"}`);
}

async function waitAndDownload(page: Page, jobId: string, outFile: string, onStatus?: (m: string) => void): Promise<void> {
  const jobUrl = `${BASE}/user/job.php?id=${jobId}`;
  const started = Date.now();
  const limit = 20 * 60 * 1000;
  while (Date.now() - started < limit) {
    await page.goto(jobUrl, { waitUntil: "domcontentloaded" });
    await dismissOverlay(page);
    const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    // The Download link exists on the page while the clip is still rendering; only a visible link on a page that
    // says "completed" means the file is ready.
    const link = page.locator('a[href*="media.php"][href*="dl=1"]');
    if (text.includes("completed") && (await link.first().isVisible().catch(() => false))) {
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), link.first().click()]);
      await download.saveAs(outFile);
      const size = fs.statSync(outFile).size;
      if (size < 50_000) throw new Error(`Veoframe download looks incomplete (${size} bytes).`);
      return;
    }
    if (text.includes("failed")) throw new Error("Veoframe reports that the video generation failed (the quota unit is refunded).");
    onStatus?.(`Rendering on Veoframe (job ${jobId})...`);
    await sleep(8000);
  }
  throw new Error(`Timed out after ${Math.round(limit / 60000)} minutes waiting for Veoframe job ${jobId}.`);
}

async function runOne(req: VeoframeRequest): Promise<{ jobId: string; file: string }> {
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    // Pace submissions like a person: at least pacing seconds since the last one.
    const pacingMs = Number(process.env.VEOFRAME_PACING_SECONDS || 8) * 1000;
    const wait = lastSubmitAt + pacingMs - Date.now();
    if (wait > 0) await sleep(wait);
    req.onStatus?.("Opening the Veoframe Studio...");
    await openStudio(page);
    req.onStatus?.("Filling in the prompt and settings...");
    await setUpVideoForm(page, req);
    req.onStatus?.("Submitting to Veoframe...");
    const jobId = await submit(page);
    lastSubmitAt = Date.now();
    logger.info("veoframe submitted", { jobId, aspect: req.aspect, startFrame: Boolean(req.startFrame) });
    await waitAndDownload(page, jobId, req.outFile, req.onStatus);
    logger.info("veoframe downloaded", { jobId, file: req.outFile });
    return { jobId, file: req.outFile };
  } catch (e) {
    const shot = path.join(path.dirname(req.outFile), `veoframe-error-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => undefined);
    logger.error("veoframe failed", { error: e instanceof Error ? e.message : String(e), screenshot: shot });
    throw e;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Generates one clip on Veoframe. Calls are serialized: only one job runs in the browser at a time. */
export function generateOnVeoframe(req: VeoframeRequest): Promise<{ jobId: string; file: string }> {
  const run = chain.then(() => runOne(req));
  chain = run.catch(() => undefined);
  return run;
}
