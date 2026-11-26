// Points the app at a FLUX server (for example the Kaggle GPU tunnel) and checks that it answers.
//   node scripts/set-flux-url.js https://xxxx.trycloudflare.com [--size 576x1024] [--steps 4]
// It edits backend/storage/image-settings.json (the file the Settings page also writes), so it works whether or not the backend is
// running; a running backend reads the file on every image. Use  node scripts/set-flux-url.js local  to go back to this PC.
const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "storage", "image-settings.json");
const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/set-flux-url.js <url|local> [--size WxH] [--steps N]");
  process.exit(1);
}
const opt = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

(async () => {
  let s = {};
  try {
    s = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    /* a new file */
  }
  const url = arg === "local" ? "http://127.0.0.1:7860" : arg.replace(/\/$/, "");
  if (!/^https?:\/\/[^\s]+$/.test(url)) throw new Error(`not a web address: ${arg}`);
  s.fluxUrl = url;
  s.defaultProvider = "flux-local";
  if (arg === "local") {
    s.fluxWidth = 384;
    s.fluxHeight = 640;
    s.fluxSteps = 4;
  } else {
    // A GPU renders the product's own portrait size (576x1024) in seconds; the CPU needs the small 384x640.
    const [w, h] = (opt("--size") || "576x1024").split("x").map(Number);
    s.fluxWidth = w;
    s.fluxHeight = h;
    s.fluxSteps = Number(opt("--steps")) || 4;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
  console.log(`saved: ${s.fluxUrl}  render ${s.fluxWidth}x${s.fluxHeight}, ${s.fluxSteps} steps`);
  try {
    const r = await fetch(url + "/v1/models", { signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    console.log(r.ok && Array.isArray(j.data) && j.data.length ? "server answers: ready" : `server answered ${r.status}: ${JSON.stringify(j).slice(0, 120)}`);
  } catch (e) {
    console.log(`server does not answer yet (${e.message || e}); the setting is saved anyway`);
  }
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
