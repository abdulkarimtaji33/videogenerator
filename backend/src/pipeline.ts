import fs from "fs";
import path from "path";
import { query } from "./db";
import { generateText, generateImage, generateImageWithReference } from "./openai";
import { generateVideoFromImage } from "./higgsfield";
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

export const STORAGE_ROOT = path.join(process.cwd(), "storage", "generated");

function projectDir(projectId: number): string {
  const dir = path.join(STORAGE_ROOT, String(projectId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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

    const imageBuffer = await generateImageWithReference(imagePrompt, characterImageAbsPath);
    const imagePath = await saveImage(projectId, `shot-${shotNumber}.png`, imageBuffer);
    await query("UPDATE shots SET image_path = ?, status = 'image' WHERE id = ?", [imagePath, shotId]);

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
  if (!project.character_image_path) throw new Error("Project has no character reference image yet");

  try {
    await query(
      "UPDATE shots SET status = 'image_prompt', video_prompt = NULL, video_path = NULL, image_regenerations = image_regenerations + 1 WHERE id = ?",
      [shotId]
    );

    const characterImageAbsPath = path.join(STORAGE_ROOT, project.character_image_path);
    const imageBuffer = await generateImageWithReference(shot.image_prompt, characterImageAbsPath);
    const imagePath = await saveImage(projectId, `shot-${shot.shot_number}.png`, imageBuffer);
    await query("UPDATE shots SET image_path = ?, status = 'image' WHERE id = ?", [imagePath, shotId]);

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

    const imageAbsPath = path.join(STORAGE_ROOT, shot.image_path);
    const videoBuffer = await generateVideoFromImage(imageAbsPath, shot.video_prompt);
    const videoPath = await saveImage(projectId, `shot-${shot.shot_number}.mp4`, videoBuffer);
    await query("UPDATE shots SET video_path = ?, status = 'done' WHERE id = ?", [videoPath, shotId]);
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
    const characterImageBuffer = await generateImage(characterImagePrompt);
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
