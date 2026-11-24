# Plan: Shotcraft (Video Generator) for any niche: research-based hooks, Short and long videos, SEO packaging, YouTube auto-post

Version 3, 2026-11-22. Written to the fullstack-app-builder standard: scope, then the full spec, then phases (each demoable and self-reviewed), then QA, seed data and handoff.
**First action on approval:** save this plan as `e:\projects\videogenerator\docs\Product-Improvement-Plan.md` and as `C:\Users\unknown\Desktop\Product-Improvement-Plan.md`.

## 0. Context and decisions
**Problem.** The product's pipeline (`backend/src/pipeline.ts` + `backend/src/prompts.ts`) always runs idea → story → **one human character** → character photo → scenes → shot images → video prompts. For the Saturn idea it made a woman with a ring halo. The clips were consistent, but the niche needed a **planet**. Niches need different subjects:
- space: an object
- history: places, maps and objects
- mystery: atmosphere and locations
- series: a cast
- some videos: nothing recurring at all

The research docs (`docs/Viral-Video-Research-Complete.md`, `docs/Niche-Research-Complete.md`) define what works, and the product uses none of it. The research-based hook engine (`backend/src/hooks/*`) exists but is unused by the product.

**Goal.** One idea becomes a finished video in any niche. The product picks the right subjects, writes a hook-first, research-shaped script, checks and fixes it, and makes a Short (9:16) or a long video (16:9). It also produces the SEO title, description, tags and thumbnail, and can auto-post to YouTube.

| Decision (asked and answered) | Choice |
|---|---|
| Stack | Keep the existing stack: Express + TypeScript + MariaDB (hand-written SQL, numbered migrations), Next.js 16 + Tailwind, local only (:4500 / :4501) |
| Approval | **Fully automatic.** An AI script review against the research runs after the full script and rewrites failing parts; it can be switched **on or off** per project (global default in Settings) |
| Facts | **Model knowledge plus a fact-check pass** (no web search). Unsupported claims are dropped |
| Long-form visuals | **All AI clips** (about 75 Veoframe clips per 10 minutes; quota-aware) |
| Clip provider | Veoframe worker (built and tested) first, then the other automatic providers. The manual job-pack providers are never used by one-click runs |
| Media storage | Local disk under `backend/storage` (as now) |
| Auth | None (local single user, as now). The YouTube OAuth token stays in `storage/secrets` |
| Design | The existing Shotcraft UI style |

## 1. Full spec

### 1.1 Entities (MariaDB; migration `005_niche_pipeline.js` in the `backend/db/migrations/` style, using the `addColumn`/`addIndex` helpers)
- **projects** (extend):
  - `niche`, `format` (`short` | `long`, exists), `length_seconds`, `review_enabled`
  - JSON columns: `brief_json`, `facts_json`, `seo_json` (keywords, 3 titles, description, tags, hashtags, category), `hook_json`, `script_json`, `review_json`, `cost_estimate_json`
  - `chosen_title`, `thumbnail_path` (exists), `thumbnails_json`, `youtube_video_id`, `publish_status`
  - `stage` (exists), `final_video_path` (exists), `qa_status` (exists)
  - The old character columns stay and are filled from the first character anchor, so old projects still show.
- **anchors** (new; the recurring visual subjects of a video):
  - `id`, `project_id`, `key`, `kind` (`character` | `subject` | `place` | `object`)
  - `name`, `locked_features`, `image_prompt`, `image_path`, `status`
- **shots** (extend):
  - `beat_role` (`hook` | `foreshadow` | `body` | `rehook` | `side_story` | `payoff` | `loop` | `bridge`)
  - `beat_index`, `anchor_keys` (JSON), `continues_previous` (bool), `link` (`but` | `therefore` | null)
  - `narration_fits` (bool), `provider` (exists)
