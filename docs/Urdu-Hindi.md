# Urdu and Hindi videos (and the anime niche)

## How to make one
Create form -> **Spoken language** -> Urdu or Hindi. Everything else is as before (niche, Short or long, length, image model). Pick the **Anime story** niche for an anime look. API: `POST /api/projects` with `"language": "ur"` (or `"hi"`).

## What happens
1. The idea, brief, facts, hook, SEO, script and review all run in **English**, so every research-based check (hook lint, fact check, but/therefore, loops, narration fit) keeps working.
2. A **localization step** (`src/script/localize.ts`, stage "translating") turns each shot into:
   - `spoken`: natural everyday Urdu (Urdu script) or Hindi (Devanagari), at most 17 words, so the neural voice reads it correctly;
   - `roman`: the same line in Roman letters (the way people type Urdu or Hindi in a chat), **one Roman word per spoken word**;
   - `speaker`: `narrator` or a character key.
   If the model returns a Roman line with a different word count, or too many words, it is asked once more for just those shots.
3. **Voices** (`src/providers/voices.ts`, Microsoft neural voices, free and natural): Urdu narrator `ur-PK-AsadNeural`, first character `ur-IN-SalmanNeural`, second `ur-PK-UzmaNeural`; Hindi `hi-IN-MadhurNeural` and `hi-IN-SwaraNeural`. With two or more characters in the brief the story is written as a **dialogue** and each character speaks with their own voice.
4. **Captions are Roman letters** (the same bold caption style as English). Edge reports the timing of each spoken word; the Roman words take those timings one for one. If Edge gives no word timings, the Roman words are spread across the spoken audio by length. No OpenAI call is needed.
5. Everything after that (clips, edit pass, music, QA, thumbnails) is unchanged.

Stored per shot: `voiceover` (spoken line), `caption_text` (Roman), `narration_en` (English source), `speaker`. Per project: `language`. Migration `007_language`.

## Character voices follow gender
The brief gives each character a `gender` (male, female, neutral). A female character gets a female voice and the translation prompt tells the model to use feminine grammar for her lines. Without a gender the first character is male, the next female. Two characters of the same gender get different voices from the pool. (Hindi has only one male and one female Edge voice, so a male narrator and a male character share a voice.)

## Checking and fixing the lines
- `npx tsx scripts/preflight-voice.ts <projectId>`: speaks every line with its voice (no clip spent) and reports whether it fits its 8-second shot and whether Edge's word timings match the Roman caption words. Real result on the two test videos: 11 of 12 lines fitted; one (the slower `ur-IN-SalmanNeural` voice, 17 words, 8.76 s) did not and was shortened.
- `npx tsx src/cli/relocalize.ts <projectId> [--gender key=female,...] [--lines file.json]`: translates the saved English script again with the current prompt, or applies hand-written lines `[{index, speaker, text, roman}]` (checked for equal word counts, length and known speakers), and updates the saved script and the shot rows. Images and clips are untouched.
- Narration generation speaks a line again, up to 1.3x faster, when it is longer than its shot, so a slow voice never runs into the next shot.
- Word limit per shot: Urdu 17 words, Hindi 14 (Hindi is spoken at about 2.1 words a second, Urdu at about 2.7).

## Quality of the translation
The model's Urdu is as good as the model. With the 4B model that fits a small server the Urdu is often stiff or wrong (wrong gender endings, misspelled words, lines that mean little), even with worked examples in the prompt, a check that the Roman line is not the English line, and a retry for lines that break a rule. For a video you will publish, either use a larger model for the translation (`qwen3.8:27b` or OpenAI), or edit the lines on a project with `relocalize.ts --lines`. The two test videos in `docs/STATUS.md` used lines written by hand this way, because the 4B output was not good enough to show.

## Anime niche
`anime_story` profile: cast of one to three **original** characters with locked features, anime look in every anchor, shot and clip prompt (cel-shaded linework, painterly backgrounds), no existing franchises or studio names, no gore. Policy notes match the character-series rules (each episode changes the situation).

## Limits
- The spoken-language quality is the text model's. A 4B model (the size that fits a small server) writes simpler Urdu than a 27B model; check the lines on the project page before publishing.
- YouTube title, description and tags are still written in English.
- Long-form graphic cards (HyperFrames) are English-only text.
- Edge Urdu voices are not as expressive as the English ones; they do not take emotion instructions.
