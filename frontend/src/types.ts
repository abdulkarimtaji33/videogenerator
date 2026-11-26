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
  /** Progress of the one-click whole-video run: "clip 2 of 4", "narration", "assembling", "qa", "video ready"... */
  stage: string | null;
  /** Finished video with narration and captions, relative to the media root ("shorts/<id>/final/<file>.mp4"). */
  final_video_path: string | null;
  qa_status: string | null;
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
  /** Which provider made the clip (veoframe, google-flow, ...). */
  provider: string | null;
  status: ShotStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  // Niche pipeline columns (missing on old shots).
  beat_role?: string | null;
  beat_index?: number | null;
  anchor_keys?: string[] | null;
  continues_previous?: number | boolean | null;
  link?: "but" | "therefore" | null;
  narration_fits?: number | boolean | null;
  /** Urdu and Hindi videos: the Roman words used as captions, the English source line, and who speaks. */
  caption_text?: string | null;
  narration_en?: string | null;
  speaker?: string | null;
  imageProviderUsed?: string | null;
  imageMs?: number | null;
}

export type VideoFormat = "short" | "long";
export type SubjectMode = "subject" | "place" | "character" | "cast" | "mixed" | "none";
export type AnchorKind = "character" | "subject" | "place" | "object";
export type BeatRole = "hook" | "foreshadow" | "body" | "rehook" | "side_story" | "payoff" | "loop" | "bridge";

// Mirrors backend/src/niche/types.ts (the API returns these parsed, camelCase).
export interface CreativeBrief {
  niche: string;
  format: VideoFormat;
  lengthSeconds: number;
  promise: string;
  audience: string;
  subjectMode: SubjectMode;
  anchors: { key: string; kind: AnchorKind; name: string; lockedFeatures: string; needsReference: boolean }[];
  styleBible: string;
  tone: string;
  avoid: string[];
}

export interface VerifiedFact {
  id: number;
  claim: string;
  source: string;
}

export interface SeoPackage {
  mainKeyword: string;
  relatedKeywords: string[];
  titles: { angle: string; title: string }[];
  chosenTitle: string;
  description: string;
  tags: string[];
  hashtags: string[];
  category: string;
  thumbnailConcepts: { focalSubject: string; words: string; anchorKey?: string }[];
}

export interface ScriptShot {
  index: number;
  role: BeatRole;
  link: "but" | "therefore" | null;
  narration: string;
  visual: string;
  anchorKeys: string[];
  continuesPrevious: boolean;
  loopOpened?: string;
  loopClosed?: string;
  factIds?: number[];
  beat?: number;
}

export interface Script {
  format: VideoFormat;
  promise: string;
  hook: { type: string; line: string; visual: string };
  shots: ScriptShot[];
}

export interface ReviewReport {
  enabled: boolean;
  passed: boolean;
  rounds: number;
  checks: { id: string; ok: boolean; message: string; fixed?: boolean }[];
}

export interface Anchor {
  key: string;
  kind: AnchorKind;
  name: string;
  lockedFeatures: string;
  /** Relative image path ("12/anchor-saturn.png") or null while it is being made. */
  imagePath: string | null;
  status: string;
  imageProviderUsed?: string | null;
  imageMs?: number | null;
}

export type PublishPrivacy = "private" | "unlisted" | "public" | "scheduled";

/** Fields added to the project by the niche pipeline; all are missing or null on old projects. */
export interface ProjectExtras {
  niche?: string | null;
  format?: VideoFormat;
  length_seconds?: number | null;
  review_enabled?: number | boolean | null;
  auto_publish?: number | boolean | null;
  chosen_title?: string | null;
  youtube_video_id?: string | null;
  publish_status?: string | null;
  brief?: CreativeBrief | null;
  facts?: VerifiedFact[] | null;
  seo?: SeoPackage | null;
  hook?: { type: string; line: string; visual: string; score?: number } | null;
  script?: Script | null;
  review?: ReviewReport | null;
  costEstimate?: { clips: number; minutes: number; quotaLeft?: number } | null;
  thumbnails?: { variant: "A" | "B"; path: string }[] | null;
  anchors?: Anchor[] | null;
  thumbnail_path?: string | null;
  imageProvider?: ImageProviderId | null;
  imageFallback?: number | boolean | null;
  edit?: EditPlan | null;
  editReview?: EditReview | null;
}

export interface ProjectWithShots extends Project, ProjectExtras {
  shots: Shot[];
}

export interface VeoframeStatus {
  signedIn: boolean;
  quotaLeft: number;
  perDay: number;
}

export type ImageProviderId = "flux-local" | "openai" | "fal";

export interface ImageProviderStatus {
  id: ImageProviderId;
  label: string;
  configured: boolean;
  online?: boolean;
  detail?: string;
  avgSeconds?: number;
}

export interface ImageSystemStatus {
  default: string;
  providers: ImageProviderStatus[];
  flux: { url: string; model: string; steps: number; lastMs?: number | null };
}

export type TextProviderId = "gemini" | "ollama" | "openai";

export interface TextProviderStatus {
  id: TextProviderId;
  label: string;
  configured: boolean;
  online?: boolean;
  detail?: string;
}

export interface TextSystemStatus {
  provider: TextProviderId;
  fallback: boolean;
  providers: TextProviderStatus[];
  gemini: { model: string; thinking: string; thinkingLevels: string[]; recommended: { id: string; note: string }[] };
  ollama: {
    url: string;
    model: string;
    think: boolean;
    numCtx: number;
    temperature: number;
    installed: string[];
    recommended: { id: string; note: string }[];
  };
}

export interface TextTestResult {
  ok: boolean;
  provider: string;
  model?: string;
  ms: number;
  sample?: string;
  error?: string;
}

export interface ImageTestResult {
  ok: boolean;
  provider: string;
  ms: number;
  imageBase64?: string;
  error?: string;
}

// Mirrors backend/src/edit/types.ts.
export type EditLayout = "full" | "punch" | "keyword" | "lower_third" | "split" | "graphic" | "end_card";
export type TransitionKind = "cut" | "fade" | "fadeblack" | "zoomin" | "smoothleft" | "dip";
export type SfxKind = "whoosh" | "riser" | "impact" | "pop" | "tick";

export interface EditBeat {
  shotId: string;
  index: number;
  start: number;
  end: number;
  role: BeatRole;
  layout: EditLayout;
  punch: number;
  transitionIn: TransitionKind;
  transitionSeconds: number;
  sfx: { kind: SfxKind; at: number; gainDb: number; take: number }[];
  keyword?: string;
  card?: { type: "chapter" | "stat" | "lower_third" | "end"; text: string; at: number; seconds: number };
  narrationOffset: number;
}

export interface EditStyle {
  id: string;
  label: string;
  grade: { contrast: number; saturation: number; gamma: number; warmth: number };
  vignette: number;
  grain: number;
  accent: string;
  musicMood: "tense" | "wonder" | "dark" | "upbeat" | "calm";
  musicGainDb: number;
  duckDb: number;
}

export interface EditPlan {
  version: 1;
  style: EditStyle;
  format: "short" | "long";
  totalSeconds: number;
  beats: EditBeat[];
  music: { file: string | null; mood: string; gain: number; entryAt: number } | null;
  loop: boolean;
  endCard: { seconds: number; text: string } | null;
  chapters: { at: number; title: string }[];
  transitionKinds: TransitionKind[];
}

export interface EditCheck {
  id: string;
  ok: boolean;
  message: string;
  fixed?: boolean;
  ref?: string;
}

export interface EditReview {
  passed: boolean;
  rounds: number;
  checks: EditCheck[];
}
