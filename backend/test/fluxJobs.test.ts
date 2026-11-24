import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakeServer = vi.hoisted(() => ({ url: "http://127.0.0.1:7860" }));

// Never read the developer's real storage/image-settings.json; point the client at the fake server instead.
vi.mock("../src/images/settings", async () => {
  const actual: any = await vi.importActual("../src/images/settings");
  const base = () => ({ defaultProvider: "flux-local", fluxUrl: fakeServer.url, fluxModel: "m", fluxSteps: 4, fluxWidth: 384, fluxHeight: 640, lastFluxMs: null });
  return { ...actual, readImageSettings: () => base(), writeImageSettings: (p: any) => ({ ...base(), ...p }) };
});

import { fluxHealth, fluxLocal } from "../src/providers/fluxLocal";

const png = Buffer.from("img").toString("base64");
let jobsFile = "";

beforeEach(() => {
  jobsFile = path.join(os.tmpdir(), `flux-jobs-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  process.env.FLUX_JOBS_FILE = jobsFile;
  process.env.FLUX_POLL_MS = "10";
  delete process.env.FLUX_TIMEOUT_MIN;
  delete process.env.FLUX_UNREACHABLE_MIN;
});
afterEach(() => {
  delete process.env.FLUX_JOBS_FILE;
  delete process.env.FLUX_POLL_MS;
  delete process.env.FLUX_TIMEOUT_MIN;
  delete process.env.FLUX_UNREACHABLE_MIN;
  fs.rmSync(jobsFile, { force: true });
});

// A tiny HTTP server that behaves like the job routes of sd-server.
async function withServer(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void, run: () => Promise<void>) {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => handler(req, Buffer.concat(chunks).toString("utf-8"), res));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  fakeServer.url = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    await run();
  } finally {
    await new Promise((ok) => server.close(ok));
    fakeServer.url = "http://127.0.0.1:7860";
  }
}
const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

describe("fluxLocal renders through the async job API of the server", () => {
  it("submits a job, polls until it completes and decodes the image (native fields, no prompt tricks)", async () => {
    const submitted: any[] = [];
    let polls = 0;
    await withServer(
      (req, body, res) => {
        if (req.method === "POST" && req.url === "/sdcpp/v1/img_gen") {
          submitted.push(JSON.parse(body));
          return json(res, 202, { id: "job_1", status: "queued", poll_url: "/sdcpp/v1/jobs/job_1" });
        }
        if (req.url === "/sdcpp/v1/jobs/job_1") {
          polls++;
          if (polls < 3) return json(res, 200, { id: "job_1", status: polls === 1 ? "queued" : "generating" });
          return json(res, 200, { id: "job_1", status: "completed", result: { images: [{ b64_json: png }] } });
        }
        json(res, 404, {});
      },
      async () => {
        const ref = path.join(os.tmpdir(), "flux-ref-test.png");
        fs.writeFileSync(ref, "ref-bytes");
        const buf = await fluxLocal.generateImage({ prompt: "a cat", aspect: "9:16", referenceImages: [ref, "missing.png"] } as any);
        expect(buf.toString()).toBe("img");
      }
    );
    expect(submitted).toHaveLength(1);
    expect(submitted[0].prompt).toBe("a cat");
    expect(submitted[0].prompt).not.toContain("sd_cpp_extra_args");
    expect(submitted[0].width).toBeGreaterThan(0);
    expect(submitted[0].height).toBeGreaterThan(submitted[0].width);
    expect(submitted[0].sample_params.sample_steps).toBeGreaterThan(0);
    expect(submitted[0].ref_images).toEqual([Buffer.from("ref-bytes").toString("base64")]);
    expect(polls).toBe(3);
    expect(fs.existsSync(jobsFile) ? JSON.parse(fs.readFileSync(jobsFile, "utf-8")) : {}).toEqual({}); // finished jobs are forgotten
  });

  it("keeps waiting through dropped polls instead of failing", async () => {
    let polls = 0;
    await withServer(
      (req, _body, res) => {
        if (req.method === "POST") return json(res, 202, { id: "job_2", status: "queued" });
        polls++;
        if (polls <= 3) return void req.socket.destroy(); // the connection drops mid-poll
        json(res, 200, { id: "job_2", status: "completed", result: { images: [{ b64_json: png }] } });
      },
      async () => {
        const buf = await fluxLocal.generateImage({ prompt: "drops", aspect: "1:1" } as any);
        expect(buf.toString()).toBe("img");
      }
    );
    expect(polls).toBe(4);
  });

  it("after a backend restart resumes the same job instead of submitting a second render", async () => {
    let posts = 0;
    let done = false;
    await withServer(
      (req, _body, res) => {
        if (req.method === "POST") {
          posts++;
          return json(res, 202, { id: "job_3", status: "queued" });
        }
        if (!done) return json(res, 200, { id: "job_3", status: "generating" });
        json(res, 200, { id: "job_3", status: "completed", result: { images: [{ b64_json: png }] } });
      },
      async () => {
        process.env.FLUX_TIMEOUT_MIN = "0.0005"; // the first attempt "dies" after about 30 ms, as if the backend was stopped
        await expect(fluxLocal.generateImage({ prompt: "resume me", aspect: "1:1" } as any)).rejects.toThrow(/not finished/);
        expect(Object.keys(JSON.parse(fs.readFileSync(jobsFile, "utf-8")))).toHaveLength(1); // the job id was saved
        process.env.FLUX_TIMEOUT_MIN = "5";
        done = true; // the render finished while the backend was down
        const buf = await fluxLocal.generateImage({ prompt: "resume me", aspect: "1:1" } as any);
        expect(buf.toString()).toBe("img");
      }
    );
    expect(posts).toBe(1);
  });

  it("submits again when the server no longer knows the job (the server restarted)", async () => {
    let posts = 0;
    await withServer(
      (req, _body, res) => {
        if (req.method === "POST") {
          posts++;
          return json(res, 202, { id: `job_${posts}`, status: "queued" });
        }
        if (req.url === "/sdcpp/v1/jobs/job_1") return json(res, 404, { error: "unknown job" });
        json(res, 200, { id: "job_2", status: "completed", result: { images: [{ b64_json: png }] } });
      },
      async () => {
        const buf = await fluxLocal.generateImage({ prompt: "lost job", aspect: "1:1" } as any);
        expect(buf.toString()).toBe("img");
      }
    );
    expect(posts).toBe(2);
  });

  it("reports the reason of the server when a job fails", async () => {
    await withServer(
      (req, _body, res) => {
        if (req.method === "POST") return json(res, 202, { id: "job_f", status: "queued" });
        json(res, 200, { id: "job_f", status: "failed", error: { message: "out of memory" } });
      },
      async () => {
        await expect(fluxLocal.generateImage({ prompt: "boom", aspect: "1:1" } as any)).rejects.toThrow(/failed: out of memory/);
      }
    );
  });

  it("gives up with a clear message when the server stays unreachable", async () => {
    process.env.FLUX_UNREACHABLE_MIN = "0.0005";
    await withServer(
      (req, _body, res) => {
        if (req.method === "POST") return json(res, 202, { id: "job_u", status: "queued" });
        req.socket.destroy();
      },
      async () => {
        await expect(fluxLocal.generateImage({ prompt: "gone", aspect: "1:1" } as any)).rejects.toThrow(/unreachable/);
      }
    );
  });

  it("falls back to the single OpenAI-style request on a server without the job API", async () => {
    const seen: string[] = [];
    await withServer(
      (req, body, res) => {
        seen.push(`${req.method} ${req.url}`);
        if (req.url === "/v1/images/generations") {
          expect(JSON.parse(body).prompt).toContain("<sd_cpp_extra_args>");
          return json(res, 200, { data: [{ b64_json: png }] });
        }
        json(res, 404, {});
      },
      async () => {
        const buf = await fluxLocal.generateImage({ prompt: "old server", aspect: "1:1" } as any);
        expect(buf.toString()).toBe("img");
      }
    );
    expect(seen).toEqual(["POST /sdcpp/v1/img_gen", "POST /v1/images/generations"]);
  });

  it("reports a clear error when the server answers 503 (no model loaded)", async () => {
    await withServer(
      (_req, _body, res) => json(res, 503, { error: "No model is loaded", code: "model_not_loaded" }),
      async () => {
        await expect(fluxLocal.generateImage({ prompt: "x", aspect: "1:1" } as any)).rejects.toThrow(/503/);
        const h = await fluxHealth();
        expect(h.online).toBe(false);
        expect(h.detail).toMatch(/no model/);
      }
    );
  });
});
