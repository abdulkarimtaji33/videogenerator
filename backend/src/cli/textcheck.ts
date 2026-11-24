// Real check of the text model: reads the saved Settings, asks Ollama (or OpenAI) for a small JSON answer and a short
// Urdu line, and prints what came back and how long it took.   npm run check:text   (or: npm run check:text -- openai)
import "dotenv/config";
import { generateTextVia } from "../openai";
import { ollamaHealth } from "../providers/ollama";
import { readTextSettings } from "../text/settings";

async function main() {
  const s = readTextSettings();
  const provider = process.argv[2] === "openai" ? "openai" : process.argv[2] === "ollama" ? "ollama" : s.provider;
  console.log("settings:", JSON.stringify({ provider, ollamaUrl: s.ollamaUrl, model: s.ollamaModel, think: s.ollamaThink, numCtx: s.ollamaNumCtx }));
  if (provider === "ollama") console.log("health:", JSON.stringify(await ollamaHealth(8000)));
  const tests: [string, string, string][] = [
    ["json", "You are a terse assistant. Reply with ONLY valid JSON, no markdown.", 'Return {"ok": true, "word": "ready", "n": 3}.'],
    ["urdu", "You write spoken Urdu for a video. Reply with ONLY valid JSON, no markdown.", 'Translate to natural spoken Urdu (Urdu script) and give a Roman Urdu version with the same number of words: "Do you know why the sky is blue?" Shape: {"text": string, "roman": string}'],
  ];
  for (const [name, sys, user] of tests) {
    const t0 = Date.now();
    try {
      const out = await generateTextVia(provider, sys, user);
      console.log(`[${name}] ${((Date.now() - t0) / 1000).toFixed(1)} s ->`, out.slice(0, 400));
    } catch (e: any) {
      console.log(`[${name}] FAILED after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${e?.message || e}`);
      process.exitCode = 1;
      break;
    }
  }
}
void main();
