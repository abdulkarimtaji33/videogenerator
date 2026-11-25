// Urdu and Hindi videos. The script is researched, written and reviewed in English (all the hook, fact and structure checks
// are English), then this step adapts every shot into the spoken language:
//   spoken  - what the voice says, in the language's own script (Urdu letters / Devanagari), so the neural voice reads it right
//   roman   - the same line in Roman letters, one Roman word per spoken word, for the burnt-in captions
//   speaker - "narrator" or a character key; with two or more characters the story becomes a dialogue and each
//             character gets their own voice (a female character gets a female voice and female grammar).
// A small model needs help: worked examples in the prompt, a check that the Roman line is not just the English line, and a
// second ask for any line that breaks a rule.

import { z } from "zod";
import { parseJsonLoose } from "../jsonLoose";
import { LANGUAGE_LABEL, castGenders, type LanguageId } from "../providers/voices";
import type { CreativeBrief, Script, ScriptShot } from "../niche/types";

type Ask = (system: string, user: string) => Promise<string>;

/**
 * Most spoken words one 8 s shot can carry. Measured with the Edge voices: Urdu about 2.7 words a second, Hindi about 2.1,
 * with a short pause at the start of the shot.
 */
export const maxSpokenWords = (lang: LanguageId): number => (lang === "hi" ? 14 : lang === "ur" ? 17 : 15);
/** Kept for callers that only need the Urdu limit. */
export const MAX_SPOKEN_WORDS = maxSpokenWords("ur");

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

const plain = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "");

/**
 * True when the "Roman" line is really the English line (the model copied it): most of its words are words of the English
 * source. Words that are the same in both (a name, "robot") do not count against a line with other, Roman Urdu words.
 */
export function romanLooksEnglish(roman: string, english: string): boolean {
  const en = new Set(words(english).map(plain).filter((w) => w.length > 2));
  const ro = words(roman).map(plain).filter((w) => w.length > 2);
  if (!ro.length || !en.size) return false;
  return ro.filter((w) => en.has(w)).length / ro.length >= 0.5;
}

const LineSchema = z.object({
  index: z.coerce.number(),
  speaker: z.string().nullish().transform((v) => (v ? v.trim() : "narrator")),
  text: z.string().min(1),
  roman: z.string().min(1),
});
const Envelope = z.object({ lines: z.array(LineSchema).min(1) });

function parse(raw: string) {
  return Envelope.parse(parseJsonLoose(raw));
}

const EXAMPLES: Record<"ur" | "hi", string[]> = {
  ur: [
    'English: "Do you know why the sky is blue?" -> text: "کیا آپ جانتے ہیں کہ آسمان نیلا کیوں ہے؟" roman: "kya aap jaante hain ke aasman neela kyun hai?"',
    'English: "The door slides open, and Chotu freezes." -> text: "دروازہ کھلتا ہے، اور چھوٹو وہیں رک جاتا ہے۔" roman: "darwaza khulta hai, aur chhotu wahin ruk jata hai."',
    'English (a girl speaking): "I am not afraid of the dark." -> text: "مجھے اندھیرے سے ڈر نہیں لگتا۔" roman: "mujhe andhere se dar nahi lagta."',
    'English (a boy speaking): "Wait, I think I heard something." -> text: "رکو، مجھے لگتا ہے میں نے کچھ سنا ہے۔" roman: "ruko, mujhe lagta hai maine kuch suna hai."',
  ],
  hi: [
    'English: "Do you know why the sky is blue?" -> text: "क्या आप जानते हैं कि आसमान नीला क्यों है?" roman: "kya aap jaante hain ki aasman neela kyon hai?"',
    'English: "The door slides open, and Chotu freezes." -> text: "दरवाज़ा खुलता है, और छोटू वहीं रुक जाता है।" roman: "darwaza khulta hai, aur chhotu wahin ruk jaata hai."',
    'English (a girl speaking): "I am not afraid of the dark." -> text: "मुझे अंधेरे से डर नहीं लगता।" roman: "mujhe andhere se dar nahi lagta."',
    'English (a boy speaking): "Wait, I think I heard something." -> text: "रुको, मुझे लगता है मैंने कुछ सुना है।" roman: "ruko, mujhe lagta hai maine kuch suna hai."',
  ],
};

interface Cast {
  key: string;
  name: string;
  gender: "male" | "female";
}

