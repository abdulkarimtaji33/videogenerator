// Real check of the Urdu and Hindi voices: synthesizes one sentence per voice through Edge and reports the audio length
// and how many word timings Edge reported (captions need them).   npx tsx scripts/check-voices.ts
import fs from "fs";
import os from "os";
import path from "path";
import { synthesizeEdge, wordsFileFor } from "../src/providers/edge";
import { probe } from "../src/shorts/ffmpeg";

const LINES: Record<string, string> = {
  "ur-PK-AsadNeural": "کیا آپ جانتے ہیں کہ آسمان نیلا کیوں ہے؟ آج میں آپ کو ایک دلچسپ بات بتاتا ہوں۔",
  "ur-PK-UzmaNeural": "کیا آپ جانتے ہیں کہ آسمان نیلا کیوں ہے؟ آج میں آپ کو ایک دلچسپ بات بتاتی ہوں۔",
  "ur-IN-SalmanNeural": "ارے دیکھو، یہ دروازہ تو چمک رہا ہے! چلو اندر چلتے ہیں۔",
  "hi-IN-MadhurNeural": "क्या आप जानते हैं कि आसमान नीला क्यों होता है? आज मैं आपको एक दिलचस्प बात बताता हूँ।",
  "hi-IN-SwaraNeural": "क्या आप जानते हैं कि आसमान नीला क्यों होता है? आज मैं आपको एक दिलचस्प बात बताती हूँ।",
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voices-"));
  for (const [voice, text] of Object.entries(LINES)) {
    const out = path.join(dir, `${voice}.mp3`);
    const t0 = Date.now();
    try {
      await synthesizeEdge({ text, outFile: out, voice, model: "", instructions: "", speed: 1 });
      const d = (await probe(out)).duration;
      let n = 0;
      let sample = "";
      try {
        const w = JSON.parse(fs.readFileSync(wordsFileFor(out), "utf-8"));
        n = w.length;
        sample = w.slice(0, 3).map((x: any) => `${x.word}@${x.start.toFixed(2)}`).join(" ");
      } catch {
        /* no word timings */
      }
      console.log(`${voice}: OK ${d.toFixed(2)} s audio, ${text.split(/\s+/).length} words spoken, ${n} timings reported ${sample ? "(" + sample + ")" : ""}  [${((Date.now() - t0) / 1000).toFixed(1)} s]`);
    } catch (e: any) {
      console.log(`${voice}: FAILED ${e?.message || e}`);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
})();
