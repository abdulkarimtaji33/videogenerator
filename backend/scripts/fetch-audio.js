// Builds the small audio library used by the edit pass: assets/audio/{music/<mood>/*.mp3, sfx/<kind>/*.wav}.
//
// No third-party files are downloaded. No royalty-free pack with a licence that can be verified from a plain HTTPS
// request was available without an account, so every file is SYNTHESISED here with FFmpeg's lavfi generators
// (sines, noise, envelopes). They are original, synthetic and dedicated to the public domain (CC0). Music beds are
// plain ambient pads and are labelled synthetic in SOURCES.md; replace them with real tracks any time by dropping
// mp3 files into assets/audio/music/<mood>/ (and wav files into assets/audio/sfx/<kind>/).
//
// Usage: node scripts/fetch-audio.js [--force]

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const OUT = path.resolve(__dirname, "../assets/audio");
const FORCE = process.argv.includes("--force");

function findFfmpeg() {
  const cands = [process.env.FFMPEG_PATH];
  try {
    cands.push(require("ffmpeg-static"));
  } catch {}
  cands.push("C:\\Users\\unknown\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.1-full_build\\bin\\ffmpeg.exe");
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return "ffmpeg";
}
const FFMPEG = findFfmpeg();

const made = [];
function ff(args, out, note) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const rel = path.relative(OUT, out).replace(/\\/g, "/");
  if (!FORCE && fs.existsSync(out)) {
    made.push({ rel, note, size: fs.statSync(out).size });
    return;
  }
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args, out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${rel}: ${r.stderr}`);
  made.push({ rel, note, size: fs.statSync(out).size });
}

const ae = (expr, d) => ["-f", "lavfi", "-i", `aevalsrc=exprs=${expr}:d=${d}:s=48000`];
const noise = (d, color, amp) => ["-f", "lavfi", "-i", `anoisesrc=d=${d}:c=${color}:a=${amp}:r=48000`];
const fin = "alimiter=limit=0.89,aformat=sample_fmts=s16:channel_layouts=stereo";

// ---- SFX: three takes of each kind ----
for (let k = 0; k < 3; k++) {
  const n = k + 1;
  // whoosh: filtered pink noise swelling and fading, plus a quiet rising sine sweep
  const d = [0.6, 0.8, 0.7][k];
  const c = [900, 1400, 650][k];
  const sweep = [1500, 2200, 1000][k];
  ff(
    [...noise(d, "pink", 0.9), ...ae(`0.25*sin(2*PI*(250*t+${sweep}*t*t))`, d),
      "-filter_complex",
      `[0:a]bandpass=f=${c}:width_type=h:w=${c},afade=t=in:d=${(d * 0.55).toFixed(3)}:curve=qsin,afade=t=out:st=${(d * 0.55).toFixed(3)}:d=${(d * 0.45).toFixed(3)}:curve=qsin[a];[1:a]afade=t=in:d=${(d * 0.55).toFixed(3)}:curve=qsin,afade=t=out:st=${(d * 0.55).toFixed(3)}:d=${(d * 0.45).toFixed(3)}:curve=qsin[b];[a][b]amix=inputs=2:normalize=0,volume=2,${fin}`],
    path.join(OUT, "sfx/whoosh", `whoosh-${n}.wav`),
    "synthetic: band-passed pink noise + sine sweep"
  );
  // riser: 2.0 s, a rising sine sweep and high noise that grows in level
  const rk = [300, 420, 540][k];
  ff(
    [...noise(2, "white", 0.8), ...ae(`0.35*sin(2*PI*(180*t+${rk}*t*t))`, 2),
      "-filter_complex",
      `[0:a]highpass=f=2200,afade=t=in:d=1.95:curve=qua[a];[1:a]afade=t=in:d=1.9:curve=qua[b];[a][b]amix=inputs=2:normalize=0,afade=t=out:st=1.95:d=0.05,volume=2,${fin}`],
    path.join(OUT, "sfx/riser", `riser-${n}.wav`),
    "synthetic: rising sine + high noise, 2.0 s"
  );
  // impact: low sine thump with a pitch drop, plus a short low-passed noise burst
  const f0 = [48, 55, 42][k];
  ff(
    [...ae(`0.9*sin(2*PI*(${f0}+34*exp(-9*t))*t)*exp(-3.2*t)`, 1.2), ...noise(0.3, "brown", 0.9),
      "-filter_complex",
      `[1:a]lowpass=f=700,afade=t=out:st=0.02:d=0.28,apad=whole_dur=1.2[b];[0:a][b]amix=inputs=2:normalize=0:duration=longest,volume=1.6,${fin}`],
    path.join(OUT, "sfx/impact", `impact-${n}.wav`),
    "synthetic: decaying low sine thump + brown noise burst, 1.2 s"
  );
  // pop: short falling-pitch blip
  const pf = [620, 760, 900][k];
  ff([...ae(`0.9*sin(2*PI*${pf}*t)*exp(-30*t)`, 0.14), "-af", fin], path.join(OUT, "sfx/pop", `pop-${n}.wav`), "synthetic: 0.14 s decaying sine blip");
  // tick: very short high click
  const tf = [2200, 2600, 3000][k];
  ff([...ae(`0.9*sin(2*PI*${tf}*t)*exp(-140*t)`, 0.06), "-af", fin], path.join(OUT, "sfx/tick", `tick-${n}.wav`), "synthetic: 0.06 s decaying sine tick");
}

// ---- Music beds: 75 s ambient pads. Every frequency is a whole number of Hz and every slow modulation completes whole
// cycles in 75 s, so the end joins the start with no click when the bed is looped. ----
const LEN = 75;
const lfo = (k, phase) => `(0.72+0.28*sin(2*PI*${k}*t/${LEN}+${phase}))`;
const pad = (notes, ks) => notes.map(([f, a], i) => `${a}*sin(2*PI*${f}*t)*${lfo(ks[i % ks.length], i * 1.3)}`).join("+");
const MOODS = {
  calm: { expr: pad([[110, 0.5], [165, 0.35], [220, 0.3], [277, 0.15], [330, 0.12]], [2, 3, 5]), note: "A minor-ish open pad" },
  wonder: { expr: pad([[131, 0.45], [196, 0.35], [262, 0.3], [330, 0.2], [392, 0.15], [494, 0.1]], [3, 4, 6]), note: "major 7th shimmer pad" },
  tense: {
    expr: pad([[98, 0.4], [104, 0.35], [147, 0.25], [156, 0.22], [196, 0.12]], [5, 7, 3]) + "+0.3*sin(2*PI*49*t)*(0.6+0.4*sin(2*PI*2*t))",
    note: "clustered semitone drone with a 2 Hz pulse",
  },
  dark: { expr: pad([[55, 0.6], [82, 0.4], [110, 0.3], [131, 0.2], [165, 0.1]], [1, 2, 3]), note: "low minor drone" },
  upbeat: {
    expr: `(0.7+0.3*sin(2*PI*1*t)*sin(2*PI*1*t))*(${pad([[196, 0.4], [247, 0.3], [294, 0.3], [392, 0.2], [494, 0.12]], [4, 6, 8])})`,
    note: "major pad gated at 120 bpm",
  },
};
for (const [mood, m] of Object.entries(MOODS)) {
  ff(
    [...ae(`0.7*(${m.expr})`, LEN), "-af", "alimiter=limit=0.8,aformat=channel_layouts=stereo", "-c:a", "libmp3lame", "-b:a", "96k"],
    path.join(OUT, "music", mood, `${mood}-pad-1.mp3`),
    `synthetic ${m.note}, ${LEN} s, loops cleanly`
  );
}

// ---- SOURCES.md ----
const lines = [
  "# Audio library sources",
  "",
  "Every file below was generated by `scripts/fetch-audio.js` with FFmpeg lavfi generators (sine and noise sources, envelopes, filters).",
  "There is no third-party material in this folder. The files are original and synthetic, dedicated to the public domain under CC0 1.0.",
  "",
  "The music beds are simple ambient pads, not composed music. To use real tracks, drop royalty-free mp3 files into `music/<mood>/`",
  "(moods: calm, wonder, tense, dark, upbeat) and wav effects into `sfx/<kind>/` (kinds: whoosh, riser, impact, pop, tick), and record",
  "their origin and licence here. Take numbers in an edit plan index the files in a folder in name order.",
  "",
  "| File | Origin | Licence | Size |",
  "|---|---|---|---|",
  ...made.map((f) => `| ${f.rel} | ${f.note} (FFmpeg lavfi, scripts/fetch-audio.js) | CC0 1.0 | ${(f.size / 1024).toFixed(0)} KB |`),
  "",
];
fs.writeFileSync(path.join(OUT, "SOURCES.md"), lines.join("\n"));
console.log(`audio library ready: ${made.length} files in ${OUT} (ffmpeg: ${FFMPEG})`);
