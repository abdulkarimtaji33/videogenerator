// Natural voices per language (Microsoft neural voices through Edge: free, same voice every time).
// A video has a narrator and, for character stories, one voice per character, so two characters sound different.

export type LanguageId = "en" | "ur" | "hi";
export const LANGUAGE_IDS: LanguageId[] = ["en", "ur", "hi"];

export const LANGUAGE_LABEL: Record<LanguageId, string> = { en: "English", ur: "Urdu", hi: "Hindi" };

/** Voices in the order they are given out: narrator, first character, second character, third... */
const VOICES: Record<LanguageId, string[]> = {
  en: ["en-US-AndrewMultilingualNeural", "en-US-BrianMultilingualNeural", "en-US-AvaMultilingualNeural", "en-GB-RyanNeural"],
  ur: ["ur-PK-AsadNeural", "ur-IN-SalmanNeural", "ur-PK-UzmaNeural", "ur-IN-GulNeural"],
  hi: ["hi-IN-MadhurNeural", "hi-IN-MadhurNeural", "hi-IN-SwaraNeural", "hi-IN-SwaraNeural"],
};

export const isLanguage = (v: unknown): v is LanguageId => LANGUAGE_IDS.includes(v as LanguageId);

export function narratorVoice(lang: LanguageId): string {
  if (lang === "en") return process.env.EDGE_VOICE || VOICES.en[0];
  return VOICES[lang][0];
}

/**
 * Voice of a speaker. `characters` is the ordered list of character keys of the video; "narrator" (or an unknown key)
 * gets the narrator voice. The first character gets the second voice, the next the third, and so on.
 */
export function voiceFor(lang: LanguageId, speaker: string | null | undefined, characters: string[]): string {
  const list = VOICES[lang];
  const i = speaker ? characters.indexOf(speaker) : -1;
  if (i < 0) return narratorVoice(lang);
  return list[Math.min(list.length - 1, i + 1)];
}
