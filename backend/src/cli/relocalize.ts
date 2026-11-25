// Re-translates the spoken lines of an Urdu or Hindi project with the current prompt, optionally fixing character genders,
// and updates the saved script and the shot rows (voiceover, captions, speaker). Images and clips are not touched.
//   npx tsx src/cli/relocalize.ts 13 --gender robot-chotu=male,robot-pari=female
import "dotenv/config";
import fs from "fs";
import { query } from "../db";
import { generateText } from "../openai";
import { isLanguage } from "../providers/voices";
import { localizeScript, maxSpokenWords } from "../script/localize";
import type { CreativeBrief, Script } from "../niche/types";

async function main() {
  const id = Number(process.argv[2]);
  if (!id) throw new Error("usage: relocalize.ts <projectId> [--gender key=male,key2=female]");
  const gi = process.argv.indexOf("--gender");
  const genders = new Map<string, "male" | "female" | "neutral">();
  if (gi > 0 && process.argv[gi + 1]) for (const part of process.argv[gi + 1].split(",")) {
    const [k, g] = part.split("=");
    if (k && (g === "male" || g === "female" || g === "neutral")) genders.set(k, g);
  }
  const [p] = await query<any[]>("SELECT * FROM projects WHERE id = ?", [id]);
  if (!p) throw new Error(`project ${id} not found`);
  if (!isLanguage(p.language) || p.language === "en") throw new Error(`project ${id} is not an Urdu or Hindi project`);
  const brief = JSON.parse(p.brief_json) as CreativeBrief;
  const script = JSON.parse(p.script_json) as Script;
  for (const a of brief.anchors) if (genders.has(a.key)) a.gender = genders.get(a.key);
  // --lines file.json: hand-written lines [{index, speaker, text, roman}] instead of a model translation.
  const li = process.argv.indexOf("--lines");
  let out: Script;
  if (li > 0 && process.argv[li + 1]) {
    const lines = JSON.parse(fs.readFileSync(process.argv[li + 1], "utf-8")) as { index: number; speaker?: string; text: string; roman: string }[];
    const keys = new Set(["narrator", ...brief.anchors.filter((a) => a.kind === "character").map((a) => a.key)]);
    const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
    out = {
      ...script,
      shots: script.shots.map((s) => {
        const l = lines.find((x) => x.index === s.index);
        if (!l) throw new Error(`no line for shot ${s.index}`);
        if (words(l.text) !== words(l.roman)) throw new Error(`shot ${s.index}: ${words(l.text)} words in text but ${words(l.roman)} in roman`);
        if (words(l.text) > maxSpokenWords(p.language)) throw new Error(`shot ${s.index}: ${words(l.text)} words (max ${maxSpokenWords(p.language)})`);
        if (l.speaker && !keys.has(l.speaker)) throw new Error(`shot ${s.index}: unknown speaker '${l.speaker}'`);
        return { ...s, spoken: l.text.trim(), roman: l.roman.trim().toLowerCase(), speaker: l.speaker || "narrator" };
      }),
    };
  } else {
    out = await localizeScript(script, brief, p.language, generateText);
  }
  await query("UPDATE projects SET brief_json = ?, script_json = ? WHERE id = ?", [JSON.stringify(brief), JSON.stringify(out), id]);
  const rows = await query<any[]>("SELECT id, shot_number FROM shots WHERE project_id = ?", [id]);
  const wc = (t: string) => t.split(/\s+/).filter(Boolean).length;
  for (const s of out.shots) {
    const row = rows.find((r) => r.shot_number === s.index);
    if (row) {
      await query("UPDATE shots SET voiceover = ?, caption_text = ?, speaker = ?, narration_fits = ? WHERE id = ?", [s.spoken, s.roman, s.speaker, wc(s.spoken || "") <= maxSpokenWords(p.language) ? 1 : 0, row.id]);
    }
    console.log(`${s.index}. ${s.speaker}\n   ${s.spoken}\n   ${s.roman}`);
  }
  console.log(`saved script${rows.length ? ` and ${rows.length} shot rows` : " (shot rows do not exist yet; the plan will use the saved script)"}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
