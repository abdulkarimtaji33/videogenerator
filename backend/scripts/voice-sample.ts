// Makes a real Urdu speech sample through the app's VoiceStudio provider, so the voice can be listened to.
//   npx tsx scripts/voice-sample.ts [slot voice id, default narrator male] [out.mp3]
// The first request after a model install can take a few minutes (the server loads the model onto the GPU).
import "dotenv/config";
import fs from "fs";
import path from "path";
import { synthesizeVoiceStudio } from "../src/providers/voicestudio";
import { probe } from "../src/shorts/ffmpeg";

// Hindi only (the owner chose Hindi over Urdu). Edge voice ids are only used to pick the slot: Madhur = narrator, Swara = female-0.
const lines: { name: string; voice: string; text: string }[] = [
  { name: "narrator-hindi", voice: "hi-IN-MadhurNeural", text: "नमस्ते दोस्तों! आज मैं आपको एक ऐसी कहानी सुनाता हूँ जो आपको हैरान कर देगी। बस आख़िर तक देखते रहिएगा।" },
  { name: "female-hindi", voice: "hi-IN-SwaraNeural", text: "क्या तुमने कभी सोचा है कि पुरानी लाइब्रेरी के दरवाज़े के पीछे क्या छिपा है? चलो, आज हम मिलकर पता लगाते हैं।" },
];

async function main() {
  const outDir = path.join(process.cwd(), "storage", "voice-test");
  fs.mkdirSync(outDir, { recursive: true });
  for (const l of lines) {
    const out = path.join(outDir, `${l.name}.mp3`);
    const t0 = Date.now();
    try {
      await synthesizeVoiceStudio({ text: l.text, voice: l.voice, speed: 1, outFile: out } as any);
      const d = (await probe(out)).duration;
      const words = fs.existsSync(`${out}.words.json`) ? JSON.parse(fs.readFileSync(`${out}.words.json`, "utf-8")).length : 0;
      console.log(`${l.name}: ${((Date.now() - t0) / 1000).toFixed(1)} s to make, ${d.toFixed(1)} s of speech, ${words} word timings -> ${out}`);
    } catch (e: any) {
      console.log(`${l.name}: FAILED after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${e?.message || e}`);
    }
  }
}
void main();
