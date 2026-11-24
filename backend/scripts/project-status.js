// One-line status of projects:  node scripts/project-status.js 13 14
// Shows stage, status, error, the spoken Urdu/Hindi lines with their Roman captions, and each shot's image/clip state.
const ids = process.argv.slice(2).map(Number).filter(Boolean);
const base = process.env.API_URL || "http://127.0.0.1:4501";

(async () => {
  for (const id of ids) {
    try {
      const r = await fetch(`${base}/api/projects/${id}`);
      const p = await r.json();
      console.log(`#${id} status=${p.status} stage=${p.stage} niche=${p.niche} lang=${p.language} qa=${p.qa_status ?? "-"} final=${p.final_video_path ?? "-"}`);
      if (p.error_message) console.log(`   ERROR: ${p.error_message}`);
      if (process.argv.includes("--lines") || true) {
        for (const s of p.shots || []) {
          const img = s.image_path ? `img(${s.imageProviderUsed || "?"})` : "-";
          const vid = s.video_path ? `clip(${s.provider || "?"})` : "-";
          console.log(`   ${s.shot_number}. [${s.status}] ${img} ${vid} ${s.speaker ? s.speaker + ": " : ""}${(s.voiceover || "").slice(0, 60)} | ${(s.caption_text || "").slice(0, 60)}${s.error_message ? "  !! " + s.error_message : ""}`);
        }
      }
    } catch (e) {
      console.log(`#${id} error: ${e.message}`);
    }
  }
})();
