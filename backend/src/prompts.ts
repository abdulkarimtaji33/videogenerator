// Prompt templates adapted from the "Meri AI Army" ChatGPT wizard transcript,
// restructured for fully automatic, non-conversational execution.
//
// The first half of this file (briefPrompt ... buildVideoPrompt) is the niche-aware pipeline: the rules come from
// docs/Viral-Video-Research-Complete.md and docs/Niche-Research-Complete.md. The older story/character prompts
// below it are kept for projects made by the original pipeline.

import type { AnchorSpec, CreativeBrief, NicheProfile, Script, ScriptShot, VerifiedFact, VideoFormat } from "./niche/types";

const JSON_ONLY = "Reply with ONLY valid JSON (no markdown fences, no commentary). Never put a double quote character inside a string value (use single quotes), and never leave a trailing comma.";

/** Step 1: what the video is about, what recurs visually, and the shared look. */
export function briefPrompt(args: { idea: string; profile: NicheProfile; format: VideoFormat; lengthSeconds: number }) {
  const { idea, profile, format, lengthSeconds } = args;
  return {
    system: [
      "You are the creative director of a faceless YouTube channel made with AI video and a synthetic narrator.",
      "Turn the idea into a creative brief. " + JSON_ONLY,
      'Shape: {"promise": string, "audience": string, "subjectMode": "subject"|"place"|"character"|"cast"|"mixed"|"none", "anchors": [{"key": string, "kind": "character"|"subject"|"place"|"object", "name": string, "lockedFeatures": string, "needsReference": boolean, "gender": "male"|"female"|"neutral"}], "styleBible": string, "tone": string, "avoid": string[]}',
      "- gender: only for 'character' anchors: the gender of the voice that speaks as that character (male, female or neutral). It picks the voice and the grammar of translated lines, so be explicit: a girl or a female robot is 'female'.",
      "Rules:",
      "- promise: ONE sentence the video must deliver, specific (a named subject plus a surprise or stake). Never a topic label.",
      "- anchors are the things that RECUR visually across shots and must look identical every time. Use 0-4. A video about a planet has the planet as a 'subject' anchor and NO person. Only add a 'character' or 'cast' anchor when the idea is genuinely about people or a story with characters. A history video usually anchors 'place' and 'object', never realistic human faces. Use zero anchors when nothing recurs (a pure list of unrelated visuals).",
      "- key: lowercase letters, digits and dashes. lockedFeatures: the concrete visual features that must never change (shape, colours, materials, clothing, scale), 15-45 words.",
      `- Default subject mode for this niche (${profile.label}) is '${profile.subjectMode}'; change it only when the idea clearly needs something else.`,
      "- styleBible: ONE sentence, 20-40 words, repeated in every image and clip prompt: the visual style, lighting and lens (for example photoreal cinematic, soft volumetric light, anamorphic lens), colour palette, and one consistent setting or light. " +
        (format === "short" ? "End it with 'vertical 9:16 framing'." : "End it with 'horizontal 16:9 framing'."),
      "- tone: 3-6 words. avoid: 3-8 things never to show.",
      `- Niche visual rules to respect: ${profile.visualRules.join("; ")}.`,
      ...(profile.visualStyle === "anime"
        ? [
            "- This is an ANIME story. The styleBible MUST name the anime look (cel-shaded linework, painterly backgrounds). Use subjectMode 'cast' with 1-3 original 'character' anchors (hair, eyes, outfit, one signature item in lockedFeatures) and one 'place' anchor. Human-looking anime characters are fine here (ignore any 'no realistic faces' rule); never copy an existing anime character or studio.",
          ]
        : []),
      `- Policy notes: ${profile.policyNotes.join("; ") || "none"}.`,
      "- No text, labels, signs, charts or logos in any visual. No real named people, brands or copyrighted characters.",
    ].join("\n"),
    user: `Idea: ${idea}\nNiche: ${profile.label}\nFormat: ${format} video, about ${lengthSeconds} seconds\n\nWrite the brief now.`,
  };
}

