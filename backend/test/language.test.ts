import { describe, expect, it } from "vitest";
import { localizeScript, cleanRoman, maxSpokenWords, romanLooksEnglish } from "../src/script/localize";
import { castGenders, castVoices, narratorVoice, voiceFor } from "../src/providers/voices";
import { planFromProject } from "../src/projectVideo";
import { anchorImagePrompt, shotImagePrompt } from "../src/prompts";
import { pickProfile } from "../src/niche/profiles";
import type { CreativeBrief, Script } from "../src/niche/types";

const brief = (over: Partial<CreativeBrief> = {}): CreativeBrief => ({
  niche: "character_series",
  format: "short",
  lengthSeconds: 48,
  promise: "Two friends find a hidden door.",
  audience: "general",
  subjectMode: "cast",
  anchors: [
    { key: "ali", kind: "character", name: "Ali", lockedFeatures: "red cap", needsReference: true },
    { key: "sara", kind: "character", name: "Sara", lockedFeatures: "blue scarf", needsReference: true },
  ],
  styleBible: "Anime, cel-shaded linework, painterly backgrounds, vertical 9:16 framing, soft light.",
  tone: "warm",
  avoid: [],
  ...over,
});

const script = (): Script => ({
  format: "short",
  promise: "p",
  hook: { type: "x", line: "Hook", visual: "v" },
  shots: [1, 2, 3].map((i) => ({ index: i, role: i === 1 ? "hook" : "body", link: i === 1 ? null : "therefore", narration: `English line ${i}`, visual: `visual ${i} of the story`, anchorKeys: i === 2 ? ["sara"] : ["ali"], continuesPrevious: false })) as Script["shots"],
});

describe("Roman captions", () => {
  it("keeps plain lowercase letters, drops accents and symbols", () => {
    expect(cleanRoman("  Aap  ko pata hai?  Kyā ‘haan’ ✓ ")).toBe("aap ko pata hai? kya 'haan'");
  });

  it("notices when the Roman line is really the English line", () => {
    expect(romanLooksEnglish("one robot never moves again because pari found the key.", "One robot never moves again because Pari found the key.")).toBe(true);
    expect(romanLooksEnglish("pari ne chaabi dhoondh li", "Pari found the key")).toBe(false);
    expect(romanLooksEnglish("darwaza khol raha hai", "The door is opening")).toBe(false);
  });
});

describe("voices", () => {
  it("gives the narrator and each character their own Urdu voice", () => {
    const chars = ["ali", "sara"];
    expect(voiceFor("ur", "narrator", chars)).toBe(narratorVoice("ur"));
    expect(voiceFor("ur", "ali", chars)).not.toBe(voiceFor("ur", "sara", chars));
    expect(voiceFor("ur", "unknown-key", chars)).toBe(narratorVoice("ur"));
    expect(voiceFor("hi", "sara", chars)).toMatch(/^hi-IN-/);
    expect(narratorVoice("ur")).toMatch(/^ur-/);
  });

  it("follows the character's gender: a girl as the first character gets the female voice", () => {
    const cast = [{ key: "hana", gender: "female" as const }, { key: "kuro", gender: "male" as const }];
    expect(castGenders(cast)).toEqual({ hana: "female", kuro: "male" });
    expect(castVoices("ur", cast).hana).toBe("ur-PK-UzmaNeural");
    expect(castVoices("ur", cast).kuro).toBe("ur-IN-SalmanNeural");
    expect(castVoices("hi", cast).hana).toBe("hi-IN-SwaraNeural");
  });

  it("without genders the first character is male and the next female", () => {
    expect(castGenders(["a", "b", "c"])).toEqual({ a: "male", b: "female", c: "male" });
  });

  it("uses a different voice for two characters of the same gender", () => {
    const v = castVoices("ur", [{ key: "a", gender: "female" }, { key: "b", gender: "female" }]);
    expect(v.a).not.toBe(v.b);
  });
});