- **channels** (exists): add `default_niche`, `default_format`, `world_bible_json` (anchors and style carried across episodes, Phase 6), `youtube_connected`.
- **uploads** (exists): `project_id`, `youtube_video_id`, `privacy`, `publish_at`, `state`, `seo_snapshot_json`, `thumbnail_set`, `captions_set`.
- **settings** (exists): `script_review_default`, `provider_order` (exists), `quotas` (exists), `default_voice_by_niche`.

### 1.2 Niche profiles (code, `backend/src/niche/profiles.ts`; data from Niche research sections 4-5; merge with the existing `niche/scorer.ts`)
Each profile defines:
- `formatFit` (long and short strength) and `defaultLength` (Short and long)
- `subjectMode`: `subject` | `place` | `character` | `cast` | `mixed` | `none`
- `visualRules`, for example "no realistic human faces" for history, "atmosphere, never gore" for horror, "no people" for space
- `structure`: `explainer` | `story` | `what_if` | `list`
- `preferredHookTypes`, `factsRequired`, `policyNotes`, `voice`, `captionStyle`

Profiles:
- space_science
- history_documentary
- mystery_horror
- curiosity_what_if
- mythology_folklore
- character_series
- geopolitics_business
- nature_animals
- tech_explainer
- generic_explainer
- `auto`, where the model chooses

Blocked: kids and religious-story farms, finance, health or legal advice from a persona, and real-victim true crime. The product refuses these with a message.

### 1.3 Pipeline flow (one job per project; every stage writes `stage` so the UI shows progress; re-running resumes from the first unfinished stage)
1. **Brief:** `briefPrompt(idea, niche, format, length)` returns `CreativeBrief`: niche profile, promise (one sentence), audience, subjectMode, `anchors[]` (0-4, each with locked features), `styleBible`, tone, `avoid[]`.
2. **Facts:** `factsPrompt` lists claims with confidence. A generalised `factCheckLines` (from `factCheckHooks` in `hooks/engine.ts`, failing closed) keeps only supported claims. A profile with `factsRequired` needs at least 3 facts, or the run stops with a clear message.
3. **SEO packaging (research section 2.1):**
   - 1 main keyword phrase plus 5-10 related phrases
   - 3 titles that differ in angle (main phrase near the start, 70 characters or less, specific subject plus stake or surprise, no meta words)
   - 2-3 thumbnail concepts (one focal subject drawn from the anchors, 0-5 words, high contrast)
4. **Hook:** the existing `generateHooks({topic, format, niche, title, facts})`, which runs the lint, the fact check and type rotation, then `recordHookUse`. The hook line is narration line 1, and the hook visual becomes shot 1.
5. **Script (JSON):**
   - **Short** (research sections 3.1-3.3): hook (3 s or less), foreshadow (2 lines), body beats linked by "but" or "therefore", payoff, then a loop line that echoes the first frame. Length 15-60 s; shots = ceil(seconds / 8).
   - **Long** (research sections 2.2-2.6 and 8.1): a 0-30 s hook anatomy, then 45-90 s beats with `{claim, factIds, visual, link, loopOpened, loopClosed}`.
     - Structure rules: re-hooks near one third and two thirds, a side story at the halfway point, the strongest moment in the first third, then the payoff and a 10-20 s bridge.
     - Beats are split into 8 s shots, and each shot records which anchors appear and whether it continues the previous shot.
6. **Script review (if enabled):**
   - **Deterministic checks** (`backend/src/script/review.ts`, reusing `lintHook`, `promptLint` and the narration-fit estimate from `shorts/review.ts`):
     - the first line is the hook, with no greeting or meta words
     - the promise lands in the first line (Short) or within 10 s (long)
     - no "and then" links, every loop is closed, and the payoff matches the promise
     - narration fits each shot, and numbers are written as words
     - the hook type differs from recent videos, and there is no first person
     - long-form only: re-hooks are present and the side story sits at the halfway point
   - **AI critic:** the research checklist (sections 4 and 8.3) scores the script and lists fixes.
   - **Rewrite** for up to 2 rounds. The report is saved and the best version continues.
   - **Fact check:** narration lines go through `factCheckLines`.
