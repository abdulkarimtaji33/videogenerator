# Status (2026-11-22)

Plan: `docs/Product-Improvement-Plan.md` (also on the Desktop).

## What the product does now
One idea becomes a video for any niche:
idea -> niche profile -> creative brief (subject mode + 0-4 visual anchors + style) -> verified facts -> hook (research hook engine) ->
SEO package (3 title angles, keyword, description, tags, thumbnail concepts) -> script (Short or long beats, but/therefore links, loops, payoff, loop ending) ->
automatic script review (switchable) -> anchor reference images -> shot images (made from the shot's anchors) -> Veoframe clips (shots that continue a scene start from the previous clip's last frame) ->
narration, captions, loudness and QA -> thumbnails A/B -> optional YouTube upload.

Anchors fix the "planet became a woman" problem: a space idea anchors the planet, history anchors a place and an object, a character series anchors a cast.
Checked live on three niches (space, Roman history, robot series): the right anchors were chosen and the subject stays the same across shots.

## Added in Shotcraft v4 (plan: `docs/Editing-Quality-Plan.md`)
- Image provider layer: every image goes through `makeImage()`. Self-hosted FLUX (`flux-local`) is the default and can be chosen per project (`flux-local`, `openai`, `fal`), with a per-project "fall back to OpenAI if FLUX is down" toggle (off by default). Settings, server start and fallback rules: `docs/Image-Models.md`.
- Edit pass modules in `backend/src/edit/` (rules, styles, director, critique, filters, audio library). Saved on the project as `edit_json` / `edit_review_json`. Details: `docs/Edit-Pass.md`.
- Synthetic CC0 audio pack (`node scripts/fetch-audio.js`).
- Six plan-only demo projects titled `Demo:` (`node scripts/seed.js`, idempotent); two have a saved edit plan. They have no images or clips; do not run "make video" on them.
- Health check: `node scripts/qa-check.js` (read-only; PASS/FAIL/WARN lines for backend, image layer, FLUX, demo projects, frontend).

## Updated 2026-11-23
- FLUX 3 Image Klein (Q4_K_M GGUF + Qwen3-VL 4B encoder + FLUX.2 VAE) is installed in `e:\projects\flux` and runs through stable-diffusion.cpp `sd-server` (start: `powershell -File e:\projects\flux\start.ps1`; `npm run flux` in backend). It was downloaded with `e:\projects\flux\segdl.js` (parallel, resumable).
- Measured on this PC (CPU only): one 576x576 image, 4 steps = 994 s (16.6 min); a portrait would be about 30 min, so a Short needs hours of image time. See `e:\projects\flux\BENCHMARK.md`. Fix: a rented GPU URL (Settings -> Image model), a smaller render size, or OpenAI/fal for shot images.
- The saved default image model is currently `openai` (`backend/storage/image-settings.json`); the code default is `flux-local`. Switch back in Settings once FLUX is fast enough.
- The FLUX client (`src/providers/fluxLocal.ts`) renders through the server's async job API: it submits the render (`POST /sdcpp/v1/img_gen`), then polls `GET /sdcpp/v1/jobs/{id}` every 5 s. No connection is held open, so a render can take hours (limit `FLUX_TIMEOUT_MIN`, default 720 = 12 h). It survives dropped polls, a server restart (the job is submitted again, up to 3 times), a backend restart (the job id is saved in `storage/flux-jobs.json` and the same job is resumed), and gives up only if the server is unreachable for `FLUX_UNREACHABLE_MIN` (default 15) minutes. A server without the job API falls back to the single OpenAI-style request. Verified with 7 fake-server tests (`test/fluxJobs.test.ts`) and one real render through the product route (402 s for a 1024x1024 test image rendered at 384x384).
- Edit pass works end to end: the Saturn Short (project 2) was re-assembled with music, effects, punch-ins, grade, loop and captions at y 1248; all 17 QA checks pass (-14.38 LUFS, -1.09 dBTP). A rebuild reuses narration when the text and voice are unchanged (`narration-hash.json` in the work folder).
- Long-form structure is now set by position (hook, re-hooks at one and two thirds, side story in the middle, payoff, bridge) and a hook longer than one shot is shortened to whole sentences.
- Graphics overlay pass (long-form only): HyperFrames renders chapter/stat/end cards as an alpha WebM that FFmpeg composites (`src/edit/hyperframes/`). Verified: a 64 s overlay took 679 s to render; HyperFrames needs the full FFmpeg (with ffprobe) and system Chrome, which the module now finds itself. Never breaks a build: on failure the video stays as assembled.

- Plan builder resumes after an interruption (`resumeState` in `src/nichePipeline.ts`): if a run stopped while making pictures (stage `anchors` or `shots`), the next run reuses the saved brief and final script and the finished images and makes only the missing ones. Any earlier stage starts again from the idea, so a restart during the first minutes still repeats the script writing. Not yet tried on a real interrupted run; the decision logic is unit tested.
- Optional text fallback (`src/textFallback.ts`): when OpenAI text generation fails (429 no credits, 401/403, 5xx, network) and `ANTHROPIC_API_KEY` and/or `GEMINI_API_KEY` is set in `backend/.env`, `generateText` uses Claude (`ANTHROPIC_TEXT_MODEL`, default claude-sonnet-5-5) or Gemini (`GEMINI_TEXT_MODEL`, default gemini-2.5-flash) in the order of `TEXT_FALLBACK_ORDER` (default `anthropic,gemini`). With no key set, nothing changes. Word timing (Whisper), images and speech are not covered.
- Caption word timing no longer needs OpenAI Whisper for the default Edge voice: Edge reports each word's start and end while speaking; they are saved as `<narration>.mp3.words.json` and used by `narrate()`. Whisper is still the fallback for other voices. Checked live on 2026-11-23.
- FLUX render size is 384x640 at 4 steps: 513 s per image on this PC (`e:\projects\flux\BENCHMARK.md`).