/** Step 2a: candidate facts the model is confident about. They are checked again by factCheckFacts. */
export function factsPrompt(args: { idea: string; brief: CreativeBrief; profile: NicheProfile }) {
  return {
    system: [
      "You list verifiable facts for a video script. " + JSON_ONLY,
      'Shape: [{"claim": string, "source": string}]',
      "Rules: 6-12 facts. Include ONLY claims you are highly confident are true and that a viewer could check. Prefer numbers, comparisons and named things. source = a well-known reference that would contain it (an agency fact sheet, a standard textbook, a museum or encyclopedia entry); never invent a URL. Never include a claim you are unsure about. Each claim is one plain sentence.",
    ].join("\n"),
    user: `Idea: ${args.idea}\nPromise: ${args.brief.promise}\nNiche: ${args.profile.label}\n\nList the facts now.`,
  };
}

/** Step 2b: a strict second opinion on each fact. */
export function factVerifyPrompt(facts: { claim: string; source: string }[]) {
  return {
    system:
      "You are a strict fact checker. For each numbered claim, answer whether it is TRUE as stated (not exaggerated, not out of date, numbers right). If you are not sure, answer false. " +
      JSON_ONLY +
      ' Shape: [{"i": 1, "true": true|false, "reason": string}] covering every claim.',
    user: facts.map((f, i) => `${i + 1}. ${f.claim}`).join("\n"),
  };
}

/** Roles of a Short's shots by position. Shot 1 carries the foreshadow itself when the Short has fewer than 5 shots. */
export function shortRoles(n: number): ScriptShot["role"][] {
  return Array.from({ length: n }, (_, i) => {
    if (i === 0) return "hook";
    if (n >= 5 && i === 1) return "foreshadow";
    if (i === n - 1) return "loop";
    if (i === n - 2) return "payoff";
    return "body";
  });
}

const SCRIPT_RULES = [
  "Narration rules (spoken by a synthetic voice at about 2.4 words a second with a short pause at the start; each shot is 8 seconds, so at most 15 words and at least 9 words per shot, counting every word including the hook line in shot 1):",
  "- Plain words, fifth-grade reading level, one idea per sentence, the key noun early. Write numbers as words (two thirds, not 2/3). No greetings, no 'in this video', no 'like and subscribe', no first person.",
  "- Every shot after the first is linked to the one before by 'but' (conflict or contrast) or 'therefore' (consequence). NEVER 'and then'. Set the link field accordingly, and express the link through meaning: do NOT begin a narration line with the word 'But' or 'Therefore'.",
  "- The loop shot must NOT repeat the hook line word for word; echo its idea or last words in a fresh sentence.",
  "- Use ONLY the verified facts supplied. Never invent a number, name or date. List the fact ids you used in factIds.",
  "- visual: ONE focal moment in 20-45 words that includes ONE camera movement (slow push-in, tracking shot, pull-back, orbit...). It must be understandable with the sound off. No text, letters, numbers, labels, charts, screens, signs or logos. No quotation marks. Avoid close-up faces and hands.",
  "- anchorKeys: the keys of the anchors visible in that shot (only keys from the brief).",
  "- continuesPrevious: true when the shot is the same scene as the previous one (the camera keeps moving through the same place), false when it cuts to a new scene.",
].join("\n");

