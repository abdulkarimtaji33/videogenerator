// Self-hosted FLUX client for a stable-diffusion.cpp `sd-server`. Renders go through the server's async job API
// (POST /sdcpp/v1/img_gen, then poll GET /sdcpp/v1/jobs/{id}), so a render may take hours without any connection being held
// open, and it survives dropped polls, a server restart and a backend restart. The same code works for a server on this PC
// (CPU) or on a rented GPU box: only the URL changes.

import { createHash } from "crypto";
import fs from "fs";
import http from "http";
import https from "https";
import os from "os";
import path from "path";
import { readImageSettings, writeImageSettings } from "../images/settings";
import { reachableLookup } from "../net/reachable";
import { ff } from "../shorts/ffmpeg";
import type { ImageProvider, ProviderStatus } from "./types";

let busy: Promise<unknown> = Promise.resolve();
/** One image at a time: a CPU server cannot render two at once, and a queue keeps the order simple. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = busy.then(fn, fn);
  busy = run.catch(() => undefined);
  return run;
}

export async function fluxHealth(timeoutMs = 2500): Promise<{ online: boolean; detail: string }> {
  const { fluxUrl } = readImageSettings();
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    // /v1/models answers 200 with data[] only when a model is loaded; 503 {code:"model_loading"|"model_not_loaded"} otherwise.
    const r = await fetch(fluxUrl.replace(/\/$/, "") + "/v1/models", { signal: ctl.signal });
    clearTimeout(t);
    if (r.status === 503) {
      const j: any = await r.json().catch(() => ({}));
      return { online: false, detail: j?.code === "model_loading" ? "model is still loading" : "server is up but no model is loaded" };
    }
    if (!r.ok) return { online: false, detail: `HTTP ${r.status}` };
    const j: any = await r.json().catch(() => ({}));
    const ready = Array.isArray(j?.data) && j.data.length > 0;
    return { online: ready, detail: ready ? "ready" : "server is up but no model is loaded" };
  } catch (e: any) {
    return { online: false, detail: e?.name === "AbortError" ? "timed out" : String(e?.cause?.code || e?.message || e) };
  }
}

const roundTo = (n: number, m: number) => Math.max(m, Math.round(n / m) * m);

/** Size FLUX renders at for a requested aspect (the pipeline scales the result to its final size afterwards). */
export function renderSize(aspect: "9:16" | "16:9" | "1:1" | undefined): { width: number; height: number } {
  const s = readImageSettings();
  const long = roundTo(Math.max(s.fluxWidth, s.fluxHeight), 64);
  const short = roundTo(Math.min(s.fluxWidth, s.fluxHeight), 64);
  if (aspect === "16:9") return { width: long, height: short };
  if (aspect === "1:1") return { width: short, height: short };
  return { width: short, height: long };
}

// Node's built-in fetch gives up after 5 minutes without response headers, so every request here uses node:http with our own
// timeout. Short calls (submit, poll) use short timeouts; a render is never one long call (see renderAsync).
export class FluxHttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function requestJson(method: "GET" | "POST", url: string, body: unknown, timeoutMs: number): Promise<any> {
  const u = new URL(url);
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const lib = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {};
    const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
    // A tunnel name can resolve to an address this PC cannot reach: connect only over an address that answers (see net/reachable.ts).
    const req = lib.request({ method, hostname: u.hostname, port, path: u.pathname + u.search, headers, lookup: reachableLookup(port) as any }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        const status = res.statusCode ?? 500;
        if (status >= 400) return reject(new FluxHttpError(`FLUX server ${status}: ${text.slice(0, 300)}`, status));
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new FluxHttpError("FLUX server returned an unreadable answer.", status));
        }
      });
      res.on("error", reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`FLUX request timed out after ${Math.round(timeoutMs / 1000)} s.`)));
    req.on("error", reject);
    req.end(payload ?? undefined);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- a running render's job id is kept on disk, keyed by the request, so a backend restart resumes it ----
