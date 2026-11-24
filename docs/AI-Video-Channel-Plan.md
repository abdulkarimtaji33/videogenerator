# Plan: automated, monetizable AI video channel (built on Video Generator)

Version 2 — 2026-11-21. Rewritten to the fullstack-app-builder standard: full spec first, then phases. Each phase must be demoable and self-reviewed, and ends with QA plus a handoff.

## 1. Context and decisions

**Goal.** Build a YouTube channel that runs mostly by itself and can be monetized: topic, research, script, AI clips, edit, thumbnail, upload, analytics, then back to topic. Pick the niche later, so the pipeline must not depend on niche or language.

| Decision | Choice |
|---|---|
| Formats | Long-form (16:9) **and** Shorts (9:16) from the start. Shorts can be standalone or cut from a long video. |
| Publishing | Both modes. **review**: upload as private, wait for approval. **auto**: scheduled publish once QA passes. Switchable per channel and per video. |
| Language | Neutral. English, Urdu and Hindi supported from day one. |
| Codebase | Extend `e:\projects\videogenerator`: Express + TypeScript + MySQL backend, Next.js 16 frontend, both already running locally on :4501 and :4500. |
| Thinking work | The Claude subscription, through Cowork scheduled tasks that run **locally** because they need local files and Chrome. Claude in Chrome handles anything browser-only. |
| Clip source | **Veoframe** by default. Paid API providers are fallbacks. |
| Access | Local only (localhost). No public login, same as today. |

**Why Veoframe.** Weekly Pro costs Rs 499 per 7 days. That buys 120 clips of 8 s, 30 clips of 15 s and 200 images every day, and you own the outputs under its terms. API clips cost about $0.07–0.15 per second. **Risks:**
- No API on the self-serve plans, so clips have to be made through the website.
- The fair-use note restricts "automated abuse / excessive parallel usage".
- Its pages contradict each other: "credit-based" vs daily quotas, and "manual payment verification" vs "instant".
- Watermark, resolution, image-to-video support and audio language are all unknown.

**Mitigations:**
- Use Pro, not Ultra.
- Keep concurrency at 3–5 and pace requests like a human.
- Test for a week in Phase 0 before building on it.
- Put clip generation behind a provider layer with paid API fallbacks.

## 2. Full spec

### 2.1 Entities (MySQL)
Existing tables `projects` and `shots` are extended. New tables are marked *new*.

- **channels** *new*: name, youtube_channel_id, language (en|ur|hi), niche, style_guide (tone, visual style prefix, palette, banned topics), default audio_mode, publish_mode (review|auto), daily_caps (long, shorts), publish_slots (times + timezone), oauth_token_ref, status.
- **topics** *new*: channel_id, title, angle, source (claude_research|analytics|manual|trend), research_notes, sources_json (URL per claim), score, status (`idea → approved → planned → used | rejected`), reject_reason.
- **projects** (extend; one per video): channel_id, topic_id, format (long|short), parent_project_id (for a Short cut from a long video), language, aspect, audio_mode (narrated|native|mixed), plan_source (claude|openai), plan_json, title, description, tags, chapters, final_video_path, thumbnail_path, qa_status, qa_report, publish_mode, publish_at, cost_estimate. Status flow below.
- **shots** (extend): clip_type (ai_video|still_kenburns|stock|card|chart), provider, provider_job_ref, attempt_count, narration_text, dialogue_text, sfx_hint, duration_seconds, accepted (bool), qa_notes.
- **assets** *new*: project_id, kind (image|clip|voice|music|stock|caption|thumbnail), path, provider, licence, source_url, checksum, width, height, duration.
- **jobs** *new*: a persistent job queue. Columns are type, payload, status (`queued → running → done | failed | dead`), attempts, run_after, locked_by, last_error. It replaces today's fire-and-forget `runPipeline`, so work resumes after a restart or crash.
- **provider_usage** *new*: provider, date, units used vs quota, cost. This feeds the quota guard and the cost panel.
- **uploads** *new*: project_id, youtube_video_id, privacy, publish_at, state (`uploading → private → scheduled → public | failed`), stats snapshots (views, CTR, average view %, retention JSON) by date.
- **settings** *new*: key/value for global config such as provider order, concurrency and pacing. Secrets live in `.env`, never in the DB.

**Project status machine:**
`draft → planned → assets (images → clips → audio) → assembling → qa → (review) awaiting_approval → uploading → scheduled → published`. Side exits are `failed` (retryable) and `rejected`.