/** Step 5: the full script. Short = one call; long-form = an outline call then one call per group of shots. */
export function scriptPrompt(args: {
  idea: string;
  brief: CreativeBrief;
  profile: NicheProfile;
  facts: VerifiedFact[];
  hook: { type: string; line: string; visual: string };
  format: VideoFormat;
  shotCount: number;
}) {
  const { brief, facts, hook, format, shotCount } = args;
  const factLines = facts.map((f) => `${f.id}. ${f.claim}`).join("\n") || "(no verified facts; state no specific numbers)";
  const anchorLines = brief.anchors.map((a) => `- ${a.key} (${a.kind}): ${a.name}`).join("\n") || "(no anchors)";
  const shortStructure = [
    `Write EXACTLY ${shotCount} shots for a vertical Short, about ${shotCount * 8} seconds.`,
    `Use EXACTLY these roles, in this order: ${shortRoles(shotCount).join(", ")}.`,
    "Structure, in order:",
    "1. Shot 1, role 'hook': narration = the hook line exactly as given, then (same shot) a one-sentence foreshadow of where the video goes (a tease, not the answer). Its visual is the hook visual.",
    shotCount >= 5 ? "2. Shot 2, role 'foreshadow': one or two short lines that open a question the video will answer." : "",
    `${shotCount >= 5 ? "3" : "2"}. Body shots, role 'body', each linked by 'but' or 'therefore'. Open one loop early (loopOpened) and close it before the payoff (loopClosed on the closing shot).`,
    `${shotCount >= 5 ? "4" : "3"}. The shot before the last, role 'payoff': deliver EXACTLY what the hook promised, then stop talking about it.`,
    "5. The LAST shot, role 'loop': one short line whose last words echo the first line or first image, so a replay feels natural. No call to action, no goodbye.",
    "A Short makes ONE promise, one idea a child could repeat.",
  ].filter(Boolean);
  const longStructure = [
    `Write EXACTLY ${shotCount} shots for a long video, about ${Math.round((shotCount * 8) / 60)} minutes. Shots belong to beats of 45-90 seconds (6-11 shots); give every shot of a beat the same 'beat' number (starting at 1).`,
    "Structure: shots 1-4 are the hook anatomy: shot 1 role 'hook' (the hook line exactly, then the striking visual); shot 2 states the title's promise in one sentence; shot 3 adds stakes or opens the first loop (loopOpened); shot 4 bridges into the body.",
    "Then body beats, role 'body', each beat making ONE claim with its evidence from the facts. Roughly one third of the way through add a shot with role 'rehook' (restate the promise or open a new question). Around the halfway point add a 'side_story' shot (a related new question or angle). Roughly two thirds through add another 'rehook'. Keep one to three loops open at a time and close every opened loop before the end (loopClosed); the biggest closes last. Put the strongest moment in the first third.",
    "Near the end a 'payoff' shot delivers exactly what the title promised, then a 'bridge' shot (10-20 seconds of speech at most) names ONE specific next video and why it follows. No long sign-off, no thanks, no recap.",
  ];
  return {
    system: [
      "You write the script of a faceless YouTube video that holds attention. " + JSON_ONLY,
      'Shape: {"shots": [{"index": 1, "role": "hook"|"foreshadow"|"body"|"rehook"|"side_story"|"payoff"|"loop"|"bridge", "link": "but"|"therefore"|null, "narration": string, "visual": string, "anchorKeys": string[], "continuesPrevious": boolean, "beat": number, "loopOpened": string?, "loopClosed": string?, "factIds": number[]}]}',
      ...(format === "short" ? shortStructure : longStructure),
      SCRIPT_RULES,
      "The first shot has link null.",
    ].join("\n"),
    user: [
      `Idea: ${args.idea}`,
      `Promise to deliver: ${brief.promise}`,
      `Tone: ${brief.tone}`,
      `Hook line (use exactly): ${hook.line}`,
      `Hook visual (shot 1 shows this): ${hook.visual}`,
      `Anchors:\n${anchorLines}`,
      `Verified facts:\n${factLines}`,
      "Write the script now.",
    ].join("\n"),
  };
}

