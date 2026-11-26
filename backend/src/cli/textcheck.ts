// Real check of the text model: reads the saved Settings, asks Ollama (or OpenAI) for a small JSON answer and a short
// Urdu line, and prints what came back and how long it took.   npm run check:text   (or: npm run check:text -- openai)
import "dotenv/config";
import { generateTextVia } from "../openai";
import { ollamaHealth } from "../providers/ollama";
import { readTextSettings } from "../text/settings";
import { pickProfile } from "../niche/profiles";
import { briefPrompt } from "../prompts";

async function main() {
  const s = readTextSettings();
  const provider = (["openai", "ollama", "gemini"] as const).find((p) => p === process.argv[2]) ?? s.provider;
  console.log("settings:", JSON.stringify(provider === "gemini" ? { provider, model: s.geminiModel, thinking: s.geminiThinking, keySet: !!process.env.GEMINI_API_KEY } : { provider, ollamaUrl: s.ollamaUrl, model: s.ollamaModel, think: s.ollamaThink, numCtx: s.ollamaNumCtx }));
  if (provider === "ollama") console.log("health:", JSON.stringify(await ollamaHealth(8000)));
  const tests: [string, string, string][] = [
    ["json", "You are a terse assistant. Reply with ONLY valid JSON, no markdown.", 'Return {"ok": true, "word": "ready", "n": 3}.'],
    ["urdu", "You write spoken Urdu for a video. Reply with ONLY valid JSON, no markdown.", 'Translate to natural spoken Urdu (Urdu script) and give a Roman Urdu version with the same number of words: "Do you know why the sky is blue?" Shape: {"text": string, "roman": string}'],
  ];
  // A real pipeline prompt (the creative brief): the speed and JSON validity that matter for a video.
  if (process.argv.includes("--brief")) {
    const profile = pickProfile("Two stylised robot friends find a glowing door in an abandoned school", "character_series");
    const p = briefPrompt({ idea: "Two stylised robot friends, Chotu and Pari, find a glowing door hidden in an old abandoned school. Funny and spooky mystery with a twist ending.", profile, format: "short", lengthSeconds: 48 });
    tests.push(["brief", p.system, p.user]);
  }
  for (const [name, sys, user] of tests) {
    const t0 = Date.now();
    try {
      const out = await generateTextVia(provider, sys, user);
      let valid = "";
      if (name === "brief") {
        try {
          JSON.parse(out.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
          valid = " [valid JSON]";
        } catch {
          valid = " [INVALID JSON]";
        }
      }
      console.log(`[${name}] ${((Date.now() - t0) / 1000).toFixed(1)} s, ${out.length} chars${valid} ->`, out.slice(0, name === "brief" ? 700 : 400));
    } catch (e: any) {
      console.log(`[${name}] FAILED after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${e?.message || e}`);
      process.exitCode = 1;
      break;
    }
  }
}
void main();