7. **Anchors:** one reference image per anchor:
   - character: full-body photo
   - subject: a clean hero shot
   - place: an establishing shot
   - object: a product-style shot

   Size follows the format.
8. **Shots:**
   - **Image:** made by `generateImageWithReference` extended to **several reference images**, the references of that shot's anchors. With no anchors it is text-to-image with the style bible. Images are 1024x1536 for Short and 1536x1024 for long.
   - **Video prompt:** the style bible, locked anchor features, one focused moment, camera direction, and an `Audio:` line with no speech, no quotes and no text. It must pass `shorts/promptLint.ts`, and `cleanVideoPrompt` stays as a safety net.
9. **Clips:** the Veoframe worker (`providers/veoframeWorker.ts`) runs in shot order. Shots with `continues_previous` start from the previous clip's **last frame** (the `lastframe` logic moves from `cli/short.ts` into `media/clips.ts`). Before any clip is spent, the quota guard compares the clips needed with the quota left (`providers/quota.ts`). If they don't fit, it generates today's share and continues tomorrow.
10. **Assembly and QA:** `projectVideo.ts`, which turns `planFromProject` into `narrate`, `buildShort` and `qaShort`. Long-form gets 16:9 and chapters from the beats (`buildChapters`). Add `qa/policy.ts` (`policyCheck` + `uniquenessCheck`) and an **SEO check**: the main phrase is in the title, the first description line and the tags; the title is 70 characters or less; and the title promise equals the hook promise.
11. **Thumbnails:**
    - **Long:** for each concept, a 1536x1024 image from the anchor references, then `makeThumbnail` (`media/clips.ts`) makes variants A and B at 1280x720 with 0-5 words.
    - **Short:** the hook frame is stored.
12. **Publish** (when a channel is connected and set to auto, or on a click):
    - upload through `youtube/publish.ts` with the chosen title, description (promise + main phrase in the first 2 lines, summary, chapters, sources, 3-5 hashtags with `#Shorts` for Shorts, synthetic-media note), tags, category, language, thumbnail and an **SRT captions** file built from the word timings
    - `containsSyntheticMedia=true`, `madeForKids=false`
    - privacy: private, unlisted, public, or scheduled at the channel's next slot (`youtube/schedule.ts`)
    - the upload's file name uses the main SEO phrase

**Modes:**
- **Plan-only:** stages 1-8, with no clips spent. Used for testing and previews.
- **Full:** stages 1-11, plus 12 when auto-publish is on.

### 1.4 UI surfaces (Next.js)
- **New project** (`frontend/src/app/page.tsx`):
  - fields: idea, niche (Auto + profiles), format (Short or Long), length (Short 15-60 s; Long 3-30 min), script review on or off, auto-publish on or off, channel
  - a cost and time estimate (clips, minutes, quota left)
  - two buttons: **Write plan only** and **Make video**
- **Project page** (`frontend/src/app/projects/[id]/page.tsx`):
  - a stage stepper that follows the new stages
  - panels: Brief (niche, promise, subject mode), **Anchors** (reference images, regenerate), **Hook** (line, visual, type, score, alternatives), **SEO** (3 titles with a picker, description, tags, keyword check), **Script** (beats with role and link badges), **Review report** (checks passed or failed, fixes applied), **Shots** (anchor badges, beat role, per-shot "Generate clip", regenerate image or clip), **Final video**, **Thumbnails** (A/B picker), **Publish** (privacy, schedule, status, link to YouTube)
- **Settings:**
  - Connect YouTube (OAuth)
  - provider order and quota
  - script review default
  - voice per niche
  - Veoframe status: signed in or out, and today's quota
- **Channels:** default niche and format, publish mode (review or auto), publish slots, world bible (Phase 6).

### 1.5 API (`backend/src/routes/projects.ts` and `system.ts`)
- **Projects:**
  - `POST /api/projects` with `{idea, niche, format, lengthSeconds, reviewEnabled, autoPublish, channelId, mode: plan|full}`
  - `POST /api/projects/:id/video` (exists; resumes a full run)
  - `POST /api/projects/:id/replan` (from a chosen stage)