describe("localizeScript", () => {
  it("returns an English script unchanged", async () => {
    const s = script();
    expect(await localizeScript(s, brief(), "en", async () => "x")).toBe(s);
  });

  it("adds spoken text, Roman captions and speakers, and fixes unknown speakers", async () => {
    const ask = async () =>
      JSON.stringify({
        lines: [
          { index: 1, speaker: "narrator", text: "یہ ایک دروازہ ہے", roman: "yeh aik darwaza hai" },
          { index: 2, speaker: "sara", text: "علی دیکھو", roman: "ali dekho" },
          { index: 3, speaker: "ghost", text: "چلو اندر چلیں", roman: "chalo andar chalein" },
        ],
      });
    const out = await localizeScript(script(), brief(), "ur", ask);
    expect(out.shots.map((s) => s.speaker)).toEqual(["narrator", "sara", "narrator"]);
    expect(out.shots[0].spoken).toBe("یہ ایک دروازہ ہے");
    expect(out.shots[1].roman).toBe("ali dekho");
    expect(out.shots[0].narration).toBe("English line 1"); // the English source is kept
  });

  it("tells the model each character's gender and gives worked examples", async () => {
    let sys = "";
    const ask = async (s: string) => {
      sys = s;
      return JSON.stringify({ lines: [1, 2, 3].map((i) => ({ index: i, speaker: "narrator", text: "ایک دو تین", roman: "aik do teen" })) });
    };
    await localizeScript(script(), brief({ anchors: [{ key: "hana", kind: "character", name: "Hana", lockedFeatures: "x", needsReference: true, gender: "female" }] }), "ur", ask);
    expect(sys).toMatch(/hana \(Hana, female/);
    expect(sys).toMatch(/Examples of the style/);
    expect(sys).toMatch(/at most 17 words/i);
  });

  it("asks again when the Roman line has a different word count, and keeps the repaired line", async () => {
    let calls = 0;
    const ask = async () => {
      calls++;
      if (calls === 1)
        return JSON.stringify({ lines: [1, 2, 3].map((i) => ({ index: i, speaker: "narrator", text: "एक दो तीन", roman: i === 2 ? "ek do" : "ek do teen" })) });
      return JSON.stringify({ lines: [{ index: 2, speaker: "narrator", text: "एक दो तीन", roman: "ek do teen" }] });
    };
    const out = await localizeScript(script(), brief({ anchors: [] }), "hi", ask);
    expect(calls).toBe(2);
    expect(out.shots[1].roman).toBe("ek do teen");
  });

  it("asks again when the Roman line is just the English line", async () => {
    let calls = 0;
    const ask = async () => {
      calls++;
      if (calls === 1) return JSON.stringify({ lines: [1, 2, 3].map((i) => ({ index: i, speaker: "narrator", text: "ایک دو تین چار", roman: i === 1 ? "english line one" : "ek do teen char" })) });
      return JSON.stringify({ lines: [{ index: 1, speaker: "narrator", text: "ایک دو تین چار", roman: "ek do teen char" }] });
    };
    const out = await localizeScript(script(), brief({ anchors: [] }), "ur", ask);
    expect(calls).toBe(2);
    expect(out.shots[0].roman).toBe("ek do teen char");
  });

  it("gives Hindi a lower word limit than Urdu (it is spoken more slowly)", () => {
    expect(maxSpokenWords("hi")).toBeLessThan(maxSpokenWords("ur"));
  });

  it("gives up with a clear error when the model never returns usable JSON", async () => {
    await expect(localizeScript(script(), brief(), "ur", async () => "not json")).rejects.toThrow(/translation/);
  });
});

describe("assembly plan for an Urdu video", () => {
  it("uses the spoken line for the voice, Roman words for captions, and a voice per speaker", () => {
    const project = { id: 7, format: "short", language: "ur", niche: "character_series", idea_prompt: "two friends", chosen_title: "Do dost aur darwaza", brief_json: JSON.stringify(brief()) };
    const shots = [
      { shot_number: 1, title: "Hook", duration_seconds: 8, voiceover: "یہ دروازہ ہے", caption_text: "yeh darwaza hai", speaker: "narrator", video_prompt: "x".repeat(50), image_prompt: "y" },
      { shot_number: 2, title: "Body", duration_seconds: 8, voiceover: "علی دیکھو", caption_text: "ali dekho", speaker: "sara", video_prompt: "x".repeat(50), image_prompt: "y" },
    ];
    const plan = planFromProject(project, shots);
    expect(plan.clips[0].narration).toBe("یہ دروازہ ہے");
    expect(plan.clips[0].captionText).toBe("yeh darwaza hai");
    expect(plan.clips[0].voice).toBe(narratorVoice("ur"));
    expect(plan.clips[1].voice).toBe(voiceFor("ur", "sara", ["ali", "sara"]));
    expect(plan.narration.voice).toBe(narratorVoice("ur"));
    expect(plan.language).toBe("en"); // captions are Roman letters, so the Latin caption font is used
  });

  it("gives a female character the female voice even when she is the first character", () => {
    const b = brief({ anchors: [{ key: "hana", kind: "character", name: "Hana", lockedFeatures: "x", needsReference: true, gender: "female" }] });
    const project = { id: 9, format: "short", language: "ur", niche: "anime_story", idea_prompt: "anime", chosen_title: "Hana aur Kuro", brief_json: JSON.stringify(b) };
    const shots = [1, 2].map((n) => ({ shot_number: n, title: "t", duration_seconds: 8, voiceover: "ایک", caption_text: "aik", speaker: "hana", video_prompt: "x".repeat(50), image_prompt: "y" }));
    expect(planFromProject(project, shots).clips[0].voice).toBe("ur-PK-UzmaNeural");
  });

  it("leaves English projects exactly as before", () => {
    const project = { id: 8, format: "short", niche: "space_science", idea_prompt: "saturn", chosen_title: "Saturn floats", brief_json: JSON.stringify(brief({ anchors: [] })) };
    const shots = [1, 2].map((n) => ({ shot_number: n, title: "t", duration_seconds: 8, voiceover: `line ${n}`, video_prompt: "x".repeat(50), image_prompt: "y" }));
    const plan = planFromProject(project, shots);
    expect(plan.clips[0].captionText).toBeUndefined();
    expect(plan.clips[0].voice).toBeUndefined();
  });
});

describe("anime style", () => {
  it("is picked from the idea and changes every image prompt", () => {
    expect(pickProfile("an anime about a young samurai", "auto").id).toBe("anime_story");
    const b = brief({ visualStyle: "anime" });
    const photo = brief({ visualStyle: undefined, styleBible: "Photoreal cinematic, soft light, vertical 9:16 framing." });
    expect(anchorImagePrompt(b.anchors[0], b)).toMatch(/Anime illustration/);
    expect(anchorImagePrompt(b.anchors[0], b)).not.toMatch(/Photoreal\./);
    expect(shotImagePrompt(script().shots[0], b)).toMatch(/anime style/);
    expect(shotImagePrompt(script().shots[0], photo)).toMatch(/photoreal/);
  });
});
