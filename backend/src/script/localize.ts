// Urdu and Hindi videos. The script is researched, written and reviewed in English (all the hook, fact and structure checks
// are English), then this step adapts every shot into the spoken language:
//   spoken  - what the voice says, in the language's own script (Urdu letters / Devanagari), so the neural voice reads it right
//   roman   - the same line in Roman letters, one Roman word per spoken word, for the burnt-in captions
//   speaker - "narrator" or a character key; with two or more characters the story becomes a dialogue and each
//             character gets their own voice.

import { z } from "zod";
import { LANGUAGE_LABEL, type LanguageId } from "../providers/voices";
import type { CreativeBrief, Script, ScriptShot } from "../niche/types";

type Ask = (system: string, user: string) => Promise<string>;

/** Most spoken words one 8 s shot can carry (same limit as the English narration). */
export const MAX_SPOKEN_WORDS = 17;

const words = (t: string) => t.split(/\s+/).filter(Boolean);

/** Roman text for captions: lower-case ASCII letters and digits, plain punctuation, single spaces. */
export function cleanRoman(t: string): string {
  return t
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[“”‘’`´]/g, "'")
    .replace(/[^A-Za-z0-9 .,?!'\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const LineSchema = z.object({
  index: z.coerce.number(),
  speaker: z.string().nullish().transform((v) => (v ? v.trim() : "narrator")),
  text: z.string().min(1),
  roman: z.string().min(1),
});
const Envelope = z.object({ lines: z.array(LineSchema).min(1) });

function parse(raw: string) {
  return Envelope.parse(JSON.parse(raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()));
}

function system(lang: LanguageId, characters: { key: string; name: string }[]): string {
  const L = LANGUAGE_LABEL[lang];
  const script = lang === "ur" ? "Urdu script (Arabic letters, right to left)" : "Devanagari script";
  const region = lang === "ur" ? "Pakistan" : "India";
  const dialogue = characters.length >= 2;
  return [
    `You adapt the script of a short YouTube video into spoken ${L} for a natural synthetic voice. Reply with ONLY valid JSON (no markdown).`,
    'Shape: {"lines":[{"index":1,"speaker":"narrator","text":"...","roman":"..."}]} with one line per shot, in order.',
    `- text: natural everyday spoken ${L} as people speak in ${region}, written in ${script}. Not a stiff word-for-word translation: keep the meaning, the facts and the hook, make it sound like a person talking. Simple common words. Write numbers as words in ${L}. At most ${MAX_SPOKEN_WORDS} words per line, counting every word. Do not write Latin letters in text.`,
    `- roman: the SAME line written in Roman letters the way people type ${L} in a chat message (lower-case a-z only, no accents or symbols, only . , ? ! as punctuation). It MUST have EXACTLY the same number of space-separated words as text, in the same order (one Roman word for each ${L} word, so captions can follow the voice word by word).`,
    dialogue
      ? `- This video has ${characters.length} characters: ${characters.map((c) => `${c.key} (${c.name})`).join("; ")}. Turn the narration into a short DIALOGUE: each line is spoken by ONE speaker, a character key or "narrator". Prefer the character who is on screen in that shot, let the characters answer each other so every character speaks several times, and use "narrator" only to open or close. Keep the story and its facts.`
      : '- speaker is always "narrator".',
    "- Keep shot 1 as the hook: the first line must grab attention in the first words.",
    "- No emoji, no hashtags, no stage directions in text or roman.",
  ].join("\n");
}

function userPrompt(shots: ScriptShot[], note = ""): string {
  return [
    ...shots.map((s) => `${s.index}. [${s.role}] on screen: ${s.visual.slice(0, 140)} | characters on screen: ${s.anchorKeys.join(", ") || "none"} | English: ${s.narration}`),
    note,
    "Write the lines now.",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface Localized {
  index: number;
  speaker: string;
  text: string;
  roman: string;
}

async function ask1(ask: Ask, sys: string, shots: ScriptShot[]): Promise<Localized[]> {
  let note = "";
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const env = parse(await ask(sys, userPrompt(shots, note)));
      const byIndex = new Map(env.lines.map((l) => [l.index, l]));
      const missing = shots.filter((s) => !byIndex.has(s.index)).map((s) => s.index);
      if (missing.length) throw new Error(`missing lines for shots ${missing.join(", ")}`);
      return shots.map((s) => byIndex.get(s.index) as Localized);
    } catch (e) {
      last = e instanceof Error ? e.message.slice(0, 200) : String(e);
      note = `Your previous reply was invalid (${last}). Reply again with ONLY the corrected JSON, one line for each of the ${shots.length} shots.`;
    }
  }
  throw new Error(`The model did not return usable ${last ? `lines (${last})` : "JSON"} for the translation.`);
}

/** Makes sure the Roman line has one word per spoken word; when it cannot, keeps it (captions then align by length). */
async function fixCounts(ask: Ask, sys: string, shots: ScriptShot[], lines: Localized[]): Promise<Localized[]> {
  const bad = lines.filter((l) => words(l.text).length > MAX_SPOKEN_WORDS || words(l.roman).length !== words(l.text).length);
  if (!bad.length) return lines;
  const badShots = shots.filter((s) => bad.some((b) => b.index === s.index));
  const note = `Fix these lines: ${bad
    .map((b) => `shot ${b.index} has ${words(b.text).length} words in text (max ${MAX_SPOKEN_WORDS}) and ${words(b.roman).length} in roman (must be equal)`)
    .join("; ")}. Return lines ONLY for these shots.`;
  try {
    const env = parse(await ask(sys, userPrompt(badShots, note)));
    const fixed = new Map(env.lines.map((l) => [l.index, l]));
    return lines.map((l) => {
      const f = fixed.get(l.index);
      if (!f) return l;
      const ok = words(f.text).length <= MAX_SPOKEN_WORDS && words(f.roman).length === words(f.text).length;
      return ok || words(f.text).length < words(l.text).length ? (f as Localized) : l;
    });
  } catch {
    return lines;
  }
}

export async function localizeScript(script: Script, brief: CreativeBrief, lang: LanguageId, ask: Ask): Promise<Script> {
  if (lang === "en") return script;
  const characters = brief.anchors.filter((a) => a.kind === "character").map((a) => ({ key: a.key, name: a.name }));
  const sys = system(lang, characters);
  const allowed = new Set(["narrator", ...characters.map((c) => c.key)]);
  const out: ScriptShot[] = [];
  const BATCH = 10;
  for (let i = 0; i < script.shots.length; i += BATCH) {
    const chunk = script.shots.slice(i, i + BATCH);
    const lines = await fixCounts(ask, sys, chunk, await ask1(ask, sys, chunk));
    for (const s of chunk) {
      const l = lines.find((x) => x.index === s.index) as Localized;
      const roman = cleanRoman(l.roman);
      out.push({ ...s, spoken: l.text.trim(), roman: roman || cleanRoman(s.narration), speaker: allowed.has(l.speaker) ? l.speaker : "narrator" });
    }
  }
  return { ...script, shots: out };
}