- **Anchors and shots:**
  - `POST /api/projects/:id/anchors/:key/image`
  - `POST /api/projects/:id/shots/:shotId/video` (exists)
- **SEO and thumbnails:**
  - `PATCH /api/projects/:id/seo` (choose or edit a title)
  - `POST /api/projects/:id/thumbnail` (pick A or B)
- **Publishing and status:**
  - `POST /api/projects/:id/publish` with `{privacy, publishAt?}`
  - `GET /api/system/veoframe` (signed-in state, quota)
  - YouTube OAuth start and callback

### 1.6 Cross-cutting rules
- All model output is parsed as JSON with a schema (zod v4). On a parse failure the stage retries once with the error message, then fails the stage with a readable error. Stages are resumable.
- Secrets live only in `backend/.env`; tokens live in `storage/secrets`; the browser profile in `storage/browser-profile` (gitignored).
- Policy: rotate hook types and structures, refuse blocked niches, synthetic-media label always set, no "same scenario" episodes.
- **No backend file edits while a clip job is running.** The tsx watcher restarts the backend and the queue re-runs the job, which spends quota twice. This was learned on 2026-11-22.
- Tests use fake `generateText` and fake providers. Paid calls happen only in the final real test.

## 2. Phases (built in order; each is demoable and self-reviewed with a log entry; the build does not stop between phases)

| # | Phase | Delivers | Done when |
|---|---|---|---|
| 1 | **Foundation: niches, brief, anchors** | Migration 005; `niche/profiles.ts`; `briefPrompt`; anchor reference prompts per kind; multi-reference `generateImageWithReference`; shot images use the shot's anchors; format-sized images; old character flow replaced (old projects still render) | Plan-only runs for "Saturn floats" (space), "Fall of Rome" (history) and "two robot friends" (character series) give a planet anchor with no people, place/object anchors, and two character anchors, with matching shot images |
| 2 | **Facts, SEO packaging and hook** | `factsPrompt` + `factCheckLines`; SEO step (keywords, 3 title angles, description draft, tags, thumbnail concepts); `generateHooks` wired in; hook visual becomes shot 1 | The plan-only Saturn run stores verified facts, 3 different title angles with the main phrase early, and a hook that passes `lintHook` |
| 3 | **Research-shaped script and automatic review** | Short and long script templates (beats, links, loops, re-hooks, side story, payoff, loop/bridge); `script/review.ts` deterministic checks + AI critic + 2 rewrite rounds; on/off toggle; narration fact check; new video-prompt writer that passes `promptLint` | Unit tests catch "and then", a greeting, an unclosed loop and a missing payoff; the review report shows in the UI; the toggle off skips it |
| 4 | **Short and long video production** | Format-aware `planFromProject` (16:9, chapters, no Short limits for long); last-frame continuity chaining; quota guard and day-split resume; cost and time estimate; new-project form; new project-page panels | A plan-only long video (5 min) yields the right beats, shots and estimate; unit tests for long plans and chaining pass; one **real Short** (about 4-5 clips) passes QA with the subject in every shot |
| 5 | **Thumbnails, SEO check and policy QA** | Long-form thumbnails A/B from the anchors (`makeThumbnail`); Shorts hook frame; final description with sources, chapters and hashtags; SRT export; SEO check; `policyCheck` + `uniquenessCheck` wired into QA | Thumbnails at 1280x720 render and can be picked; the SEO check flags a title without the main phrase; the policy check flags a blocked niche |
| 6 | **YouTube auto-post** | OAuth connect in Settings; publish endpoint and panel (privacy, schedule); upload of video, thumbnail, captions and metadata; auto-publish per channel; upload state tracked | With mocks: the full publish payload is correct (tests). Live: one private test upload once you add a Google OAuth client to `.env` |
| 7 | **QA, seed and handoff** | End-to-end checks, seed data, docs update, handoff notes | See section 3 |

