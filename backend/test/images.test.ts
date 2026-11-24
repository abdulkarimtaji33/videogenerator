import fs from "fs";
import http from "http";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { id: string; refs?: string[]; aspect?: string }[] = [];
let fluxFails = false;
let openaiFails = false;

// Never read the developer's real storage/image-settings.json (it may say defaultProvider "openai").
const fakeServer = vi.hoisted(() => ({ url: "http://127.0.0.1:7860" }));
vi.mock("../src/images/settings", async () => {
  const actual: any = await vi.importActual("../src/images/settings");
  const base = () => ({ defaultProvider: "flux-local", fluxUrl: fakeServer.url, fluxModel: "m", fluxSteps: 16, fluxWidth: 576, fluxHeight: 1024, lastFluxMs: null });
  return { ...actual, readImageSettings: () => base(), writeImageSettings: (p: any) => ({ ...base(), ...p }) };
});

vi.mock("../src/providers", () => ({
  IMAGE_PROVIDERS: {
    "flux-local": {
      id: "flux-local",
      label: "FLUX (self-hosted)",
      status: () => ({ ok: true }),
      generateImage: async (req: any) => {
        calls.push({ id: "flux-local", refs: req.referenceImages, aspect: req.aspect });
        if (fluxFails) throw new Error("FLUX server is not reachable");
        return Buffer.from("flux-png");
      },
    },
    openai: {
      id: "openai",
      label: "OpenAI images",
      status: () => ({ ok: true }),
      generateImage: async (req: any) => {
        calls.push({ id: "openai", refs: req.referenceImages, aspect: req.aspect });
        if (openaiFails) throw new Error("openai down");
        return Buffer.from("openai-png");
      },
    },
  },
}));

// FLUX output is scaled with ffmpeg; the test only needs the file to pass through.
vi.mock("../src/shorts/ffmpeg", () => ({
  ff: async (args: string[]) => {
    fs.copyFileSync(args[1], args[args.length - 1]);
  },
}));

import { makeImage } from "../src/images";
import { renderSize } from "../src/providers/fluxLocal";

beforeEach(() => {
  calls.length = 0;
  fluxFails = false;
  openaiFails = false;
  delete process.env.IMAGE_PROVIDER;
});

describe("makeImage", () => {
  it("uses self-hosted FLUX by default and says so", async () => {
    const r = await makeImage({ prompt: "p", size: "1024x1536" });
    expect(r.provider).toBe("flux-local");
    expect(r.fellBack).toBe(false);
    expect(r.buffer.toString()).toBe("flux-png");
    expect(calls).toEqual([{ id: "flux-local", refs: undefined, aspect: "9:16" }]);
  });

  it("uses the project's choice instead of the default", async () => {
    const r = await makeImage({ prompt: "p", size: "1536x1024", provider: "openai" });
    expect(r.provider).toBe("openai");
    expect(calls[0].aspect).toBe("16:9");
  });

  it("passes every reference image to the provider", async () => {
    await makeImage({ prompt: "p", size: "1024x1024", refs: ["a.png", "b.png"], provider: "openai" });
    expect(calls[0].refs).toEqual(["a.png", "b.png"]);
  });

  it("stops with a hint when FLUX is down and fallback is off (never bills OpenAI silently)", async () => {
    fluxFails = true;
    await expect(makeImage({ prompt: "p", size: "1024x1536", fallback: false })).rejects.toThrow(/npm run flux/);
    expect(calls.map((c) => c.id)).toEqual(["flux-local"]);
  });

  it("falls back to OpenAI when FLUX is down and fallback is on", async () => {
    fluxFails = true;
    const r = await makeImage({ prompt: "p", size: "1024x1536", fallback: true });
    expect(r.provider).toBe("openai");
    expect(r.fellBack).toBe(true);
    expect(calls.map((c) => c.id)).toEqual(["flux-local", "openai"]);
  });

  it("does not retry OpenAI with OpenAI", async () => {
    openaiFails = true;
    await expect(makeImage({ prompt: "p", size: "1024x1024", provider: "openai", fallback: true })).rejects.toThrow(/openai down/);
    expect(calls.map((c) => c.id)).toEqual(["openai"]);
  });
});

describe("renderSize", () => {
  it("renders portrait, landscape and square at multiples of 64", () => {
    const p = renderSize("9:16");
    const l = renderSize("16:9");
    const s = renderSize("1:1");
    expect(p.height).toBeGreaterThan(p.width);
    expect(l.width).toBeGreaterThan(l.height);
    expect(s.width).toBe(s.height);
    for (const v of [p.width, p.height, l.width, l.height, s.width]) expect(v % 64).toBe(0);
  });
});

