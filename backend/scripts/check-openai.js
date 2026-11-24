// Checks which OpenAI capabilities the configured key can use. Never prints the key.
// Usage: node scripts/check-openai.js [path-to-env]
const path = require("path");
require("dotenv").config({ path: process.argv[2] || path.join(__dirname, "..", ".env") });
const OpenAI = require("openai");

async function step(name, fn) {
  try {
    const out = await fn();
    console.log(`OK    ${name}${out ? " - " + out : ""}`);
    return true;
  } catch (e) {
    console.log(`FAIL  ${name} - ${(e && (e.status || e.code)) || ""} ${(e && e.message ? e.message : String(e)).slice(0, 140)}`);
    return false;
  }
}

(async () => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return console.log("FAIL  no OPENAI_API_KEY in", process.argv[2] || ".env");
  console.log("key present, length", key.length, "prefix", key.slice(0, 7) + "...");
  const client = new OpenAI({ apiKey: key });
  await step("chat gpt-4.1", async () => {
    const r = await client.chat.completions.create({ model: process.env.OPENAI_TEXT_MODEL || "gpt-4.1", messages: [{ role: "user", content: "Reply with the single word: ready" }], max_tokens: 5 });
    return r.choices[0].message.content;
  });
  await step("tts", async () => {
    const r = await client.audio.speech.create({ model: "tts-1", voice: "onyx", input: "Testing one two three." });
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length + " bytes";
  });
  await step("whisper word timestamps (needs audio; checks model access only)", async () => {
    const models = await client.models.list();
    const ids = [];
    for await (const m of models) ids.push(m.id);
    return `whisper-1: ${ids.includes("whisper-1")}, gpt-4o-mini-tts: ${ids.includes("gpt-4o-mini-tts")}, tts-1-hd: ${ids.includes("tts-1-hd")}`;
  });
})();