## 3. QA, seed data and handoff
- **Golden path:** new project (Auto niche, Short), then a plan-only review of the brief, anchors, hook, SEO, script and review report, then Make video. That gives 4-5 Veoframe clips, then narration, captions and QA, then thumbnail and SEO check, then a private upload (when OAuth is set). Also run a plan-only long video and one blocked-niche refusal.
- **Failure drills:**
  - Veoframe signed out: a clear message and the login script hint
  - quota exhausted: day-split resume
  - a model returns broken JSON: one retry, then a readable error
  - backend restart mid-run: resume without paying twice for finished shots
  - YouTube quota error
- **Seed:** extend `backend/scripts/seed.js` with 6 plan-only demo projects (space, history, mystery, what-if, character series, geopolitics; Short and long), so every panel has content without spending clips.
- **Handoff:**
  - URLs (UI :4500, API :4501) and how to start everything (XAMPP MariaDB, backend, frontend, Veoframe sign-in script)
  - what needs your input (Google OAuth client for YouTube)
  - per-video cost (Veoframe clips, OpenAI text, image and TTS)
  - an update to `docs/STATUS.md`

## 4. More ideas (roadmap after Phase 7; yours plus mine)
1. **Shorts from long videos:** auto-cut 2-3 vertical Shorts from a long video's strongest beats (`reframeToVertical` exists), each with its own hook.
2. **Series and world memory:** save anchors, style bible and characters on the channel and reuse them in the next episode. Each episode must change the situation (policy).
3. **Hook A/B for Shorts:** 2-3 alternative first clips with different hook types, kept for tests and re-uploads.
4. **Analytics loop:** pull YouTube Analytics (`youtube/analytics.ts`) and score hook types, title angles and lengths against the channel median. The next brief prefers what won.
5. **Topic finder:** scored topic ideas per niche with the existing topics queue, plus "make video from topic".
6. **Batch and calendar:** queue N videos, spread uploads across slots, and warn on upload bursts (a policy trigger).
7. **Voices per niche:** optional ElevenLabs or Gemini TTS; Urdu and Hindi voices with Nastaliq and Devanagari captions.
8. **Music and sound design:** a licensed music bed ducked under the narration (assembly supports `music`), or Veo's native ambience.
9. **Shot editor:** edit one shot's line or prompt, re-render only that clip, and re-assemble.
10. **Google Flow automation worker** as a second automatic provider.
11. **Caption styles per niche** and a safe-area check for the Shorts interface.
12. **End-screen space** in the last 10-20 s of long videos, and playlist assignment.
13. **Multi-language versions:** dub the same video into Urdu or Hindi with translated captions and SEO.
14. **Title and thumbnail A/B helper:** prepare the 3 titles and 3 thumbnails for YouTube's Test & Compare.

## 5. Critical files
- Backend:
  - `src/prompts.ts`, `src/pipeline.ts`
  - `src/niche/profiles.ts` (new), `src/script/review.ts` (new), `src/seo/seo.ts` (new)
  - `src/hooks/engine.ts`, `src/openai.ts`, `src/projectVideo.ts`
  - `src/media/clips.ts`, `src/qa/policy.ts`, `src/youtube/*`
  - `src/routes/projects.ts`, `src/routes/system.ts`, `db/migrations/005_niche_pipeline.js`
- Frontend:
  - `src/app/page.tsx`, `src/app/projects/[id]/page.tsx`
  - `src/components/ShotCard.tsx` + new panel components
  - `src/types.ts`, `src/lib/api.ts`

## 6. Verification
- `npx tsc --noEmit` (backend and frontend) and `npx vitest run` stay green after every phase.
- Unit tests (fake model and providers):
  - profile and subject-mode choice
  - brief and anchors, including zero anchors
  - review checks, SEO check, and long and short `planFromProject`
  - last-frame chaining, thumbnail sizes, and the publish payload
- Plan-only runs for 3 niches, inspected in the UI (no clips spent).
- **Real spend:**
  - one real Short (about 4-5 Veoframe clips), with its frames inspected
  - one private YouTube upload once OAuth is set
  - no other test clips
