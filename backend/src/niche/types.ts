// Shared contract for the niche-aware pipeline (plan: C:\Users\unknown\.claude\plans\now-think-deeply-and-quizzical-abelson.md).
// Everything that crosses a module boundary is typed here, so the pipeline, the script review, the SEO step,
// the YouTube publisher and the UI can be written in parallel.

export type VideoFormat = "short" | "long";

/** What recurs visually across shots. */
export type SubjectMode = "subject" | "place" | "character" | "cast" | "mixed" | "none";

export type AnchorKind = "character" | "subject" | "place" | "object";

/** A recurring visual subject of the video (a planet, a person, a city). Zero to four per video. */
export interface AnchorSpec {
  /** lowercase-dash id used by shots to refer to it, e.g. "saturn" */
  key: string;
  kind: AnchorKind;
  name: string;
  /** The features that must stay identical in every shot (shape, colour, outfit, ...). */
  lockedFeatures: string;
  /** False for an anchor that needs no reference image (e.g. a generic ocean). */
  needsReference: boolean;
  /** Characters only: the gender of the voice that speaks as them (picks the voice and the grammar of Urdu and Hindi lines). */
  gender?: "male" | "female" | "neutral";
}

export interface CreativeBrief {
  niche: string;
  format: VideoFormat;
  lengthSeconds: number;
  /** One sentence the video must deliver. */
  promise: string;
  audience: string;
  subjectMode: SubjectMode;
  anchors: AnchorSpec[];
  /** One sentence repeated in every image and clip prompt so all shots share a look. */
  styleBible: string;
  tone: string;
  avoid: string[];
  /** "anime": every image and clip prompt asks for an anime look instead of photoreal. */
  visualStyle?: "anime";
}

export type BeatRole = "hook" | "foreshadow" | "body" | "rehook" | "side_story" | "payoff" | "loop" | "bridge";

/** One generated clip (about 8 seconds) of the video. */
export interface ScriptShot {
  /** 1-based */
  index: number;
  role: BeatRole;
  /** How this shot follows the previous one. Must be "but" or "therefore" (never "and then"); null for the first shot. */
  link: "but" | "therefore" | null;
  /** What the narrator says during this shot. */
  narration: string;
  /** What is on screen (one focal moment). */
  visual: string;
  /** Keys of the anchors that appear in this shot. */
  anchorKeys: string[];
  /** True when the shot continues the previous one (starts from its last frame). */
  continuesPrevious: boolean;
  loopOpened?: string;
  loopClosed?: string;
  /** Indexes into the verified facts used by this shot's narration. */
  factIds?: number[];
  /** Beat number for long-form (45-90 s beats are split into several shots). */
  beat?: number;
  /** Urdu or Hindi videos: the line as spoken (native script), its Roman transliteration (captions) and who says it. */
  spoken?: string;
  roman?: string;
  /** A character anchor key, or "narrator". */
  speaker?: string;
}

export interface Script {
  format: VideoFormat;
  promise: string;
  hook: { type: string; line: string; visual: string };
  shots: ScriptShot[];
}

export interface VerifiedFact {
  id: number;
  claim: string;
  /** Where a viewer could check it (a name or URL the model is confident exists). */
  source: string;
}

export interface ThumbnailConcept {
  focalSubject: string;
  /** 0-5 words overlaid on the image. */
  words: string;
  anchorKey?: string;
}

export interface SeoPackage {
  mainKeyword: string;
  relatedKeywords: string[];
  /** Three titles that differ in angle, not wording. */
  titles: { angle: string; title: string }[];
  chosenTitle: string;
  description: string;
  tags: string[];
  hashtags: string[];
  category: string;
  thumbnailConcepts: ThumbnailConcept[];
}

export interface ReviewCheck {
  id: string;
  ok: boolean;
  message: string;
  /** True when a rewrite round fixed it. */
  fixed?: boolean;
}

export interface ReviewReport {
  enabled: boolean;
  passed: boolean;
  rounds: number;
  checks: ReviewCheck[];
}

export interface NicheProfile {
  id: string;
  label: string;
  /** Strength of the niche per format, from the niche research. */
  formatFit: { short: "strong" | "medium" | "weak"; long: "strong" | "medium" | "weak" };
  defaultLengthSeconds: { short: number; long: number };
  subjectMode: SubjectMode;
  structure: "explainer" | "story" | "what_if" | "list";
  visualRules: string[];
  /** Hook type ids from hooks/library.ts. */
  preferredHookTypes: string[];
  factsRequired: boolean;
  policyNotes: string[];
  voice: string;
  /** Terms that show the idea belongs to this niche (used by the Auto picker). */
  keywords: string[];
  visualStyle?: "anime";
}

/** Columns added to `projects` by migration 005, and how the API returns them (parsed, camelCase). */
export interface ProjectExtras {
  niche: string | null;
  format: VideoFormat;
  lengthSeconds: number | null;
  reviewEnabled: boolean;
  autoPublish: boolean;
  brief: CreativeBrief | null;
  facts: VerifiedFact[] | null;
  seo: SeoPackage | null;
  hook: { type: string; line: string; visual: string; score?: number } | null;
  script: Script | null;
  review: ReviewReport | null;
  costEstimate: { clips: number; minutes: number; quotaLeft?: number } | null;
  chosenTitle: string | null;
  thumbnails: { variant: "A" | "B"; path: string }[] | null;
  youtubeVideoId: string | null;
  publishStatus: string | null;
}
