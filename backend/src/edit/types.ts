// Shared contract for the edit pass (Editing-Quality-Plan.md). Backend director/assemble and the frontend panels use these types.

export type EditLayout = "full" | "punch" | "keyword" | "lower_third" | "split" | "graphic" | "end_card";
export type TransitionKind = "cut" | "fade" | "fadeblack" | "zoomin" | "smoothleft" | "dip";
export type SfxKind = "whoosh" | "riser" | "impact" | "pop" | "tick";

export interface EditBeat {
  shotId: string; // plan clip id, e.g. "shot-3"
  index: number; // 1-based shot number
  start: number; // seconds on the final timeline
  end: number;
  role: "hook" | "foreshadow" | "body" | "rehook" | "side_story" | "payoff" | "loop" | "bridge";
  layout: EditLayout;
  /** Punch-in scale reached during the shot (1 = none). Never above 1.2. */
  punch: number;
  /** Transition into this shot from the previous one. */
  transitionIn: TransitionKind;
  transitionSeconds: number;
  sfx: { kind: SfxKind; at: number; gainDb: number; take: number }[];
  /** One accent-coloured word per caption group, keyed by caption group index. */
  keyword?: string;
  /** Text card / chapter title / stat shown over this shot. */
  card?: { type: "chapter" | "stat" | "lower_third" | "end"; text: string; at: number; seconds: number };
  /** J-cut (narration starts early) or L-cut (narration trails), in seconds. */
  narrationOffset: number;
  /** Seconds into the clip where the punch-in ramp starts (default 0) and how long it takes (default 0.4). */
  punchAt?: number;
  punchSeconds?: number;
}

export interface EditStyle {
  id: string;
  label: string;
  grade: { contrast: number; saturation: number; gamma: number; warmth: number }; // eq/colorbalance inputs
  vignette: number; // 0-1 darkening strength at the corners
  grain: number; // noise strength, 0-8 (ffmpeg noise alls)
  accent: string; // ASS colour for the keyword accent, e.g. "&H0000D7FF&"
  musicMood: "tense" | "wonder" | "dark" | "upbeat" | "calm";
  musicGainDb: number; // under the voice
  duckDb: number;
}

export interface EditPlan {
  version: 1;
  style: EditStyle;
  format: "short" | "long";
  totalSeconds: number;
  beats: EditBeat[];
  music: { file: string | null; mood: string; gain: number; entryAt: number } | null;
  loop: boolean; // Short: last frame cross-fades into frame 1
  endCard: { seconds: number; text: string } | null; // long-form only
  chapters: { at: number; title: string }[];
  transitionKinds: TransitionKind[]; // distinct kinds used (at most 3 besides "cut")
  /** Bottom edge of the captions on a 1920-high canvas (research §04: at most 1248). */
  captionBottomY?: number;
  /** Narration delay inside each shot, seconds (matches plan.narration.delay). */
  narrationDelay?: number;
}

export interface EditCheck {
  id: string;
  ok: boolean;
  message: string;
  /** True when the critique fixed it automatically. */
  fixed?: boolean;
  /** Section of pharooresearch.md the rule comes from, e.g. "§12". */
  ref?: string;
}

export interface EditReview {
  passed: boolean;
  rounds: number;
  checks: EditCheck[];
}