function system(lang: LanguageId, cast: Cast[]): string {
  const L = LANGUAGE_LABEL[lang];
  const script = lang === "ur" ? "Urdu script (Arabic letters, right to left)" : "Devanagari script";
  const region = lang === "ur" ? "Pakistan" : "India";
  const max = maxSpokenWords(lang);
  const dialogue = cast.length >= 2;
  return [
    `You adapt the script of a short YouTube video into spoken ${L} for a natural synthetic voice. Reply with ONLY valid JSON (no markdown). Never put a double quote character inside a string value.`,
    'Shape: {"lines":[{"index":1,"speaker":"narrator","text":"...","roman":"..."}]} with one line per shot, in order.',
    `- text: natural everyday spoken ${L} as people speak in ${region}, written in ${script}. Not a stiff word-for-word translation: keep the meaning, the facts and the hook, and make it sound like a person talking. Use simple common words and short sentences; if a word has no easy ${L} equivalent, use the everyday word people really say. Write numbers as words. At most ${max} words per line, counting every word. No Latin letters in text.`,
    `- roman: the SAME line written in Roman letters the way people type ${L} in a chat message (lower-case a-z only, only . , ? ! as punctuation). It is the ${L} line spelled out, NOT the English line: it must contain ${L} words such as "hai", "aur", "nahi". It MUST have EXACTLY the same number of space-separated words as text, in the same order (one Roman word for each ${L} word, so captions follow the voice word by word).`,
    ...(cast.length
      ? [
          `- Speakers: ${cast.map((c) => `${c.key} (${c.name}, ${c.gender === "female" ? "female: she speaks with feminine grammar" : "male: he speaks with masculine grammar"})`).join("; ")}; or "narrator" (male). A character's own line uses first person ("I", "me") with that character's grammatical gender.`,
        ]
      : []),
    dialogue
      ? `- Turn the narration into a short DIALOGUE: each line is spoken by ONE speaker (a character key or "narrator"). Prefer the character who is on screen in that shot, let the characters answer each other so every character speaks several times, and use "narrator" only to open or close. Keep the story and its facts.`
      : '- speaker is "narrator" unless a single character clearly speaks.',
    "- Keep shot 1 as the hook: the first line must grab attention in the first words.",
    "- No emoji, no hashtags, no stage directions in text or roman.",
    "Examples of the style:",
    ...EXAMPLES[lang as "ur" | "hi"],
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
  for (let attempt = 0; attempt < 3; attempt++) {
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
  throw new Error(`The model did not return usable lines (${last}) for the translation.`);
}

/** What is wrong with a line, or null. */
function problem(l: Localized, s: ScriptShot, max: number): string | null {
  const t = words(l.text).length;
  const r = words(l.roman).length;
  if (t > max) return `has ${t} words in text (max ${max})`;
  if (t !== r) return `has ${t} words in text but ${r} in roman (must be equal)`;
  if (/[A-Za-z]{3,}/.test(l.text)) return "text must be in the native script, with no Latin words";
  if (romanLooksEnglish(l.roman, s.narration)) return "roman is the English line; write the spoken words in Roman letters instead";
  return null;
}

/** Asks again, once, for the lines that break a rule; keeps a repaired line only if it is better. */
async function fixLines(ask: Ask, sys: string, shots: ScriptShot[], lines: Localized[], max: number): Promise<Localized[]> {
  const bad = lines.map((l, i) => ({ l, s: shots[i], p: problem(l, shots[i], max) })).filter((x) => x.p);
  if (!bad.length) return lines;
  const note = `Fix these lines: ${bad.map((b) => `shot ${b.l.index} ${b.p}`).join("; ")}. Return lines ONLY for these shots.`;
  try {
    const env = parse(await ask(sys, userPrompt(bad.map((b) => b.s), note)));
    const fixed = new Map(env.lines.map((l) => [l.index, l]));
    return lines.map((l, i) => {
      const f = fixed.get(l.index);
      if (!f) return l;
      return problem(f as Localized, shots[i], max) === null || words(f.text).length < words(l.text).length ? (f as Localized) : l;
    });
  } catch {
    return lines;
  }
}

export async function localizeScript(script: Script, brief: CreativeBrief, lang: LanguageId, ask: Ask): Promise<Script> {
  if (lang === "en") return script;
  const chars = brief.anchors.filter((a) => a.kind === "character");
  const genders = castGenders(chars.map((a) => ({ key: a.key, gender: a.gender })));
  const cast: Cast[] = chars.map((a) => ({ key: a.key, name: a.name, gender: genders[a.key] }));
  const sys = system(lang, cast);
  const max = maxSpokenWords(lang);
  const allowed = new Set(["narrator", ...cast.map((c) => c.key)]);
  const out: ScriptShot[] = [];
  const BATCH = 10;
  for (let i = 0; i < script.shots.length; i += BATCH) {
    const chunk = script.shots.slice(i, i + BATCH);
    const lines = await fixLines(ask, sys, chunk, await ask1(ask, sys, chunk), max);
    for (const s of chunk) {
      const l = lines.find((x) => x.index === s.index) as Localized;
      const roman = cleanRoman(l.roman);
      out.push({ ...s, spoken: l.text.trim(), roman: roman || cleanRoman(s.narration), speaker: allowed.has(l.speaker) ? l.speaker : "narrator" });
    }
  }
  return { ...script, shots: out };
}