## Updated 2026-11-25
- Text model: **Ollama `qwen3.8:27b` is now the default writer**; OpenAI is the second choice and the standby (Settings -> "Text model (writing)"). Research, rejected models and every setting: `docs/Text-Models.md`. Needs `ollama pull qwen3.8:27b` once; Ollama was not installed on this PC when this was written, so nothing was generated with it yet (fake-server tests only: `test/ollamaText.test.ts`).
- OpenAI key is no longer required to start the backend.
- Fixes: resume after an interrupted plan now keeps finished shot images (the job handler no longer deletes shot rows first); port defaults changed to 4501 in config and the frontend.

## Updated 2026-11-26: Gemini is the default text model
- All text steps (brief, facts, hooks, SEO, script, review, Urdu/Hindi translation) now go to **Gemini** first (`gemini-3.5-flash-lite`, minimal thinking; `gemini-3.8-flash` choosable), with a model chain and fallbacks to OpenAI, Ollama and Claude. Details and the real test results (free-tier key: Pro has no quota, 2.5 family gone, 3.8 Flash often busy): `docs/Text-Models.md`. The key is in `backend/.env` only.
- Not yet done with Gemini: a full plan-only project and a new video. Projects 13 (finished, `storage/shorts/project-13/final/project-13.mp4`) and 14 (video failed on a corrupt clip file, `moov atom not found`) were made earlier with Ollama and hand-written Urdu.

## Updated 2026-11-25 (later): Ollama on the server, Urdu/Hindi, anime
- **Ollama runs on the VPS** (Ubuntu, 2 vCPU, 7.8 GB, no GPU), bound to localhost, limited to 6 GB and a low CPU priority so the production apps are safe. The app reaches it through an SSH tunnel (`npm run ollama:tunnel`, `OLLAMA_SSH` in `.env`, address `http://127.0.0.1:11435` in Settings). Real findings are in `docs/Text-Models.md`: `qwen3.8:27b` cannot load there; `qwen3.5:4b` works and is the saved model. Memory tuning and the "sent nothing for 20 minutes" failure are documented there too.
- **Urdu and Hindi** (`docs/Urdu-Hindi.md`): English script, then localization to spoken Urdu/Hindi plus Roman captions and a speaker per line; Edge neural voices tested for real (ur-PK-Asad/Uzma, ur-IN-Salman, hi-IN-Madhur/Swara) and Edge reports one timing per word; characters get voices by gender; a line that is too long is spoken faster (up to 1.3x). Hindi limit 14 words a shot, Urdu 17.
- **Anime niche** (`anime_story`) with an anime look in every image and clip prompt.
- **JSON repair** for small models (`src/jsonLoose.ts`), three attempts per step.
- **Tools:** `npm run check:text [-- --brief]`, `scripts/check-voices.ts`, `scripts/preflight-voice.ts <id>`, `scripts/project-status.js <ids>`, `src/cli/relocalize.ts <id> [--gender ..] [--lines file]`.
- **Test videos in progress:** project 13 (two robot friends, Urdu, dialogue) and project 14 (original anime, Urdu, dialogue), 48 s each, FLUX images, Veoframe clips. The Urdu lines of both were written by hand because the 4B model's Urdu was not good enough to show. FLUX renders shots with references at about 16 minutes each (8.6 without references); sd-server evidently resizes references itself, so shrinking them before sending changed nothing measurable.
- **Fixed:** the plan builder now really resumes after an interruption (the job handler used to delete shot rows first). Verified for real on these two projects (several restarts, finished images kept).

## Known blockers
- No NVIDIA GPU (Intel HD 520 only), so FLUX is slow (see above).
- OpenAI credits are exhausted (429). Text, Whisper and OpenAI images fail until credits are added; a new full plan-only run could not be done.
- Google OAuth (YouTube) and SMTP settings are still needed.
- The Chungulus GGUF loaded fine in sd.cpp; the first VAE file was corrupted (error page bytes) and was repaired; if the server reports "unknown format", re-download the VAE.

## Verified
- Backend `tsc` and frontend `tsc` clean. Backend suite (see the 2026-11-23 run in the session log; older figure: 16 files, 167 tests; run with `node ./node_modules/vitest/vitest.mjs run`; vitest.config.mts uses `pool: "vmForks"` because the default pool intermittently loaded two copies of vitest on this PC).
- Plan-only runs for three niches finish in about 3 minutes (OpenAI only, no Veoframe clips).
- One-click video through the Veoframe worker (own browser profile, signed in once with `node scripts/veoframe-login.js`).

## Needs the user
- YouTube OAuth client (Google Cloud) for the live upload; the upload code is tested with mocks only.
- SMTP settings for the email notification.
- Veoframe 1080p still fails on their side (provider balance); 720p works.

## Known limits
- Hook type rotation can flag repeated test runs ("hook_type_rotates"); it is a policy guard, not a bug.
- Long videos (all AI clips) are quota-heavy (about 75 clips per 10 minutes); only tested with fake models so far.
- Urdu captions use Segoe UI (no Nastaliq font installed); not checked visually.
- Veoframe output is 576x1024 (scaled up to 1080x1920).
