// Prompt templates adapted from the "Meri AI Army" ChatGPT wizard transcript,
// restructured for fully automatic, non-conversational execution.

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
