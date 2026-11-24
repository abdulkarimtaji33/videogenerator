// Generates, scores and ranks Shorts hooks for a topic.
//   npx tsx src/cli/hooks.ts "<topic>" "<working title>" "<fact 1>" "<fact 2>" ...
import "dotenv/config";
import { generateHooks } from "../hooks/engine";

async function main() {
  const [topic, title, ...facts] = process.argv.slice(2);
  if (!topic) throw new Error('Usage: hooks.ts "<topic>" "<title>" "<fact>" ...');
  const r = await generateHooks({ topic, title, niche: "space and science curiosity", format: "short", facts, count: 12, optimizeRounds: 2 });
  console.log(`\n=== ${topic}  (rewrite rounds used: ${r.rounds})`);
  for (const h of r.ranked.slice(0, 6)) {
    const failed = h.report.checks.filter((c) => !c.ok).map((c) => c.id).join(", ");
    console.log(`${String(h.report.score).padStart(3)}/100 ${h.report.passed ? "PASS" : "    "} [${h.type}] "${h.line}"  (${h.report.words}w, grade ${h.report.readingGrade}${failed ? ", fails: " + failed : ""})\n        visual: ${h.visual}`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