const jobsFile = () => process.env.FLUX_JOBS_FILE || path.join(process.cwd(), "storage", "flux-jobs.json");

function readJobs(): Record<string, { id: string; created: number }> {
  try {
    return JSON.parse(fs.readFileSync(jobsFile(), "utf-8"));
  } catch {
    return {};
  }
}
function writeJobs(j: Record<string, { id: string; created: number }>) {
  try {
    fs.mkdirSync(path.dirname(jobsFile()), { recursive: true });
    fs.writeFileSync(jobsFile(), JSON.stringify(j));
  } catch {
    /* best effort: without it a restart just starts the render again */
  }
}
const rememberJob = (key: string, id: string) => writeJobs({ ...readJobs(), [key]: { id, created: Date.now() } });
const forgetJob = (key: string) => {
  const j = readJobs();
  if (key in j) {
    delete j[key];
    writeJobs(j);
  }
};

/**
 * Renders through the server's job API: submit (answers at once), then poll every few seconds until it is done.
 * No connection stays open for the render, so it can run for hours. A dropped poll is retried; a job the server no longer
 * knows (it restarted) is submitted again; a backend restart resumes the same job from its saved id.
 */
async function renderAsync(base: string, body: Record<string, unknown>, key: string): Promise<string> {
  const maxMs = (Number(process.env.FLUX_TIMEOUT_MIN) || 720) * 60_000; // 12 hours
  const pollMs = Number(process.env.FLUX_POLL_MS) || 5000;
  const unreachableMs = (Number(process.env.FLUX_UNREACHABLE_MIN) || 15) * 60_000;
  const deadline = Date.now() + maxMs;
  let jobId: string | undefined = readJobs()[key]?.id;
  let resubmits = 0;
  let downSince = 0;
  for (;;) {
    if (!jobId) {
      const sub = await requestJson("POST", base + "/sdcpp/v1/img_gen", body, 60_000);
      if (!sub?.id) throw new Error("FLUX server did not return a job id.");
      jobId = String(sub.id);
      rememberJob(key, jobId);
    }
    let lost = false;
    while (Date.now() < deadline) {
      let job: any;
      try {
        job = await requestJson("GET", `${base}/sdcpp/v1/jobs/${encodeURIComponent(jobId)}`, undefined, 30_000);
        downSince = 0;
      } catch (e: any) {
        if (e instanceof FluxHttpError && (e.status === 404 || e.status === 410)) {
          lost = true; // the server forgot this job (it was restarted): start the render again, but not forever
          break;
        }
        if (!downSince) downSince = Date.now();
        if (Date.now() - downSince > unreachableMs) throw new Error(`FLUX server has been unreachable for ${Math.round(unreachableMs / 60000)} minutes (${e?.message || e}).`);
        await sleep(pollMs);
        continue;
      }
      if (job.status === "completed") {
        const b64 = job?.result?.images?.[0]?.b64_json;
        forgetJob(key);
        if (!b64) throw new Error("FLUX job finished without an image.");
        return b64;
      }
      if (job.status === "failed" || job.status === "cancelled") {
        forgetJob(key);
        throw new Error(`FLUX job ${job.status}: ${job?.error?.message || job?.error?.code || "no reason given"}`);
      }
      await sleep(pollMs);
    }
    if (!lost) throw new Error(`FLUX image not finished after ${Math.round(maxMs / 3_600_000)} hours.`);
    forgetJob(key);
    jobId = undefined;
    if (++resubmits > 3) throw new Error("FLUX server keeps losing the job (is it restarting?).");
  }
}

