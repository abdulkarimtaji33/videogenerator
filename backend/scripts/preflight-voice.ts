// Pre-flight for an Urdu or Hindi project, before any video clip is spent: speaks every line with the voice of its speaker
// and checks that it fits its shot and that Edge reported one timing per caption word.   npx tsx scripts/preflight-voice.ts 13
import fs from "fs";
import os from "os";
import path from "path";
import { query } from "../src/db";
import { planFromProject } from "../src/projectVideo";
import { synthesizeEdge, wordsFileFor } from "../src/providers/edge";
import { probe } from "../src/shorts/ffmpeg";

async function main() {
  const id = Number(process.argv[2]);
  const [project] = await query<any[]>("SELECT * FROM projects WHERE id = ?", [id]);
  const shots = await query<any[]>("SELECT * FROM shots WHERE project_id = ? ORDER BY shot_number", [id]);
  const plan = planFromProject(project, shots);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-"));
  let bad = 0;
  for (const c of plan.clips) {
    const out = path.join(dir, `${c.id}.mp3`);
    await synthesizeEdge({ text: c.narration, outFile: out, voice: c.voice || plan.narration.voice, model: "", instructions: "", speed: plan.narration.speed });
    const d = (await probe(out)).duration;
    let timings = 0;
    try {
      timings = JSON.parse(fs.readFileSync(wordsFileFor(out), "utf-8")).length;
    } catch {
      /* no timings */
    }
    const romanWords = (c.captionText || c.narration).split(/\s+/).filter(Boolean).length;
    const room = c.seconds - plan.narration.delay - 0.2;
    const fits = d <= room;
    const aligned = timings === romanWords;
    if (!fits || !aligned) bad++;
    console.log(`${c.id} ${c.voice}: ${d.toFixed(2)} s of ${room.toFixed(2)} ${fits ? "fits" : "TOO LONG"} | timings ${timings} vs caption words ${romanWords} ${aligned ? "aligned" : "MISMATCH (spread by length)"}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad ? `${bad} shot(s) need attention` : "all shots fit and align");
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
