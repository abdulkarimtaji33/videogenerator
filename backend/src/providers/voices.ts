// Natural voices per language (Microsoft neural voices through Edge: free, same voice every time).
// A video has a narrator and, for character stories, one voice per character, so two characters sound different.
// A character's voice follows their gender (female characters get a female voice); with no gender given, the first
// character is male, the next female, and so on.

export type LanguageId = "en" | "ur" | "hi";
export const LANGUAGE_IDS: LanguageId[] = ["en", "ur", "hi"];

export const LANGUAGE_LABEL: Record<LanguageId, string> = { en: "English", ur: "Urdu", hi: "Hindi" };

export type Gender = "male" | "female" | "neutral";
export interface CastMember {
  key: string;
  gender?: Gender | null;
}

interface Pool {
  narrator: string;
  male: string[];
  female: string[];
}

const POOLS: Record<LanguageId, Pool> = {
  en: {
    narrator: "en-US-AndrewMultilingualNeural",
    male: ["en-US-BrianMultilingualNeural", "en-GB-RyanNeural", "en-US-GuyNeural"],
    female: ["en-US-AvaMultilingualNeural", "en-US-EmmaMultilingualNeural", "en-GB-SoniaNeural"],
  },
  ur: { narrator: "ur-PK-AsadNeural", male: ["ur-IN-SalmanNeural", "ur-PK-AsadNeural"], female: ["ur-PK-UzmaNeural", "ur-IN-GulNeural"] },
  hi: { narrator: "hi-IN-MadhurNeural", male: ["hi-IN-MadhurNeural"], female: ["hi-IN-SwaraNeural"] },
};

export const isLanguage = (v: unknown): v is LanguageId => LANGUAGE_IDS.includes(v as LanguageId);

export function narratorVoice(lang: LanguageId): string {
  if (lang === "en") return process.env.EDGE_VOICE || POOLS.en.narrator;
  return POOLS[lang].narrator;
}

const asCast = (c: string | CastMember): CastMember => (typeof c === "string" ? { key: c } : c);

/** The grammatical and vocal gender used for each character: given, else male, female, male... by order. */
export function castGenders(cast: (string | CastMember)[]): Record<string, "male" | "female"> {
  const out: Record<string, "male" | "female"> = {};
  cast.map(asCast).forEach((c, i) => {
    out[c.key] = c.gender === "female" ? "female" : c.gender === "male" ? "male" : i % 2 === 0 ? "male" : "female";
  });
  return out;
}

/** Voice of each character key: the next unused voice of their gender. */
export function castVoices(lang: LanguageId, cast: (string | CastMember)[]): Record<string, string> {
  const genders = castGenders(cast);
  const used = { male: 0, female: 0 };
  const out: Record<string, string> = {};
  for (const c of cast.map(asCast)) {
    const g = genders[c.key];
    const pool = POOLS[lang][g];
    out[c.key] = pool[used[g]++ % pool.length];
  }
  return out;
}

/** Voice of a speaker: "narrator" (or an unknown key) gets the narrator voice. */
export function voiceFor(lang: LanguageId, speaker: string | null | undefined, cast: (string | CastMember)[]): string {
  if (!speaker) return narratorVoice(lang);
  return castVoices(lang, cast)[speaker] ?? narratorVoice(lang);
}
