export type ProjectStatus = "pending" | "story" | "character" | "scenes" | "shots" | "done" | "error";
export type ShotStatus = "pending" | "image_prompt" | "image" | "video_prompt" | "video" | "done" | "error";

export interface Project {
  id: number;
  idea_prompt: string;
  shot_count: number;
  shot_duration_seconds: number;
  status: ProjectStatus;
  story_script: string | null;
  character_description: string | null;
  character_image_prompt: string | null;
  character_image_path: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface Shot {
  id: number;
  project_id: number;
  shot_number: number;
  title: string | null;
  duration: string | null;
  duration_seconds: number;
  description: string | null;
  voiceover: string | null;
  image_prompt: string | null;
  image_path: string | null;
  image_regenerations: number;
  video_prompt: string | null;
  video_path: string | null;
  status: ShotStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithShots extends Project {
  shots: Shot[];
}

export interface SceneBreakdownItem {
  title: string;
  description: string;
  voiceover: string;
}

/** Every generated shot defaults to an 8-second clip; the user can change it per-shot from the UI. */
export const DEFAULT_SHOT_DURATION_SECONDS = 8;
export const MIN_SHOT_DURATION_SECONDS = 1;
export const MAX_SHOT_DURATION_SECONDS = 30;

/** A shot's image can be manually regenerated at most this many times, to bound per-shot image spend. */
export const MAX_IMAGE_REGENERATIONS = 2;
