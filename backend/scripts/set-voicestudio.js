// Points the app at a VoiceStudio server (the Colab GPU tunnel) and checks that it answers.
//   node scripts/set-voicestudio.js https://xxxx.app.lhr.life            use VoiceStudio for speech
//   node scripts/set-voicestudio.js edge                                  go back to the Microsoft Edge voices
//   node scripts/set-voicestudio.js <url> --voice narrator=ID --voice female-0=ID2   choose VoiceStudio voice ids per slot
// Edits backend/storage/voice-settings.json (read on every narration, so a running backend needs no restart).
// The API key is read from VOICESTUDIO_API_KEY in backend/.env and is never written to that file.
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "storage", "voice-settings.json");
const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/set-voicestudio.js <url|edge> [--voice slot=id ...]");
  process.exit(1);
}

(async () => {
  let s = {};
  try {
    s = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    /* a new file */
  }
  s.voices = s.voices || {};
  for (let i = 3; i < process.argv.length; i++) {
    if (process.argv[i] === "--voice" && process.argv[i + 1]) {
      const [slot, id] = process.argv[++i].split("=");
      if (slot && id) s.voices[slot] = id;
    }
  }
  if (arg === "edge") {
    s.provider = "edge";
  } else {
    const url = arg.replace(/\/$/, "");
    if (!/^https?:\/\/[^\s]+$/.test(url)) throw new Error(`not a web address: ${arg}`);
    s.provider = "voicestudio";
    s.voicestudioUrl = url;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
  console.log(`saved: speech = ${s.provider}${s.voicestudioUrl ? " at " + s.voicestudioUrl : ""}; voices: ${JSON.stringify(s.voices)}`);
  if (arg !== "edge") {
    // A tunnel name can resolve to an address this PC cannot reach; each new lookup can give another one, so try a few times.
    let done = false;
    let last = "";
    for (let i = 0; i < 12 && !done; i++) {
      try {
        const r = await fetch(s.voicestudioUrl + "/elevenlabs/v1/voices", { headers: process.env.VOICESTUDIO_API_KEY ? { "xi-api-key": process.env.VOICESTUDIO_API_KEY } : {}, signal: AbortSignal.timeout(8000) });
        const j = await r.json().catch(() => ({}));
        console.log(r.ok ? `server answers: ${(j.voices || []).length} voice(s): ${(j.voices || []).map((v) => v.name + " (" + v.voice_id + ")").join(", ").slice(0, 300)}` : `server answered ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
        done = true;
      } catch (e) {
        last = (e.cause && e.cause.code) || e.message || String(e);
      }
    }
    if (!done) console.log(`server does not answer yet (${last}); the setting is saved anyway`);
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
