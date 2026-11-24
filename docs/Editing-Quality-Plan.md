# Plan: Shotcraft v4: self-hosted FLUX images (default, choosable) + professional edit pass from pharooresearch

Version 2, 2026-11-22. Written to the fullstack-app-builder standard: decisions, then the full spec, then demoable phases with self-review, then QA, seed and handoff.
**First action on approval:** save this file over `e:\projects\videogenerator\docs\Editing-Quality-Plan.md` and `C:\Users\unknown\Desktop\Editing-Quality-Plan.md` (v1 is already there).

## 0. Context and decisions
**Why.** Two asks:
1. Images come from a **self-hosted FLUX 3 model by default**, with the provider **choosable per project** instead of always OpenAI `gpt-image-2`.
2. Use `pharooresearch.md` (22 video elements) and the `auto-video-edit` skill to make the finished videos edit like a professional.

Today the product:
- hard-cuts 8 s clips with no transitions, music, sound effects, grade or text graphics (`src/shorts/assemble.ts` `buildShort`)
- calls OpenAI images directly from 5 places (`nichePipeline.ts` L360/L403, `pipeline.ts` L108/L143/L161/L277, `projectVideo.ts` L112)
- has run out of OpenAI credits (429), which the user will top up

**Hardware facts (checked):**
- **GPU:** Intel HD 520 only. There is no NVIDIA GPU (`nvidia-smi` is missing; the registry lists one adapter).
- **Disk:** C: is 99% full (3 GB free); E: has 21 GB free.
- **RAM:** about 8.5 GB available.

**Model facts (web, Nov 2026):**
- **FLUX 3 Image Klein** has open weights. Black Forest Labs released it on 2026-10-15: 5.6B parameters, text-to-image plus editing plus **multi-reference**, FLUX Kommunity License (free commercially under $5M revenue).
- **FLUX 3 Dev** open weights are not out yet.
- **CPU route that works today:** stable-diffusion.cpp with **FLUX.2 Klein 4B Q4_K_M GGUF**, step-distilled at 4 steps (a community CPU Space runs it at 512x512).
- **Gap:** a FLUX 3 Klein GGUF or stable-diffusion.cpp support was not confirmed.

