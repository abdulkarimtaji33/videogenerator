// Image model settings (default provider, FLUX server address). Kept in a small JSON file so no DB migration is needed
// for settings, and so the values survive restarts. Environment variables give the initial values.

import fs from "fs";
import path from "path";
const STORAGE_ROOT = path.join(process.cwd(), "storage", "generated");

export type ImageProviderId = "flux-local" | "openai" | "fal";
export const IMAGE_PROVIDER_IDS: ImageProviderId[] = ["flux-local", "openai", "fal"];

export interface ImageSettings {
  defaultProvider: ImageProviderId;
  fluxUrl: string;
  fluxModel: string;
  fluxSteps: number;
  /** Size FLUX renders at (multiples of 64); results are scaled to the size the pipeline asked for. */
  fluxWidth: number;
  fluxHeight: number;
  lastFluxMs: number | null;
}

const FILE = path.join(STORAGE_ROOT, "..", "image-settings.json");

const defaults = (): ImageSettings => ({
  defaultProvider: (IMAGE_PROVIDER_IDS as string[]).includes(process.env.IMAGE_PROVIDER || "") ? (process.env.IMAGE_PROVIDER as ImageProviderId) : "flux-local",
  fluxUrl: process.env.FLUX_URL || "http://127.0.0.1:7860",
  fluxModel: process.env.FLUX_MODEL || "flux-3-image-klein-q4" /* label only; the server loads whatever start.ps1 gave it */,
  fluxSteps: Number(process.env.FLUX_STEPS) || 16, // FLUX.3 Klein distilled: 16 steps at CFG 1.0 is the tested setting
  fluxWidth: Number(process.env.FLUX_WIDTH) || 576,
  fluxHeight: Number(process.env.FLUX_HEIGHT) || 1024,
  lastFluxMs: null,
});

export function readImageSettings(): ImageSettings {
  const d = defaults();
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, "utf-8"));
    return { ...d, ...saved };
  } catch {
    return d;
  }
}

export function writeImageSettings(patch: Partial<ImageSettings>): ImageSettings {
  const next = { ...readImageSettings(), ...patch };
  if (!(IMAGE_PROVIDER_IDS as string[]).includes(next.defaultProvider)) throw new Error(`Unknown image provider '${next.defaultProvider}'.`);
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  } catch {
    /* settings are best effort */
  }
  return next;
}
