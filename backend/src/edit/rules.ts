// Every number the edit pass uses, with the section of pharooresearch.md (or the auto-video-edit skill) it comes from.
// Nothing else in src/edit should hold a magic number: import it from here.

export const FPS = 30;
export const FRAME_S = 1 / FPS;

// ---- Captions (§04, §22) ----
/** Portrait 1080x1920: the caption bottom edge must be at least 672 px from the bottom, so y <= 1248. */
export const CAPTION_BOTTOM_MAX_Y = 1248; // §04 §22
/** Max reading speed, characters per second (Netflix adult). */
export const MAX_CPS = 20; // §04
export const MAX_CAPTION_CHARS_PER_LINE = 42; // §04
/** Social captions start 0.1-0.3 s into the video, never exactly 0. */
export const CAPTION_FIRST_START_S = 0.1; // §04
/** Minimum caption duration: 20 frames at 24 fps (about 0.83 s); one-word groups may be shorter. */
export const CAPTION_MIN_S = 20 / 24; // §04
export const CAPTION_WORDS_PER_GROUP = 3; // §04 (2-3 words for high energy)

// ---- Camera moves / punch-ins (§09) ----
/** Alternating punch levels; the same level is never used twice in a row. */
export const PUNCH_LEVELS = [1, 1.12, 1, 1.2] as const; // §09 + skill style default
export const PUNCH_MAX = 1.2; // §09 (clips are 576x1024: no more than 1.2 before the picture goes soft)
export const HOOK_PUNCH = 1.12; // §09 hook: 1.0 -> 1.12
export const HOOK_PUNCH_S = 0.4; // plan 1.4 hook punch-in length
export const PUNCH_RAMP_S = 0.35; // inner punch ease length (skill: eased, not a snap)
/** A shot longer than this gets an inner punch so nothing sits unchanged. */
export const INNER_PUNCH_AFTER_S = 5; // §12
export const INNER_PUNCH_AT_S = 4; // plan 1.4 body: inner punch at about 4 s

// ---- Pacing (§12) ----
/** No stretch of picture without any change for longer than this. */
export const STATIC_MAX_S = 8; // §12
/** Visual change every 3-5 s for short-form, 6-9 s for long-form (skill style default). */
export const VISUAL_CHANGE_SHORT_S: [number, number] = [3, 5]; // §12
export const VISUAL_CHANGE_LONG_S: [number, number] = [6, 9]; // §12
export const HOOK_WINDOW_S = 2; // §13 hook inside the first 1-2 s

// ---- Transitions (§02) ----
export const MAX_TRANSITION_KINDS = 3; // §02 (excluding hard cuts)
export const TRANSITION_S = 0.3; // skill: quick zoom/blur 0.3 s, only on topic changes
/** Share of seams that may carry a visible transition; hard cuts are the default. */
export const MAX_TRANSITION_SHARE = 1 / 3; // §02
export const MIN_TRANSITIONS_WHEN_FOUR_SHOTS = 2; // plan phase 4: "2-3 motivated transitions"

// ---- Titles and text (§05) ----
export const TEXT_HOLD_BASE_S = 0.5; // §05
export const TEXT_HOLD_PER_WORD_S = 0.3; // §05
export const textHold = (words: number) => TEXT_HOLD_BASE_S + TEXT_HOLD_PER_WORD_S * Math.max(1, words);
export const SAFE_BOX = 0.8; // §05 80% title-safe box

// ---- Audio (§11) ----
export const LUFS_TARGET = -14; // §11 social/YouTube
export const TRUE_PEAK_DB = -1; // §11
export const LRA = 11;
export const VOICE_HIGHPASS_HZ = 80; // §11 (80-100 Hz)
export const VOICE_COMP_RATIO = 3; // §11 (1.5:1 .. 3:1)
export const VOICE_COMP_THRESHOLD_DB = -18; // §11
export const MUSIC_VOLUME = 0.14; // §11 music under voice about 0.14
export const MUSIC_UNDER_VOICE_DB = [-18, -20]; // §11 bed 18-20 dB below the voice
export const DUCK_DB_RANGE: [number, number] = [6, 12]; // §11
export const DUCK_ATTACK_MS = 120; // §11 attack 100-300 ms
export const DUCK_RELEASE_MS = 600; // §11 release 500-1000 ms
export const MUSIC_FADE_IN_S = 1;
export const MUSIC_FADE_OUT_S = 2;
export const MUSIC_MIN_VIDEO_S = 15; // skill: music only over about 15 s

// ---- Sound design (§20) ----
export const SFX_OVER_BED_DB: [number, number] = [3, 6]; // §20 each hit 3-6 dB over the bed
export const SFX_OFFSET_FRAMES = 1; // §20 the peak lands one frame after its picture
export const SFX_OFFSET_S = SFX_OFFSET_FRAMES * FRAME_S;
/** At most one effect per 3 s (skill style default; editing-rules says 2-3 s). */
export const SFX_MIN_GAP_S = 3; // §20 + skill
export const SFX_TAKES = 3; // §20 rotate 2-3 takes
export const RISER_S = 2; // length of the bundled riser files
export const RISER_SILENCE_FRAMES = 3; // §20 1-3 frames of silence before the impact
export const RISER_SILENCE_S = RISER_SILENCE_FRAMES * FRAME_S;
export const IMPACT_HOLD_S = 0.5; // plan 1.4: held 0.3-0.75 s
export const RISERS_PER_FILM = 1; // §20 riser into impact once in the film
export const IMPACTS_PER_FILM = 1; // §20
export const SFX_PRIORITY: Record<string, number> = { impact: 5, riser: 4, whoosh: 3, pop: 2, tick: 1 };

// ---- Textures and colour (§10, §18) ----
export const GRAIN_PCT: [number, number] = [2, 3]; // §18 film grain 2-3%
export const GRAIN_MAX = 4; // skill: keep grain below about 4%
export const VIGNETTE_PCT = 0.12; // §18 12%
export const VIGNETTE_ANGLE = "PI/5"; // plan 1.4 grade: vignette=PI/5

// ---- Hooks, loops, end (§13, §14, §21) ----
export const LOOP_CROSSFADE_S = 0.4; // plan 1.4 Short loop crossfade into frame 1
export const J_CUT_S = 0.3; // plan 1.4 narration up to 0.3 s early
export const L_CUT_S = 0.5; // plan 1.4 payoff narration trails 0.5 s
export const END_CARD_S: [number, number] = [10, 15]; // plan 1.4 long-form end card
export const END_SCREEN_S: [number, number] = [5, 20]; // §21 YouTube end-screen slots
export const END_CLEAN_S = 0.3; // §21 end on a clean frame: nothing in the last 0.3 s

// ---- Format (§22) ----
export const COLOR_TAGS = { colorspace: "bt709", color_primaries: "bt709", color_trc: "bt709", color_range: "tv" } as const; // §22