| Decision | Choice |
|---|---|
| FLUX host | **This PC, CPU** (user's choice). Server runs from E: (models on E:). The provider talks to a URL, so a GPU box can replace it later with no code change |
| FLUX model | **FLUX 3 Image Klein** if a CPU-runnable build loads in Phase 0; otherwise **FLUX.2 Klein 4B Q4 GGUF** (closest working) until it does. The model file is a setting |
| Choice | Per project: image model picker (`flux-local` default, `openai`, `fal`) + "fallback allowed" toggle (**ask per project**) |
| OpenAI | Stays for text and Whisper; user adds credits |
| Editing renderer | **Both, phased:** FFmpeg + ASS first, then a HyperFrames overlay pass |
| Audio assets | Free library pack downloaded once (music beds by mood, SFX with 2-3 takes each) |
| Stack | Unchanged: Express + TS + MariaDB (numbered migrations), Next.js 16, local :4500/:4501 |

**Honest risk:** CPU FLUX is slow. Expect about 1-4 min per 512-768 px image at 4 steps on this laptop CPU, which is about 30-60 min of images per Short (anchors plus about 5 shots). Phase 0 measures it before anything is built on it. The default resolution is set by that benchmark: generate at 768 px, then upscale with FFmpeg lanczos to the clip-start size.

## 1. Full spec

### 1.1 Entities (migration `006_images_and_edit.js`, existing `addColumn` helper style)
- **projects:**
  - `image_provider` (`flux-local` | `openai` | `fal`, default from settings)
  - `image_fallback` (bool, default false)
  - `edit_json` (EditPlan)
  - `edit_review_json`
- **anchors, shots:** `image_provider_used`, `image_ms` (which model made the image and how long it took).
- **settings:**
  - `default_image_provider = 'flux-local'`
  - `flux_url = 'http://127.0.0.1:7860'`
  - `flux_model`, `flux_steps = 4`, `flux_size`
  - `edit_style_default`
- **assets (files, not DB):** `backend/assets/audio/{music/<mood>/*.mp3, sfx/<kind>/*.wav, SOURCES.md}`.

### 1.2 Image provider layer (one door for every image)
- `src/images/index.ts` `makeImage({prompt, size, refs?, provider, fallback})` returns `{buffer, provider, ms}`. It replaces all direct `generateImage` / `generateImageWithReference` calls, routes through `IMAGE_PROVIDERS` (`src/providers/index.ts` L85), and records the provider and time.
- `src/providers/fluxLocal.ts`: HTTP client for stable-diffusion.cpp `sd-server`:
  - **text-to-image:** prompt, w/h, steps, seed
  - **multi-reference:** reference images as base64, using the model's ref-image input; with no ref support it falls back to text plus anchor description
  - **runtime:** a 10-min timeout, one request at a time (queue), and `status()` that pings `/health`
- `fallback` true means OpenAI is tried on FLUX failure; false means the stage fails with "FLUX server offline: start it with `npm run flux`".
- **Size mapping:** the product asks for 1024x1536 / 1536x1024. Flux renders at the benchmark size (e.g. 512x768 / 768x512, multiples of 64), then `scale=...:flags=lanczos` brings it to the requested size.

### 1.3 FLUX server (self-hosted, local)
`tools/flux-server/` (outside backend `src`, so the tsx watcher is untouched):
- `setup.ps1`:
  1. download the stable-diffusion.cpp Windows CPU (AVX2) release, and try the Vulkan build too and keep it if faster
  2. download the model GGUF + text encoder + VAE into `E:\models\flux\`
  3. print the sizes
- `start.ps1`: run `sd-server` on 127.0.0.1:7860 with threads equal to the core count.
- `npm run flux` in backend: start the server in the background.
- `GET /api/system/images` shows server status, model, and the last image time.

### 1.4 Edit pass (from pharooresearch + skill)
`src/edit/`:
- **`rules.ts`:** every research number as a constant with its section reference. Examples:
  - `CAPTION_BOTTOM_MAX_Y=1248` (§04/§22)
  - `MAX_CPS=20` (§04)
  - `PUNCH=[1,1.12,1,1.2]` (§09)
  - `SFX_OVER_BED_DB=3..6` and `SFX_OFFSET_FRAMES=1` (§20)
  - `LUFS=-14` and `TP=-1` (§11)
  - `MAX_TRANSITION_KINDS=3` (§02)
  - `STATIC_MAX_S=8` (§12)
  - `TEXT_HOLD = 0.5 + 0.3/word` (§05)
  - `GRAIN 2-3%`, `VIGNETTE 12%` (§18)
- **`styles.ts`:** EditStyle `default` (port of the skill's `styles/default.md`) plus niche variants:
  - space: cool, low grain
  - history: warm, more grain
  - mystery: dark, more vignette
  - explainer: clean
- **`director.ts` `buildEditPlan(script, words, style, format)`:** a deterministic EDL driven by the beat roles saved by `nichePipeline.normalizeShots`:
  - **hook:** no transition, punch-in from 1.0 to 1.12 over 0.4 s, keyword pop, captions from 0.1-0.3 s, music entering at its strongest bar
  - **rehook / side_story:** the only visible transitions (0.3 s zoom/blur) plus a whoosh, and a chapter card on long-form
  - **body:** hard cuts, alternating punches, an inner punch at about 4 s so nothing stays static longer than the limit
  - **payoff:** a riser, then 2-3 frames of silence, then an impact at picture + 1 frame (once per film), held 0.3-0.75 s; a stat card only for a number in `facts_json`
  - **loop (Short):** cross-fade into frame 1. Long-form gets a bridge plus a 10-15 s end card (2 YouTube slots) and one CTA with a benefit.
  - **J-cut:** narration up to 0.3 s early on `continues_previous` shots. **L-cut:** payoff narration trails 0.5 s.
- **`critique.ts`:** the skill's 10-point director checklist plus its anti-slop list as code: hook in 2 s, no static frame over 8 s, no 3 identical layouts in a row, SFX at most 1 per 3 s, at most 3 transition kinds, no identical SFX twice in a row, caption safe zone, clean end. It fixes automatically, up to 2 passes.
- **`audioLib.ts`:** pick music by brief tone, SFX by kind; rotate takes.
- **`src/shorts/assemble.ts` changes:**
  - an xfade chain instead of concat `-c copy`
  - one narration timeline with offsets instead of per-shot `atrim`, which enables J/L cuts
  - a voice chain (`highpass=80, acompressor 3:1 @-18dB, deesser`)
  - SFX through `adelay` + `amix normalize=0`
  - music ducking (reuses the existing `sidechaincompress`)
  - grade (`eq`, `colorbalance`, `vignette=PI/5`, `noise` last)
  - punch-ins (`scale`+`crop`, eased, at most 1.2 because clips are 576x1024)
  - ASS keyword accent (one accent-coloured word per group, no bounce)
  - captions moved so their bottom sits at y 1248 or higher
  - bt709 tags; TP target -1
- **`src/edit/hyperframes/` (Phase 6):**
  - transparent overlays for chapter cards, stat counters (real numbers, ease-out, zero baseline), source lower thirds and the end card
  - rendered with `npx hyperframes render` (alpha) and composited by `overlay` at EDL times
  - uses registry blocks first, runs `hyperframes check`, and falls back to FFmpeg `drawtext` cards on failure

### 1.5 QA additions (`src/shorts/qa.ts`)
- **New checks:**
  - `caption_safe_zone`, `cps`
  - `static_frame` (scene score: no 8 s stretch without change)
  - `sfx_density`, `transition_kinds`
  - `end_clean`
  - `first_frame_matches_thumbnail` (SSIM)
  - `ebur128` loudness/TP
- **Fix:** the `duration` check no longer fails long-form videos over 60 s.
- **Learning:** a 1 fps contact sheet is saved, and fixed failures go into `storage/edit-lessons.json`, the skill's lessons idea.

### 1.6 API and UI
- **API:**
  - `GET /api/system/images` (status of each provider, FLUX server health and speed)
  - `POST /api/projects` accepts `imageProvider`, `imageFallback`
  - `GET /api/projects/:id` returns `edit`, `editReview`
  - `POST /api/projects/:id/video` (exists) runs the edit pass
- **UI:**
  - **New-project form:** an "Image model" picker (FLUX local default, shows Online/Offline and about 2 min per image) plus a "Fallback to OpenAI if FLUX is down" toggle; the cost/time estimate includes image time
  - **Settings:** default image model, FLUX URL and model, a "Test FLUX" button that makes one image
  - **Project page:** an "Edit plan" panel (beats table: role, layout, punch, transition, SFX, keyword) and an "Edit review" panel (checks passed or failed, fixes); each image shows a provider badge

### 1.7 Cross-cutting rules
- Model files and the server live on E: (C: is full).
- No Veoframe clips are spent on testing: edit phases are tested by re-assembling the existing Saturn clips (project 2).
- No backend `src` edits while a video job runs.
- All shell commands run in the background; at most 2 helper agents.
- Every research number in code carries its `§` reference.

## 2. Phases (built in order; each is demoable, self-reviewed with a log line; the build does not stop between phases)

| # | Phase | Delivers | Done when |
|---|---|---|---|
| 0 | **FLUX feasibility gate** | `tools/flux-server/setup.ps1` + `start.ps1`; try FLUX 3 Klein first, else FLUX.2 Klein 4B Q4; benchmark 512² and 768x512 at 4 steps, CPU vs Vulkan | One image is saved and timed. If it takes over 6 min/image, report the numbers and recommend the GPU-URL route before going on |
| 1 | **Image provider layer** | Migration 006; `src/images/index.ts` `makeImage`; `providers/fluxLocal.ts`; all 7 call sites switched; fallback rule; provider and time recorded; `/api/system/images` | Unit tests with a fake FLUX server: text-to-image, refs, offline + fallback on, offline + fallback off; a plan-only Saturn-style anchor made by FLUX |
| 2 | **Image UI + settings** | Picker, toggle and status on the new-project form; Settings "Test FLUX"; provider badges | New project with FLUX shows Online and its estimate; the Test button returns an image |
| 3 | **Rules, styles, audio library** | `edit/rules.ts`, `styles.ts`; download the audio pack + `SOURCES.md`; `audioLib.ts`; caption y moved to 1248 or higher; QA duration fix; TP -1 | Tests on constants and caption y; `qaShort` passes a fake 5-min long video |
| 4 | **Audio + picture pass (FFmpeg)** | Single narration timeline, J/L cuts, voice chain, music + ducking, SFX mix, xfade chain, punch-ins, grade/texture, keyword accent, Short loop, bt709 | The re-assembled Saturn video (0 new clips) has music, 3-5 SFX, 2-3 motivated transitions and punches; -14 ±1 LUFS, TP ≤ -1; word-timing test with xfade offsets passes |
| 5 | **Director + critique + Edit panels** | `director.ts`, `critique.ts`, `edit_json`, UI panels | Tests: hook has no transition, at most 3 kinds, no repeated punch, SFX spacing ≥3 s, one riser, each anti-slop rule caught; panel shows project 2's EDL |
| 6 | **HyperFrames overlay pass** | Chapter, stat and end cards as alpha overlays; check in the pipeline; drawtext fallback | A plan-only long video renders with chapter, stat and end cards visible in sampled frames; render time recorded |
| 7 | **Auto review** | New QA checks, contact sheet, `edit-lessons.json` | A bad EDL fails the matching checks; Saturn passes |
| 8 | **QA, seed, handoff** | See section 3 | Section 3 complete |

## 3. QA, seed and handoff
- **Golden path:**
  1. New Short with the FLUX local default: brief, anchors and shot images from FLUX (badges show it)
  2. Veoframe clips (about 4-5, the one real spend, after credits are added)
  3. Edit pass, then QA, thumbnail and SEO
  4. Then: one long plan-only run, and Saturn re-assembled before and after
- **Failure drills:**
  - FLUX server stopped, fallback off: clear error plus start hint
  - FLUX stopped, fallback on: OpenAI image, provider recorded
  - FLUX timeout: one retry
  - Missing audio pack: edit runs without music and warns
  - HyperFrames render fails: drawtext cards
  - Backend restart mid-run: resumes without re-making finished images
- **Seed:** `backend/scripts/seed.js` gains plan-only demo projects with `image_provider` set (one `flux-local`, one `openai`) and a saved `edit_json`, so the panels have content without spending anything.
- **Handoff:**
  - URLs: UI :4500, API :4501, FLUX :7860
  - start order: XAMPP MariaDB, then `npm run flux`, then backend, then frontend
  - measured FLUX time per image; per-video cost (OpenAI text + Whisper, Veoframe clips, images now free)
  - what needs the user: OpenAI credits, Google OAuth for YouTube
  - `docs/STATUS.md` update

## 4. Critical files
- **New:**
  - `tools/flux-server/{setup,start}.ps1`
  - `src/images/index.ts`, `src/providers/fluxLocal.ts`
  - `src/edit/{rules,styles,audioLib,director,critique}.ts`, `src/edit/hyperframes/*`
  - `db/migrations/006_images_and_edit.js`
  - `assets/audio/*`
  - `frontend/src/components/{EditPlanPanel,ImageModelPicker}.tsx`
- **Changed:**
  - `src/nichePipeline.ts`, `src/pipeline.ts`, `src/projectVideo.ts` (`makeImage`, EditPlan)
  - `src/providers/index.ts`
  - `src/shorts/{assemble,plan,captions,qa}.ts`
  - `src/routes/{projects,system}.ts`
  - `frontend/src/app/page.tsx`, `frontend/src/app/projects/[id]/page.tsx`, Settings
- **Reused:**
  - `IMAGE_PROVIDERS` / `providers/fal.ts` pattern
  - existing `sidechaincompress` + two-pass loudnorm in `buildShort`
  - `kenBurns`, `textCard`, `makeThumbnail` and `extractLastFrame` (`src/media/clips.ts`)
  - `buildAss` / `fixedPos` / `chunkWords` (`captions.ts`)
  - beat roles from `normalizeShots`
  - `buildChapters`

## 5. Verification
- `node ./node_modules/vitest/vitest.mjs run` + `npx tsc --noEmit` (backend and frontend) green after every phase.
- Phase 0 benchmark numbers recorded in `docs/STATUS.md`.
- Re-assemble Saturn after phases 4, 5 and 7; check `ebur128`, the ASS caption y values, the xfade count, and a 1 fps contact sheet.
- The user watches Saturn before and after, plus one new real Short made with FLUX images.