/** Older servers and other builds only have the OpenAI-style route: one long request, with our own long timeout. */
async function renderSync(base: string, prompt: string, width: number, height: number, steps: number, refB64: string[]): Promise<string> {
  const extra: Record<string, unknown> = { sample_params: { sample_steps: steps, guidance: { txt_cfg: 1.0 } } };
  if (refB64.length) extra.ref_images = refB64;
  const body = { prompt: `${prompt} <sd_cpp_extra_args>${JSON.stringify(extra)}</sd_cpp_extra_args>`, n: 1, size: `${width}x${height}`, output_format: "png" };
  const json = await requestJson("POST", base + "/v1/images/generations", body, (Number(process.env.FLUX_TIMEOUT_MIN) || 720) * 60_000);
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error("FLUX server returned no image data.");
  return b64;
}

const refCache = new Map<string, Buffer>();

/**
 * A reference only needs the render's resolution, so it is shrunk to fit it (never enlarged) before it is sent: the pipeline
 * stores anchors at 1024x1536, and sending that is wasteful. NOTE: measured on this PC, shot images with references took about
 * 16 minutes both before and after this (against 8.6 minutes without references), so sd-server evidently resizes references
 * itself; this only makes the request smaller. The real cost is the references themselves (each adds about one render's worth
 * of image tokens), so fewer references per shot is what would make shots faster. When the file is not an image ffmpeg can
 * read, the original bytes are sent unchanged.
 */
export async function fitReference(file: string, width: number, height: number): Promise<Buffer> {
  const original = fs.readFileSync(file);
  const st = fs.statSync(file);
  const key = `${file}|${st.size}|${st.mtimeMs}|${width}x${height}`;
  const hit = refCache.get(key);
  if (hit) return hit;
  let out = original;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fluxref-"));
  try {
    const dst = path.join(dir, "ref.png");
    await ff(["-i", file, "-vf", `scale=w=min(iw\\,${width}):h=min(ih\\,${height}):force_original_aspect_ratio=decrease:force_divisible_by=16`, "-frames:v", "1", dst]);
    const small = fs.readFileSync(dst);
    if (small.length > 0) out = small;
  } catch {
    out = original;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  refCache.set(key, out);
  return out;
}

export const fluxLocal: ImageProvider = {
  id: "flux-local",
  label: "FLUX (self-hosted)",
  status(): ProviderStatus {
    // Reachability is async; the system route fills in `online`. Configured means a URL is set.
    return readImageSettings().fluxUrl ? { ok: true } : { ok: false, reason: "FLUX_URL is not set." };
  },
  generateImage(req) {
    return serial(async () => {
      const s = readImageSettings();
      const { width, height } = renderSize(req.aspect);
      const base = s.fluxUrl.replace(/\/$/, "");
      const started = Date.now();
      const refs = req.referenceImages?.length ? req.referenceImages : req.referenceImage ? [req.referenceImage] : [];
      // Reference images (anchors, up to 10) are sent as base64 `ref_images`; FLUX.3 Klein conditions on them.
      const refB64 = (await Promise.all(refs.filter((p) => fs.existsSync(p)).slice(0, 10).map((p) => fitReference(p, width, height)))).map((b) => b.toString("base64"));
      const body: Record<string, unknown> = {
        prompt: req.prompt,
        width,
        height,
        batch_count: 1,
        sample_params: { sample_steps: s.fluxSteps, guidance: { txt_cfg: 1.0 } }, // FLUX.3 Klein is distilled: CFG 1.0
      };
      if (refB64.length) body.ref_images = refB64;
      // The same request (prompt, size, steps, references) resumes the same job after a backend restart.
      const key = createHash("sha1")
        .update(JSON.stringify([base, req.prompt, width, height, s.fluxSteps, refB64.map((b) => createHash("sha1").update(b).digest("hex"))]))
        .digest("hex");
      let b64: string;
      try {
        b64 = await renderAsync(base, body, key);
      } catch (e: any) {
        // Only a server without the job API falls back to the single long request.
        if (e instanceof FluxHttpError && (e.status === 404 || e.status === 405)) b64 = await renderSync(base, req.prompt, width, height, s.fluxSteps, refB64);
        else throw e;
      }
      writeImageSettings({ lastFluxMs: Date.now() - started });
      return Buffer.from(b64, "base64");
    });
  },
};