/** Long-form step A: the beat outline (kept short, so the model does not run out of output). */
export function outlinePrompt(args: { idea: string; brief: CreativeBrief; facts: VerifiedFact[]; hook: { line: string }; beatCount: number }) {
  return {
    system: [
      "You outline a long YouTube video as beats of 45-90 seconds. " + JSON_ONLY,
      'Shape: [{"beat": 1, "claim": string, "factIds": number[], "link": "but"|"therefore"|null, "loopOpened": string?, "loopClosed": string?, "sideStory": boolean, "rehook": boolean}]',
      `EXACTLY ${args.beatCount} beats. Beat 1 is the hook and promise. Every later beat links to the previous by 'but' or 'therefore' (never 'and then'). One beat near the halfway point has sideStory true. Beats about one third and two thirds through have rehook true. Open 1-3 loops and close every one before the last beat; the biggest closes last. The last beats are the payoff and a bridge.`,
      "Use only the verified facts.",
    ].join("\n"),
    user: `Idea: ${args.idea}\nPromise: ${args.brief.promise}\nHook line: ${args.hook.line}\nVerified facts:\n${args.facts.map((f) => `${f.id}. ${f.claim}`).join("\n")}\n\nWrite the outline now.`,
  };
}

/** Long-form step B: the shots of one group of beats. */
export function expandBeatsPrompt(args: {
  idea: string;
  brief: CreativeBrief;
  facts: VerifiedFact[];
  hook: { type: string; line: string; visual: string };
  beats: unknown[];
  startIndex: number;
  shotsForBeats: number;
  previousNarration: string;
}) {
  const anchorLines = args.brief.anchors.map((a) => `- ${a.key} (${a.kind}): ${a.name}`).join("\n") || "(no anchors)";
  return {
    system: [
      "You write the shots for part of a long YouTube video. " + JSON_ONLY,
      'Shape: {"shots": [{"index": number, "role": "hook"|"body"|"rehook"|"side_story"|"payoff"|"bridge", "link": "but"|"therefore"|null, "narration": string, "visual": string, "anchorKeys": string[], "continuesPrevious": boolean, "beat": number, "loopOpened": string?, "loopClosed": string?, "factIds": number[]}]}',
      `Write EXACTLY ${args.shotsForBeats} shots, numbered from index ${args.startIndex}, covering the beats given (about 6-11 shots per beat). Copy each beat's number into 'beat'. A beat with rehook true starts with a shot of role 'rehook'; sideStory true starts with a 'side_story' shot; the first beat's first shot has role 'hook' with the hook line exactly; the final beats use roles 'payoff' then 'bridge'.`,
      SCRIPT_RULES,
    ].join("\n"),
    user: [
      `Idea: ${args.idea}`,
      `Hook: ${args.hook.line}`,
      `Anchors:\n${anchorLines}`,
      `Verified facts:\n${args.facts.map((f) => `${f.id}. ${f.claim}`).join("\n")}`,
      `Beats to write:\n${JSON.stringify(args.beats)}`,
      args.previousNarration ? `The previous shot ended with this narration (link to it): ${args.previousNarration}` : "",
      "Write the shots now.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

const isAnime = (brief: CreativeBrief) => brief.visualStyle === "anime";
/** The look sentence of every image prompt. */
const lookOf = (brief: CreativeBrief) => (isAnime(brief) ? "Anime illustration, clean cel-shaded linework, vivid colour." : "Photoreal.");

/** Text-to-image prompt for one anchor's reference image (deterministic; no model call). */
export function anchorImagePrompt(anchor: AnchorSpec, brief: CreativeBrief): string {
  const frame = brief.format === "short" ? "vertical 9:16 composition" : "horizontal 16:9 composition";
  const base = `${brief.styleBible} ${anchor.lockedFeatures}`;
  const look = lookOf(brief);
  const medium = isAnime(brief) ? "full-body illustration" : "full-body photograph";
  switch (anchor.kind) {
    case "character":
      return `${base} A single ${medium} of ${anchor.name}, one character only, neutral pose, simple neutral background, ${frame}. ${look} One subject, no collage, no multiple panels, no text.`;
    case "place":
      return `${base} A wide establishing shot of ${anchor.name}, no people in the foreground, ${frame}. ${look} One continuous scene, no collage, no text.`;
    default:
      return `${base} A single clean hero image of ${anchor.name}, centred, one subject filling the frame, simple dark background, ${frame}. ${look} No people, no collage, no multiple panels, no text.`;
  }
}

/** Text-to-image / image-edit prompt for one shot's first frame (deterministic). */
export function shotImagePrompt(shot: ScriptShot, brief: CreativeBrief): string {
  const present = brief.anchors.filter((a) => shot.anchorKeys.includes(a.key));
  const frame = brief.format === "short" ? "vertical 9:16 composition" : "horizontal 16:9 composition";
  const keep = present.length
    ? ` Keep the exact appearance of ${present.map((a) => `${a.name} (${a.lockedFeatures})`).join("; ")} as shown in the reference image${present.length > 1 ? "s" : ""}.`
    : "";
  return `${brief.styleBible} ${shot.visual}.${keep} ${frame}, ${isAnime(brief) ? "anime style, cel-shaded" : "photoreal"}, cinematic first frame. No text, no letters, no speech bubbles, no logos, no watermarks, no collage.`;
}

const CAMERA_WORDS = /\b(dolly|tracking|pan|tilt|orbit|push-?in|pull-?back|crane|handheld|static|zoom|aerial|macro|wide shot|close-up|low[- ]angle|high[- ]angle|camera)\b/i;
const LIGHT_WORDS = /\b(light|lighting|glow|backlit|rim|volumetric|cinematic|photoreal|imax|anamorphic|35mm|lens|sunrise|shadow|haze)\b/i;

/**
 * The video-model prompt for one shot. Built to pass shorts/promptLint.ts: the style bible verbatim, one focused
 * moment, a camera movement, lighting, an Audio line with no speech (the narrator is voiced separately), no text.
 */
export function buildVideoPrompt(args: { shot: ScriptShot; brief: CreativeBrief; continuing: boolean }): string {
  const { shot, brief, continuing } = args;
  const frame = brief.format === "short" ? "vertical 9:16 framing" : "horizontal 16:9 framing";
  const visual = shot.visual.replace(/["“”]/g, "").trim().replace(/\.$/, "");
  const lead = continuing ? "Continuing the same shot from the start frame, " : "";
  const parts = [
    brief.styleBible.trim().replace(/\.$/, "") + ".",
    `${lead}${continuing ? visual.charAt(0).toLowerCase() + visual.slice(1) : visual}.`,
  ];
  if (!CAMERA_WORDS.test(visual)) parts.push("Slow cinematic push-in.");
  if (!LIGHT_WORDS.test(parts.join(" "))) parts.push("Soft cinematic lighting.");
  if (!/vertical|9:16|horizontal|16:9/i.test(parts.join(" "))) parts.push(`${frame}.`);
  parts.push("Audio: natural ambient sound only, no speech, no music.");
  parts.push("No text, no logos, no watermarks.");
  return parts.join(" ");
}

export type { Script };

export function storyPrompt(idea: string) {
  return {
    system:
      "You are a cinematic short-video scriptwriter. You turn a raw idea into a tight, " +
      "visual 30-60 second story script suitable for an AI-generated video ad or brand film. " +
      "Write in vivid, scene-by-scene prose with clear narration lines in quotes. No preamble, " +
      "no meta-commentary, just the script.",
    user: `Idea:\n${idea}\n\nWrite the full story script now.`,
  };
}

export function characterPrompt(idea: string, story: string) {
  return {
    system:
      "You design a single consistent main character for a short cinematic video, so the " +
      "same character can be redrawn identically across every shot. Cover: role/basic profile " +
      "(age, gender, ethnicity, height, body type), face (shape, skin tone, eyes, eyebrows, nose, " +
      "lips, facial hair, hair), distinct features, outfit (top, bottom, footwear, accessories), " +
      "personality, and emotional arc across the story (beginning/middle/end). No preamble.",
    user: `Idea:\n${idea}\n\nStory script:\n${story}\n\nDesign the main character now.`,
  };
}

export function characterImagePromptPrompt(characterDescription: string) {
  return {
    system:
      "You write a single production-ready text-to-image prompt for generating ONE character " +
      "reference photo: a single full-body, front-facing photograph of one person, neutral pose, " +
      "neutral studio background, photorealistic, 8K. This is NOT a character sheet, turnaround, " +
      "or collage - do not request multiple panels, multiple poses, close-up insets, back views, " +
      "text labels, captions, callouts, or any grid layout. Describe only what appears in that one " +
      "photograph: the character's face, hair, outfit, and accessories, described precisely enough " +
      "that the same person can be recognized and redrawn consistently in later images. Explicitly " +
      "state in the prompt: single photograph, one subject, no collage, no multiple panels, no text. " +
      "Output ONLY the image prompt text, nothing else.",
    user: `Character design:\n${characterDescription}\n\nWrite the character reference image prompt now.`,
  };
}

export function scenesPrompt(idea: string, story: string, characterDescription: string, shotCount: number) {
  return {
    system:
      `You break a story into exactly ${shotCount} sequential shots for a short cinematic video. ` +
      "Respond with ONLY a JSON array (no markdown fences, no commentary) of EXACTLY " +
      `${shotCount} elements, where each element is ` +
      '{"title": string, "description": string, "voiceover": string}. ' +
      'Every field is required and must be a non-empty string; use "" only if a shot truly has no ' +
      'voiceover line. "description" is the visual action/setting of that shot. "voiceover" is the ' +
      "narration line spoken during that shot. Shots must flow as one continuous story arc and " +
      "reference the same main character throughout. Do not mention clip duration or timing - " +
      "every shot is generated as a fixed 8-second video clip and that is handled separately.",
    user:
      `Idea:\n${idea}\n\nStory script:\n${story}\n\nMain character:\n${characterDescription}\n\n` +
      `Produce the JSON array of exactly ${shotCount} shots now.`,
  };
}

export function shotImagePromptPrompt(
  characterDescription: string,
  shot: { title: string; description: string }
) {
  return {
    system:
      "You write a single production-ready text-to-image prompt for one shot's first-frame " +
      "reference image. The prompt must explicitly instruct the model to preserve the exact " +
      "identity, face, hairstyle, outfit, and accessories of the reference character image " +
      "supplied alongside this prompt, while placing them in the shot's specific setting and " +
      "action. Ultra-detailed, photorealistic, cinematic composition, 8K. Output ONLY the image " +
      "prompt text, nothing else.",
    user:
      `Main character (for consistency, the actual reference image is attached separately):\n` +
      `${characterDescription}\n\nShot title: ${shot.title}\nShot description: ${shot.description}\n\n` +
      "Write the shot image prompt now.",
  };
}

export function shotVideoPromptPrompt(
  shot: { title: string; description: string; voiceover: string },
  shotImagePrompt: string,
  durationSeconds: number
) {
  return {
    system:
      "You write a production-ready Veo3-style video generation prompt for animating a single " +
      "still shot image into a short video clip. Focus on what changes over time: subtle motion, " +
      "facial animation, camera movement, and atmosphere - not a re-description of the static " +
      "image. Include a Voiceover line, a Camera Movement line, a Style line, and a Duration line. " +
      "Instruct the model to use the supplied image as the first frame and keep the character " +
      `identity, outfit, and setting identical throughout the clip. The clip is EXACTLY ` +
      `${durationSeconds} seconds long - the Duration line must read exactly "Duration: ${durationSeconds} ` +
      `seconds", all camera movement and action must be paced to fit within that time, and no other ` +
      "duration or second count may be mentioned anywhere else in the prompt. No preamble.",
    user:
      `Shot title: ${shot.title}\nShot description: ${shot.description}\nVoiceover: ${shot.voiceover}\n` +
      `Clip duration: exactly ${durationSeconds} seconds\n\n` +
      `First-frame image prompt (for context, the actual image is used as the first frame):\n${shotImagePrompt}\n\n` +
      "Write the video generation prompt now.",
  };
}