### 2.2 Flows
1. **Daily production** (Cowork scheduled task, local):
   1. Read the channel settings and the topic queue.
   2. Pick or research a topic.
   3. Write a plan JSON in the channel's language.
   4. Validate it with `npm run plan:validate`, then `POST /api/projects/import`.
   5. Watch the run until it finishes.
   6. If the Veoframe worker fails, take over in Chrome.
   7. Send a summary.
2. **Plan JSON** (versioned schema, validated with Zod):
   - title options and the hook
   - full script
   - character and style lock
   - scenes: visual, clip_type, narration or dialogue, SFX, duration
   - Shorts candidates
   - description, tags, chapters
   - a sources list
3. **Asset generation**:
   - Stills come from Veoframe (Nano Banana / Seedream), with OpenAI as the fallback.
   - Clips come from Veoframe image-to-video, falling back to text-to-video with a locked style prefix, then to an API provider.
   - Stock comes from free libraries such as Pexels and Pixabay, with the licence recorded per asset.
4. **Audio**:
   - **narrated**: one TTS voice for the whole video; clip audio kept as low ambience.
   - **native**: Veo's in-clip voice and SFX.
   - **mixed**: native SFX under a narrator.
   - Music comes from a free library.
5. **Assembly** (FFmpeg):
   - concat, Ken Burns on stills, text and chart cards
   - captions as ASS subtitles: Nastaliq right-to-left for Urdu, Devanagari for Hindi, Latin for English
   - loudness at −14 LUFS; H.264 1080p30 with AAC 48 kHz
   - outputs a 16:9 master plus 9:16 Shorts
6. **Thumbnail**: a hero still with an HTML template text overlay rendered by Playwright at 1280×720. Two variants per video.
7. **QA**:
   - automatic checks: ffprobe (duration, resolution, audio present, loudness, no black or frozen gaps)
   - Claude checks sampled frames for artifacts, character drift and text glitches
   - a uniqueness check against the channel's last 20 videos
   - a policy checklist covering the AI-persona and sensitive-topic rules, plus the synthetic-media disclosure
8. **Publish**:
   - **review**: upload as private, email a link to the local review page, then you approve or reject (with a reason) in the UI.
   - **auto**: private + `publishAt` in the next slot, but only if QA passed and the daily cap allows it.
   - Always set `containsSyntheticMedia` when footage looks realistic.
9. **Weekly review** (scheduled task): pull YouTube Analytics and Reporting data (views, CTR, retention). Claude writes a short report, re-scores the topic queue, adjusts the style guide and suggests new topics.

### 2.3 UI surfaces (Next.js, local)
- **Dashboard**: today's production, jobs running, quota used per provider, last uploads with stats, errors.
- **Channels**: settings, style guide editor, YouTube connect (OAuth), publish mode and slots.
- **Topic queue**: list and kanban, approve or reject, add manually, research notes and sources.
- **Projects list**: filter by channel, format, status.
- **Project page** (extend the existing one): plan view, shot grid with per-shot provider, clip preview, regenerate or replace shot, audio track preview, final video player (16:9 and 9:16), thumbnail picker, QA report, approve / reject / schedule.
- **Review inbox**: everything waiting for approval, in one place.
- **Analytics**: per-video stats and the weekly reports.
- **Settings**: provider order, concurrency, pacing, budget caps, health status of the Veoframe login.

### 2.4 Backend modules
- `src/jobs/`: queue + worker loop. Uses a DB lock, reuses `withRetry` (`src/retry.ts`) with backoff, has a dead-letter state and resumes on boot.
- `src/providers/`:
  - interfaces `ImageProvider`, `ClipProvider`, `TtsProvider`
  - implementations `veoframe.ts` (Playwright, dedicated Chrome profile), `higgsfield.ts` (moved from `src/higgsfield.ts`), `fal.ts`, `openai.ts` (reuse `generateImage` / `generateImageWithReference` from `src/openai.ts`), `gemini-tts.ts`
  - a quota guard backed by `provider_usage`
- `src/plan/`: Zod schema, validator CLI, importer. The existing OpenAI text steps in `src/pipeline.ts` and `src/prompts.ts` stay as the `plan_source=openai` fallback.
- `src/assemble/`: FFmpeg command builder (pure, unit-tested), caption builder, Ken Burns, Shorts reframer.
- `src/qa/`: ffprobe checks, frame sampler, policy checklist.
- `src/youtube/`: OAuth desktop flow, resumable upload, thumbnails, analytics and reporting pulls, quota accounting (`videos.insert` bucket, 10k units/day).
- `src/notify/`: email through the existing `email-send` skill pattern or SMTP.
- `src/routes/`: channels, topics, projects (+ `/import`, `/approve`, `/reject`, `/publish`), jobs, analytics, settings.

