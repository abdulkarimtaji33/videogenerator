// Is the GPU server alive? Checks the FLUX server and the VoiceStudio server the app is pointed at (the Colab tunnels), over an address
// that really connects.   npx tsx scripts/check-gpu.ts
import "dotenv/config";
import https from "https";
import { readImageSettings } from "../src/images/settings";
import { pickReachableAddress, reachableLookup } from "../src/net/reachable";
import { readVoiceSettings } from "../src/voice/settings";

function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; ms: number; body: string }> {
  const u = new URL(url);
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const req = https.request({ method: "GET", hostname: u.hostname, port: 443, path: u.pathname + u.search, headers, lookup: reachableLookup(443) as any }, (r) => {
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => resolve({ status: r.statusCode ?? 0, ms: Date.now() - t0, body: b }));
    });
    req.setTimeout(20000, () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  const flux = readImageSettings().fluxUrl;
  const vs = readVoiceSettings().voicestudioUrl;
  for (const [name, url, path, headers] of [
    ["FLUX", flux, "/v1/models", {}],
    ["VoiceStudio", vs, "/health", {}],
    ["VoiceStudio voices (with key)", vs, "/elevenlabs/v1/voices", process.env.VOICESTUDIO_API_KEY ? { "xi-api-key": process.env.VOICESTUDIO_API_KEY } : {}],
  ] as [string, string, string, Record<string, string>][]) {
    if (!url || !url.startsWith("https")) {
      console.log(`${name}: ${url ? "local address " + url : "no address set"}`);
      continue;
    }
    try {
      const ip = await pickReachableAddress(new URL(url).hostname, { port: 443 });
      const r = await get(url + path, headers);
      console.log(`${name}: HTTP ${r.status} in ${r.ms} ms via ${ip} ${r.status === 200 ? r.body.replace(/\s+/g, " ").slice(0, 90) : ""}`);
    } catch (e: any) {
      console.log(`${name}: NOT REACHABLE (${e?.message || e}). Is the Colab session still running?`);
    }
  }
}
void main();
