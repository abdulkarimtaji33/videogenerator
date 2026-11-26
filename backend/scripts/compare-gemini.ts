// Real comparison of Gemini models on this project's own prompts (uses GEMINI_API_KEY from backend/.env, no fake server).
//   npx tsx scripts/compare-gemini.ts gemini-2.5-pro gemini-2.5-flash ...
// Per model: (1) the creative-brief prompt: time and whether the reply is valid JSON; (2) the Urdu localization of a 6-shot
// two-character script: time, rule violations (word counts, length, Latin letters, Roman line = English line) and the lines.
import "dotenv/config";
import { geminiGenerate } from "../src/providers/gemini";
import { pickProfile } from "../src/niche/profiles";
import { briefPrompt } from "../src/prompts";
import { parseJsonLoose } from "../src/jsonLoose";
import { localizeScript, maxSpokenWords, romanLooksEnglish } from "../src/script/localize";
import type { CreativeBrief, Script } from "../src/niche/types";

const brief: CreativeBrief = {
  niche: "character_series",
  format: "short",
  lengthSeconds: 48,
  promise: "Two stylised robot friends discover a glowing door in an abandoned school and face a twist ending.",
  audience: "general",
  subjectMode: "cast",
  anchors: [
    { key: "robot-chotu", kind: "character", name: "Chotu", lockedFeatures: "small blue round robot", needsReference: true, gender: "male" },
    { key: "robot-pari", kind: "character", name: "Pari", lockedFeatures: "slender silver robot with one horn", needsReference: true, gender: "female" },
  ],
  styleBible: "Cinematic stylised, soft volumetric light, vertical 9:16 framing.",
  tone: "funny, spooky",
  avoid: [],
};
const EN = [
  "Why does a glowing door hide in an abandoned school? Two robot friends are about to find out.",
  "They see something the door cannot show.",
  "Chotu asks if the light will last forever.",
  "Pari steps forward and the light turns red.",
  "The door slides open and Chotu does not move.",
  "Now one robot never moves again, and Pari is left alone.",
];
const script: Script = {
  format: "short",
  promise: brief.promise,
  hook: { type: "curiosity_gap", line: EN[0], visual: "a glowing door" },
  shots: EN.map((n, i) => ({
    index: i + 1,
    role: (["hook", "foreshadow", "body", "body", "payoff", "loop"] as const)[i],
    link: i === 0 ? null : "therefore",
    narration: n,
    visual: ["Two small robots face a glowing door", "Camera circles the door", "Chotu tilts his head to the light", "Pari raises an arm, the glow turns red", "The door opens, Chotu stands still", "Pari looks at frozen Chotu"][i],
    anchorKeys: i === 2 ? ["robot-chotu"] : i === 3 ? ["robot-pari"] : ["robot-chotu", "robot-pari"],
    continuesPrevious: false,
  })),
};

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

async function main() {
  const models = process.argv.slice(2);
  if (!models.length) throw new Error("usage: compare-gemini.ts <model> [<model> ...]");
  const summary: string[] = [];
  for (const model of models) {
    console.log(`\n===== ${model}`);
    // 1. brief
    let briefLine = "";
    try {
      const p = briefPrompt({ idea: "Two stylised robot friends, Chotu and Pari, find a glowing door hidden in an old abandoned school. Funny and spooky mystery with a twist ending.", profile: pickProfile("robot friends", "character_series"), format: "short", lengthSeconds: 48 });
      const t0 = Date.now();
      const out = await geminiGenerate(p.system, p.user, { model });
      let valid = "valid JSON";
      try {
        parseJsonLoose(out);
        JSON.parse(out.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
      } catch {
        valid = "NOT strictly valid JSON (the app would repair it)";
      }
      briefLine = `brief ${((Date.now() - t0) / 1000).toFixed(1)} s, ${valid}`;
    } catch (e: any) {
      briefLine = `brief FAILED: ${String(e?.message || e).slice(0, 120)}`;
    }
    console.log(briefLine);
    // 2. Urdu
    let urduLine = "";
    try {
      const t0 = Date.now();
      const out = await localizeScript(script, brief, "ur", (s, u) => geminiGenerate(s, u, { model }));
      const max = maxSpokenWords("ur");
      let bad = 0;
      for (const s of out.shots) {
        const probs: string[] = [];
        if (words(s.spoken || "") > max) probs.push("too long");
        if (words(s.spoken || "") !== words(s.roman || "")) probs.push("word count mismatch");
        if (/[A-Za-z]{3,}/.test(s.spoken || "")) probs.push("Latin letters");
        if (romanLooksEnglish(s.roman || "", s.narration)) probs.push("roman is English");
        if (probs.length) bad++;
        console.log(`  ${s.index}. ${s.speaker}${probs.length ? "  !! " + probs.join(", ") : ""}\n     ${s.spoken}\n     ${s.roman}`);
      }
      urduLine = `urdu ${((Date.now() - t0) / 1000).toFixed(1)} s, ${bad} of ${out.shots.length} lines break a rule`;
    } catch (e: any) {
      urduLine = `urdu FAILED: ${String(e?.message || e).slice(0, 120)}`;
    }
    console.log(urduLine);
    summary.push(`${model}: ${briefLine}; ${urduLine}`);
  }
  console.log("\n===== SUMMARY\n" + summary.join("\n"));
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
