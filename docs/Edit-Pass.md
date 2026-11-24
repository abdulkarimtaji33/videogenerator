# Edit pass

The edit pass turns the finished clips, narration and script into a professionally edited video. Code is in `backend/src/edit/`; every number carries its section of `pharooresearch.md` (or the auto-video-edit skill) in `rules.ts`.

## The EditPlan (`src/edit/types.ts`)
Saved on the project as `edit_json` (returned as `edit`) with the critique result in `edit_review_json` (`editReview`).
- `style`: grade (contrast, saturation, gamma, warmth), vignette, grain, accent colour, music mood, music gain, duck depth. Styles in `styles.ts`: `default`, `space`, `history`, `mystery`, `explainer`; `styleForNiche()` picks one.
- `beats[]`, one per shot: `role` (hook, foreshadow, body, rehook, side_story, payoff, loop, bridge), `layout` (full, punch, keyword, lower_third, split, graphic, end_card), `punch` (1 to 1.2), `transitionIn` + `transitionSeconds`, `sfx[]` (kind, at, gainDb, take), `keyword` (one accent word), optional `card` (chapter, stat, lower_third, end), `narrationOffset` (J-cut / L-cut), `punchAt` / `punchSeconds`.
- `music` (file, mood, gain, entryAt), `loop` (Short: last frame cross-fades into frame 1), `endCard` (long only), `chapters`, `transitionKinds`, `captionBottomY`, `narrationDelay`.

## Director (`director.ts`, `buildEditPlan`)
Deterministic, no LLM; driven by the beat roles the niche pipeline saved on each shot.
- hook: hard cut, punch 1.0 to 1.12 over 0.4 s, nothing covering the first 2 s (§13, §09)
- rehook / side_story: the only visible transitions (0.3 s) plus a whoosh; chapter card on long-form (§02)
- body: hard cuts, alternating punch levels `[1, 1.12, 1, 1.2]`, inner punch at about 4 s (§09, §12)
- payoff: hard cut, riser (2 s) then 3 frames of silence, then one impact 1 frame after the picture (§20)
- loop (Short): cross-fade into frame 1, 0.4 s (§14); long-form gets a bridge and a 10-15 s end card (§21)
- J-cut: narration up to 0.3 s early on shots that continue the previous one; L-cut: payoff narration trails 0.5 s

## Critique (`critique.ts`, `critiqueEditPlan`)
Up to 2 rounds; each rule says its reference and repairs the plan when it can: `hook_first` §13, `transition_kinds` (max 3) §02, `payoff_clean_cut` §20, `punch_cap` and `punch_repeat` §09, `static_frame` (8 s) §12, `layout_variety`, `sfx_density` (3 s apart; a riser followed by its impact counts as one) §20, `sfx_repeat`, `sfx_once`, `payoff_impact` §20, `caption_safe_zone` (bottom y 1248) §04, `text_hold` (0.5 s + 0.3 s per word) §05, `end_clean` §21, `texture_levels` §18, `short_loop` §14, `music_bed` §11 (warning only). Constants: `LUFS_TARGET -14` and `TRUE_PEAK_DB -1` (§11), grain 2-3% and vignette 12% (§18).

## Audio library (`backend/assets/audio`, `audioLib.ts`)
`music/<mood>/*.mp3` (calm, wonder, tense, dark, upbeat) and `sfx/<kind>/*.wav` (whoosh, riser, impact, pop, tick; 3 takes each). Rebuild with `node scripts/fetch-audio.js [--force]`. No third-party files: everything is synthesised with FFmpeg and released as CC0 1.0; the music beds are plain ambient pads, not composed music. Each file is listed in `assets/audio/SOURCES.md`. To use real tracks, drop royalty-free files into the folders and record origin and licence there. A missing pack never fails an edit: it runs without music and warns.

## QA
`src/shorts/qa.ts` checks the finished video (duration, loudness and true peak, caption safe zone, static frames and similar). The edit critique above is shown in the project page's "Edit review" panel; the plan in the "Edit plan" panel.

## Rebuild a video without new clips
Existing clips are reused, only the edit and mix run again:

```
POST http://localhost:4501/api/projects/<id>/video
```
Requires the project `status` to be `done` (otherwise 400). It queues `project.video`; shots that already have a clip are skipped, so no Veoframe quota is spent. Do not call this on the plan-only `Demo:` projects: they have no clips and it would start generating them.
