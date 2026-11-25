import fs from "fs";
import path from "path";
import { query } from "./db";
import { generateText } from "./openai";
import { makeImage } from "./images";
import { generateClipWithFallback } from "./providers/clips";
import {
  storyPrompt,
  characterPrompt,
  characterImagePromptPrompt,
  scenesPrompt,
  shotImagePromptPrompt,
  shotVideoPromptPrompt,
} from "./prompts";
import { DEFAULT_SHOT_DURATION_SECONDS, type SceneBreakdownItem } from "./types";
import { mapWithConcurrency } from "./concurrency";

// gpt-image-2 enforces a low per-minute rate limit on image edit calls; keep shot
// generation well under it instead of firing all shots at once and relying on retries.
const SHOT_CONCURRENCY = Number(process.env.SHOT_CONCURRENCY || 3);

/** Shot images are portrait because the videos are vertical (9:16); set SHOT_IMAGE_SIZE=1536x1024 for landscape. */
const SHOT_IMAGE_SIZE = (process.env.SHOT_IMAGE_SIZE as "1024x1024" | "1024x1536" | "1536x1024") || "1024x1536";

export const STORAGE_ROOT =path.join(process.cwd(), "storage", "generated");

function projectDir(projectId: number): string {
  const dir = path.join(STORAGE_ROOT, String(projectId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The model-written video prompt can contain a "Voiceover:" line (the words the narrator will say). Sent to a video
 * model it risks spoken or burned-in text, so those lines are removed here (the narration is voiced separately) and
 * the clip is told to stay silent and text-free.
 */
export function cleanVideoPrompt(prompt: string): string {
  const kept = prompt
    .split(/\r?\n/)
    .filter((line) => !/^\s*(voice-?over|narration|narrator)\s*:/i.test(line))
    .join("\n")
    .trim();
  return `${kept}\n\nAudio: natural ambient sound only, no speech, no music. No text, no captions, no logos, no watermarks.`;
}

async function saveImage(projectId: number, filename: string, data: Buffer): Promise<string> {
  const dir = projectDir(projectId);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, data);
  // Path relative to STORAGE_ROOT, used to build the /api/images/... URL.
  return path.join(String(projectId), filename).replace(/\\/g, "/");
}

function parseSceneBreakdown(raw: string, expectedCount: number): SceneBreakdownItem[] {
  const cleaned = raw.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) {
    throw new Error("Scene breakdown response was not a JSON array");
  }
  if (parsed.length !== expectedCount) {
    throw new Error(
      `Scene breakdown returned ${parsed.length} shots but ${expectedCount} were requested`
    );
  }
  return parsed.map((item, i) => {
    const title = typeof item?.title === "string" && item.title.trim() ? item.title.trim() : `Shot ${i + 1}`;
    const description = typeof item?.description === "string" ? item.description.trim() : "";
    const voiceover = typeof item?.voiceover === "string" ? item.voiceover.trim() : "";
    if (!description) {
      throw new Error(`Scene ${i + 1} is missing a description`);
    }
    return { title, description, voiceover };
  });
}

/**
 * Logs the full technical error server-side and returns a short, human-readable
 * message safe to store and show to end users — never the raw exception text,
 * which may contain third-party response bodies, status codes, or internal detail.
 */
function friendlyError(context: string, err: unknown): string {
  console.error(`${context}:`, err);
  return `${context}. Please try again.`;
}

async function markProjectError(projectId: number, message: string) {
  await query("UPDATE projects SET status = 'error', error_message = ? WHERE id = ?", [message, projectId]);
}

async function markShotError(shotId: number, message: string) {
  await query("UPDATE shots SET status = 'error', error_message = ? WHERE id = ?", [message, shotId]);
}

async function runShot(
  projectId: number,
  shotId: number,
  shotNumber: number,
  scene: SceneBreakdownItem,
  characterDescription: string,
  characterImageAbsPath: string,
  durationSeconds: number
) {
  try {
    const { system: ipSys, user: ipUser } = shotImagePromptPrompt(characterDescription, scene);
    const imagePrompt = await generateText(ipSys, ipUser);
    await query("UPDATE shots SET image_prompt = ?, status = 'image_prompt' WHERE id = ?", [imagePrompt, shotId]);

    const [pr] = await query<any[]>("SELECT image_provider, image_fallback FROM projects WHERE id = ?", [projectId]);
    const made = await makeImage({ prompt: imagePrompt, size: SHOT_IMAGE_SIZE, refs: [characterImageAbsPath], provider: pr?.image_provider, fallback: !!pr?.image_fallback });
    const imagePath = await saveImage(projectId, `shot-${shotNumber}.png`, made.buffer);
    await query("UPDATE shots SET image_path = ?, status = 'image', image_provider_used = ?, image_ms = ? WHERE id = ?", [imagePath, made.provider, made.ms, shotId]);

    const { system: vpSys, user: vpUser } = shotVideoPromptPrompt(scene, imagePrompt, durationSeconds);
    const videoPrompt = await generateText(vpSys, vpUser);
    await query("UPDATE shots SET video_prompt = ?, status = 'done' WHERE id = ?", [videoPrompt, shotId]);
  } catch (err: any) {
    await markShotError(shotId, friendlyError(`Shot ${shotNumber} generation failed`, err));
  }
}

/** Re-renders a single shot's image from its existing image_prompt (triggered by the user from the UI). */
export async function runShotImage(projectId: number, shotId: number): Promise<void> {
  const [shot] = await query<any[]>("SELECT * FROM shots WHERE id = ? AND project_id = ?", [shotId, projectId]);
  if (!shot) throw new Error(`Shot ${shotId} not found in project ${projectId}`);
  if (!shot.image_prompt) throw new Error("Shot has no image prompt yet");

  const [project] = await query<any[]>("SELECT * FROM projects WHERE id = ?", [projectId]);
  if (!project) throw new Error(`Project ${projectId} not found`);

  // Niche-aware projects: re-render from the anchors that appear in this shot (or from text when there are none).
  // The shot keeps its video prompt; only its image (and any old clip) is replaced.
  if (project.niche) {
    try {
      await query("UPDATE shots SET status = 'image', video_path = NULL, image_regenerations = image_regenerations + 1 WHERE id = ?", [shotId]);
      let keys: string[] = [];
      try {
        keys = JSON.parse(shot.anchor_keys || "[]");
      } catch {
        keys = [];
      }
      const anchors = keys.length ? await query<any[]>("SELECT image_path FROM anchors WHERE project_id = ? AND `key` IN (?) AND image_path IS NOT NULL", [projectId, keys]) : [];
      const refs = anchors.map((a) => path.join(STORAGE_ROOT, a.image_path));
      const size = project.format === "long" ? "1536x1024" : "1024x1536";
      const made = await makeImage({ prompt: shot.image_prompt, size, refs, provider: project.image_provider, fallback: !!project.image_fallback });
      const imagePath = await saveImage(projectId, `shot-${shot.shot_number}.png`, made.buffer);
      await query("UPDATE shots SET image_path = ?, status = 'done', image_provider_used = ?, image_ms = ? WHERE id = ?", [imagePath, made.provider, made.ms, shotId]);
    } catch (err: any) {
      await markShotError(shotId, friendlyError("Image regeneration failed", err));
      throw err;
    }
    return;
  }
  if (!project.character_image_path) throw new Error("Project has no character reference image yet");

  try {
    await query(
      "UPDATE shots SET status = 'image_prompt', video_prompt = NULL, video_path = NULL, image_regenerations = image_regenerations + 1 WHERE id = ?",
      [shotId]
    );

    const characterImageAbsPath = path.join(STORAGE_ROOT, project.character_image_path);
    const made = await makeImage({ prompt: shot.image_prompt, size: SHOT_IMAGE_SIZE, refs: [characterImageAbsPath], provider: project.image_provider, fallback: !!project.image_fallback });
    const imagePath = await saveImage(projectId, `shot-${shot.shot_number}.png`, made.buffer);
    await query("UPDATE shots SET image_path = ?, status = 'image', image_provider_used = ?, image_ms = ? WHERE id = ?", [imagePath, made.provider, made.ms, shotId]);

    const { system: vpSys, user: vpUser } = shotVideoPromptPrompt(
      { title: shot.title, description: shot.description, voiceover: shot.voiceover },
      shot.image_prompt,
      shot.duration_seconds || DEFAULT_SHOT_DURATION_SECONDS
    );
    const videoPrompt = await generateText(vpSys, vpUser);
    await query("UPDATE shots SET video_prompt = ?, status = 'done' WHERE id = ?", [videoPrompt, shotId]);
  } catch (err: any) {
    await markShotError(shotId, friendlyError("Image regeneration failed", err));
    throw err;
  }
}

/** Updates a single shot's clip duration and regenerates its video prompt to match (triggered from the UI). */
export async function runShotDuration(projectId: number, shotId: number, durationSeconds: number): Promise<void> {
  const [shot] = await query<any[]>("SELECT * FROM shots WHERE id = ? AND project_id = ?", [shotId, projectId]);
  if (!shot) throw new Error(`Shot ${shotId} not found in project ${projectId}`);
  if (!shot.image_prompt) throw new Error("Shot has no image prompt yet");

  try {
    // The previously generated video (if any) was paced for the old duration and no longer matches.
    await query(
      "UPDATE shots SET duration_seconds = ?, status = 'video_prompt', video_prompt = NULL, video_path = NULL WHERE id = ?",
      [durationSeconds, shotId]
    );

    const { system: vpSys, user: vpUser } = shotVideoPromptPrompt(
      { title: shot.title, description: shot.description, voiceover: shot.voiceover },
      shot.image_prompt,
      durationSeconds
    );
    const videoPrompt = await generateText(vpSys, vpUser);
    await query("UPDATE shots SET video_prompt = ?, status = 'done' WHERE id = ?", [videoPrompt, shotId]);
  } catch (err: any) {
    await markShotError(shotId, friendlyError("Clip duration update failed", err));
    throw err;
  }
}

/** Generates the video for a single shot on demand (triggered by the user from the UI). */
export async function runShotVideo(projectId: number, shotId: number): Promise<void> {
  const [shot] = await query<any[]>("SELECT * FROM shots WHERE id = ? AND project_id = ?", [shotId, projectId]);
  if (!shot) throw new Error(`Shot ${shotId} not found in project ${projectId}`);
  if (!shot.image_path) throw new Error("Shot has no image yet");
  if (!shot.video_prompt) throw new Error("Shot has no video prompt yet");

  try {
    await query("UPDATE shots SET status = 'video' WHERE id = ?", [shotId]);

    const [project] = await query<any[]>("SELECT niche, format FROM projects WHERE id = ?", [projectId]);
    const niche = Boolean(project?.niche);
    let imageAbsPath = path.join(STORAGE_ROOT, shot.image_path);
    // Continuity: a shot that continues the previous one starts from that clip's LAST frame, so the two shots join
    // without a jump. If the previous clip does not exist yet, the shot's own image is used.
    if (niche && shot.continues_previous && shot.shot_number > 1) {
      const [prev] = await query<any[]>("SELECT video_path FROM shots WHERE project_id = ? AND shot_number = ?", [projectId, shot.shot_number - 1]);
      const prevAbs = prev?.video_path ? path.join(STORAGE_ROOT, prev.video_path) : "";
      if (prevAbs && fs.existsSync(prevAbs)) {
        const { extractLastFrame } = await import("./media/clips");
        imageAbsPath = await extractLastFrame(prevAbs, path.join(projectDir(projectId), "clips", `shot-${shot.shot_number}-start.png`));
      }
    }
    // The clip comes from the first available provider in Settings > provider order (Veoframe first, then
    // Google Flow, Higgsfield and fal), with the shot image as the first frame.
    const clip = await generateClipWithFallback({
      planId: `project-${projectId}`,
      clipId: `shot-${shot.shot_number}`,
      // Niche prompts are already built clean (no narration, an Audio line, no text); old prompts need cleaning.
      prompt: niche ? shot.video_prompt : cleanVideoPrompt(shot.video_prompt),
      seconds: shot.duration_seconds || DEFAULT_SHOT_DURATION_SECONDS,
      // Same orientation as the video: the project's format, else the shot-image setting (portrait by default).
      aspect: niche ? (project.format === "long" ? "16:9" : "9:16") : SHOT_IMAGE_SIZE === "1536x1024" ? "16:9" : "9:16",
      referenceImage: imageAbsPath,
      runDir: projectDir(projectId),
    }, { automaticOnly: true });
    const videoPath = path.relative(STORAGE_ROOT, clip.file).replace(/\\/g, "/");
    await query("UPDATE shots SET video_path = ?, provider = ?, status = 'done', error_message = NULL WHERE id = ?", [videoPath, clip.provider, shotId]);
  } catch (err: any) {
    await markShotError(shotId, friendlyError("Video generation failed", err));
    throw err;
  }
}

export async function runPipeline(projectId: number): Promise<void> {
  let stage = "Starting the pipeline";
  try {
    const [project] = await query<any[]>("SELECT * FROM projects WHERE id = ?", [projectId]);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const idea: string = project.idea_prompt;
    const shotCount: number = project.shot_count;
    const shotDurationSeconds: number = project.shot_duration_seconds || DEFAULT_SHOT_DURATION_SECONDS;

    // Step 1: story
    stage = "Writing the story";
    const { system: storySys, user: storyUser } = storyPrompt(idea);
    const story = await generateText(storySys, storyUser);
    await query("UPDATE projects SET story_script = ?, status = 'story' WHERE id = ?", [story, projectId]);

    // Step 2: character design
    stage = "Designing the character";
    const { system: charSys, user: charUser } = characterPrompt(idea, story);
    const characterDescription = await generateText(charSys, charUser);
    await query("UPDATE projects SET character_description = ?, status = 'character' WHERE id = ?", [
      characterDescription,
      projectId,
    ]);

    // Step 3: character reference image
    stage = "Generating the character reference image";
    const { system: cipSys, user: cipUser } = characterImagePromptPrompt(characterDescription);
    const characterImagePrompt = await generateText(cipSys, cipUser);
    const [pr0] = await query<any[]>("SELECT image_provider, image_fallback FROM projects WHERE id = ?", [projectId]);
    const characterImageBuffer = (await makeImage({ prompt: characterImagePrompt, size: "1024x1024", provider: pr0?.image_provider, fallback: !!pr0?.image_fallback })).buffer;
    const characterImagePath = await saveImage(projectId, "character.png", characterImageBuffer);
    await query(
      "UPDATE projects SET character_image_prompt = ?, character_image_path = ? WHERE id = ?",
      [characterImagePrompt, characterImagePath, projectId]
    );

    // Step 4: scene breakdown
    stage = "Planning the scene breakdown";
    const { system: scenesSys, user: scenesUser } = scenesPrompt(idea, story, characterDescription, shotCount);
    const scenesRaw = await generateText(scenesSys, scenesUser);
    const scenes = parseSceneBreakdown(scenesRaw, shotCount);

    await query("UPDATE projects SET status = 'scenes' WHERE id = ?", [projectId]);

    const shotIds: number[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const result = await query<any>(
        "INSERT INTO shots (project_id, shot_number, title, duration_seconds, description, voiceover) VALUES (?, ?, ?, ?, ?, ?)",
        [projectId, i + 1, scene.title, shotDurationSeconds, scene.description, scene.voiceover]
      );
      shotIds.push(result.insertId);
    }

    await query("UPDATE projects SET status = 'shots' WHERE id = ?", [projectId]);

    // Step 5: per-shot image + video prompt, capped concurrency (see SHOT_CONCURRENCY above).
    stage = "Generating shots";
    const characterImageAbsPath = path.join(STORAGE_ROOT, characterImagePath);
    await mapWithConcurrency(scenes, SHOT_CONCURRENCY, (scene, i) =>
      runShot(projectId, shotIds[i], i + 1, scene, characterDescription, characterImageAbsPath, shotDurationSeconds)
    );

    await query("UPDATE projects SET status = 'done' WHERE id = ?", [projectId]);
  } catch (err: any) {
    await markProjectError(projectId, friendlyError(stage, err));
  }
}