### 2.5 Cross-cutting
- **Migrations**: numbered SQL files plus a runner. This replaces the single `schema.sql` / `init-db.js` approach.
- **Config**: all secrets in `.env`, plus a `.env.example` listing every key: OpenAI, Gemini, fal, YouTube OAuth client, SMTP, Veoframe profile path.
- **Logging**: structured logs per job, with secrets masked. Screenshots are kept when the Veoframe worker fails.
- **Storage**: `storage/generated/<projectId>/`, with a cleanup job for raw clips after publish (the master is kept).
- **Tests**: Vitest for the plan validator, FFmpeg builder, caption RTL handling, job state machine and provider selection. A mock Veoframe page is used for worker tests.
- **Prompt-injection safety**: scraped and research text is treated as data, and the session that researches never holds upload permission.

## 3. Phases (build in order; each one ends demoable, followed by a self-review and a log entry)

| # | Phase | Delivers | Done when |
|---|---|---|---|
| 0 | **Validate Veoframe + tools** (1 Pro week) | Findings doc covering image-to-video, watermark, resolution, native audio (incl. Hindi/Urdu), speed, quota behaviour and download. TTS listening test in en/ur/hi. FFmpeg installed. | Go/no-go recorded in `automation/veoframe-findings.md`. |
| 1 | **Foundation** | Migrations runner, new tables, job queue + worker, config/.env.example, logging, tests scaffold. | The existing pipeline runs through the queue and survives a restart mid-run. |
| 2 | **Providers** | Provider interfaces and quota guard. Veoframe Playwright worker, built after Claude maps the site in Chrome. Higgsfield/fal/OpenAI adapters. | One shot gets a real Veoframe clip downloaded and stored, and the fallback works when the worker is disabled. |
| 3 | **Plans, channels, topics** | Plan schema + validator + import endpoint. Channels and topic queue (API + UI). Long and Short formats; language field. | A hand-written plan JSON imports and produces all shot clips. |
| 4 | **Audio + assembly** | TTS, audio modes, music, captions (incl. Urdu RTL and Hindi), Ken Burns, cards, Shorts reframe, thumbnails. | An imported plan becomes a playable 16:9 master + 9:16 Short that passes the ffprobe checks. |
| 5 | **QA + publish** | QA module, review inbox, approve/reject, YouTube OAuth + upload + scheduling, email notification, both publish modes. | A test video uploads to a test channel as private, then approval schedules it. |
| 6 | **Automation** | Cowork scheduled-task prompts (daily production, weekly review) in `automation/`, Chrome fallback instructions, analytics pull and reports, dashboard + analytics pages. | A scheduled run goes from topic to private upload with no manual step. |
| 7 | **Niche research + pilot** | Niche shortlist (separate step), channel setup, seeded topic queue, 2-week pilot (e.g. 1 long + 4 Shorts/week, review mode). | Pilot videos published; first weekly report generated. |

## 4. QA and handoff
- **End-to-end golden path, run for real**: topic → plan → clips → audio → assembled long + Short → QA → private upload → approve → scheduled. Then the auto-mode path once.
- **Failure drills**: Veoframe logged out, a selector broken, the quota exhausted, the API fallback taking over, backend killed mid-job, a YouTube quota error.
- **Seed data**: a demo channel (English) plus one Urdu demo channel, 25+ sample topics with notes, 3 sample plans (long narrated, Short native-audio, Urdu Short), and a few finished demo projects so every UI page has content.
- **Handoff**: URLs (UI :4500, API :4501), how to start everything, where secrets go, what is stubbed (e.g. "fal fallback needs a key"), a running-cost summary, and a one-page runbook for when Veoframe changes.

## 5. Running cost (estimate)
Veoframe Pro is about Rs 2,000/month. OpenAI or Gemini TTS and fallback images are a few dollars. Everything else is free. API clips are only paid for when Veoframe fails.

## 6. Open items to settle later
- Niche, plus the channel name and branding.
- Whether to run more than one channel.
- Background music source.
- Whether to buy the Veoframe API/partner plan once volume grows.
