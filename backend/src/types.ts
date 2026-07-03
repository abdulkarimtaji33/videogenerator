export type ProjectStatus = "pending" | "story" | "character" | "scenes" | "shots" | "done" | "error";
export type ShotStatus = "pending" | "image_prompt" | "image" | "video_prompt" | "video" | "done" | "error";

export interface Project {
  id: number;
  idea_prompt: string;
  shot_count: number;
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
  description: string | null;
  voiceover: string | null;
  image_prompt: string | null;
  image_path: string | null;
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
  duration: string;
  description: string;
  voiceover: string;
}
