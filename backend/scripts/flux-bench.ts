// Real speed test of the configured FLUX server through the app's own image code (makeImage): one plain image and one with
// reference images, like a shot of a video.   npx tsx scripts/flux-bench.ts [refImage ...]
import fs from "fs";
import path from "path";
import { makeImage } from "../src/images";
import { readImageSettings } from "../src/images/settings";

async function main() {
  const s = readImageSettings();
  console.log(`server ${s.fluxUrl} | render ${s.fluxWidth}x${s.fluxHeight}, ${s.fluxSteps} steps`);
  const refs = process.argv.slice(2).filter((p) => fs.existsSync(p));
  const out = path.join(process.cwd(), "storage", "bench");
  fs.mkdirSync(out, { recursive: true });
  const runs: [string, string[]][] = [["plain", []], ...(refs.length ? ([[`with ${refs.length} reference image(s)`, refs]] as [string, string[]][]) : []), ["plain again", []]];
  for (const [name, r] of runs) {
    const t0 = Date.now();
    try {
      const made = await makeImage({
        prompt: "Cinematic stylised photo of two small friendly robots standing in front of a glowing door in an abandoned school, soft volumetric light, vertical 9:16 composition. No text.",
        size: "1024x1536",
        refs: r,
        provider: "flux-local",
        fallback: false,
      });
      const file = path.join(out, `bench-${name.replace(/\W+/g, "-")}.png`);
      fs.writeFileSync(file, made.buffer);
      console.log(`${name}: ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(made.buffer.length / 1e6).toFixed(1)} MB -> ${file}`);
    } catch (e: any) {
      console.log(`${name}: FAILED after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${e?.message || e}`);
    }
  }
}
void main();
