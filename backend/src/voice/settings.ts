// Speech (narration and character voices) settings. Kept in a small JSON file like the image and text settings, so the address of
// the VoiceStudio server (it changes every time the Colab GPU session restarts) can be updated without a migration.
// The API key is NEVER stored here: it stays in backend/.env as VOICESTUDIO_API_KEY.

import fs from "fs";
import path from "path";

export type VoiceProviderId = "voicestudio" | "edge";

export interface VoiceSettings {
  /** Which engine speaks. VoiceStudio when its address is set, else Microsoft Edge voices. */
  provider: VoiceProviderId;
  /** Base address of the VoiceStudio backend, for example https://abc.app.lhr.life (no trailing slash). */
  voicestudioUrl: string;
  /** ElevenLabs-style model id sent to VoiceStudio; "eleven_multilingual_v2" uses the engine that is active there. */
  voicestudioModel: string;
  /** VoiceStudio voice id per slot: "narrator", "male-0", "female-0", ... or a role ("male", "female"). Missing = "default". */
  voices: Record<string, string>;
}

const file = () => process.env.VOICE_SETTINGS_FILE || path.join(process.cwd(), "storage", "voice-settings.json");

const defaults = (): VoiceSettings => {
  const url = (process.env.VOICESTUDIO_URL || "").replace(/\/$/, "");
  const wanted = process.env.VOICE_PROVIDER === "edge" || process.env.VOICE_PROVIDER === "voicestudio" ? (process.env.VOICE_PROVIDER as VoiceProviderId) : undefined;
  return { provider: wanted ?? (url ? "voicestudio" : "edge"), voicestudioUrl: url, voicestudioModel: process.env.VOICESTUDIO_MODEL || "eleven_multilingual_v2", voices: {} };
};

export function readVoiceSettings(): VoiceSettings {
  const d = defaults();
  try {
    const saved = JSON.parse(fs.readFileSync(file(), "utf-8"));
    return { ...d, ...saved, voices: { ...d.voices, ...(saved.voices ?? {}) } };
  } catch {
    return d;
  }
}

export function writeVoiceSettings(patch: Partial<VoiceSettings>): VoiceSettings {
  const next = { ...readVoiceSettings(), ...patch };
  if (next.provider !== "voicestudio" && next.provider !== "edge") throw new Error(`Unknown speech provider '${next.provider}'.`);
  next.voicestudioUrl = (next.voicestudioUrl || "").replace(/\/$/, "");
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(next, null, 2));
  return next;
}
