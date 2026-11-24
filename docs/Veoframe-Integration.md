# Veoframe integration: what is mapped, what is built, what is left

Date: 2026-11-21. Mapped from the live Studio, Overview, Gallery and Subscription pages in the owner's signed-in browser, **before the Weekly Pro plan was active** (the account showed "Free, No plan" and the Generate button was disabled). Nothing was generated and nothing was paid for or changed.

## What the Studio offers (read from the page)
- **Modes:** Image or Video. Video has sub-modes **Frame & Text** (text prompt, with a **+** button to attach a start frame) and **Reference** (up to 7 images, used in the prompt as @image1, @image2...).
- **Video models:** Veo 3.1 Fast (default, 8 s), Seedance 2.0, Wan 2.6. Two toggles: **Omni Flash** (10 s) and **Exclusive - 15s** (model "VEO Frame Exclusive", 15 s).
- **Resolution:** 720p or 1080p. **Aspect ratio:** 16:9 or 9:16 (video); images also offer 1:1, 4:3, 3:4.
- **Image models:** Qwen Image, Seedream 4.0, Nano Banana 2.
- **Gallery:** filter All / Images / Videos, "Download all", "Delete all".

## Limits on the account page (differs from the landing page)
- Weekly Pro: **150 HD video generations and 200 image generations a day, up to 10 renders at once**; quotas reset at midnight. (The landing page said 120 + 30 videos and 200 images.)
- **Generated media is deleted after 24 hours**, so every clip must be downloaded straight away.
- Failed generations refund their quota unit (landing-page FAQ).
- Terms: you own the generations; payments are verified manually, so activation can take hours.

## Built before activation
- `veoframe` clip provider with the real model labels and a `VEOFRAME_MODE` setting (`veo-fast`, `omni-flash`, `exclusive-15s`); switched off until `VEOFRAME_ENABLED=true`.
- Quota default set to 150 clips a day; the quota guard skips Veoframe once spent and falls back to the next provider.
- Job-pack instructions with the exact Studio steps (`backend/src/providers/instructions.ts`), written next to each job pack.
- A provider fallback order (Settings page) so Google Flow and Veoframe can back each other up.

## To verify on the first real generation (needs the active plan)
1. Whether **9:16 at 1080p** is offered for Veo 3.1 Fast, and each model's real output resolution.
2. The exact **download control** (Studio card, Gallery item or "Select downloads") and the file name it produces. The worker needs this to be hands-off.
3. Whether a **visible watermark** is added (the competitor Veo Unlimited states "no watermark"; Veoframe's pages do not say).
4. Render time per clip, and how the 10-render concurrency behaves.
5. How faithfully **start-frame (image to video)** follows the image, compared with Google Flow.
6. Whether browser automation is tolerated (its fair-use note restricts "automated abuse, excessive parallel usage"); keep to 3-5 renders at a time with pauses.

## Activation checklist (tomorrow)
1. Confirm the sidebar shows Weekly Pro and Overview shows the video quota.
2. Set `VEOFRAME_ENABLED=true` (and `VEOFRAME_MODE` if not `veo-fast`) in `backend/.env`, restart the backend.
3. Generate one clip from a plan prompt; record answers to the six items above here.
4. Update the instructions with the confirmed download steps.

## Findings from the first real test (2026-11-22, Weekly Pro active, one clip only)
- **Plan:** Studio shows Pro Plan, 7 days left, 150 videos/day counter; 8 s videos 120 left, 15 s 30 left, images 200. `VEOFRAME_ENABLED=true` and `VEOFRAME_MODE=veo-fast` are now in `backend/.env` (restart the backend to pick them up).
- **Controls:** resolution, aspect and model are native `<select>` elements (set them with form input, clicking the option does nothing). 1080p and 9:16 are both offered.
- **1080p failed:** Veo 3.1 Fast, 1080p, 9:16 returned "VeoFrame account currently has the credits or quality allowance required... ask the administrator to replenish the provider balance. This request was not queued." Quota was not charged. This is a provider-side balance problem on Veoframe's side, so 1080p cannot be relied on until they fix it. Ask their support.
- **720p worked:** same prompt, 720p 9:16 8 s, accepted; quota 120 -> 119 left. Render time about 60 s (queued, then rendering to 100%).
- **Job page:** clicking a finished card opens `/user/job.php?id=<jobId>` with the prompt, aspect, duration, "Charged: 0 credits", a Download link (`/media.php?id=<jobId>&dl=1`) and a built-in player. The **Download button on the job page does save the file** (`veo-frame-video-<jobId>.mp4` in the browser's Downloads folder). My first two clicks did not, most likely because the browser was being used at the same moment; the third worked, so the worker should click once and wait for the file to appear.
- **Output file:** 576x1024 (not 720x1280 even though 720p was selected), H.264, 8.04 s, with an AAC audio track (32 kHz, so ambience is included). The pipeline scales it up to 1080x1920, so expect a softer picture than the Google Flow clips (720x1280).
- **Watermark:** none visible in the first and last frames.
- **Fidelity:** the clip shows a huge, tightly cropped planet and rings over water, not the small "beach ball" planet in the prompt; the Google Flow clip, started from a still, matched the plan much better. Use a start frame (the "+" button) for Veoframe too before relying on it.
- **Not done:** no full video was made (per the owner's instruction), only this one clip.

## Comparison with Veo Unlimited (read 2026-11-21, headline plans only)
Veoframe Weekly Pro is Rs 499 a week (about Rs 2,000 for 4 weeks) with Veo 3.1 Fast, 1080p and 150 videos a day. Veo Unlimited's PKR 2,000 for 30 days plan uses Veo 3.1 Lite at 720p with 1,500 videos in 30 days; 1080p starts at its PKR 5,000 plan and unlimited videos at PKR 10,000 and up, with no refunds after delivery. Veo Unlimited states "no watermark" and offers first and last frame, extend video and character consistency tools. Neither has been tested for output quality; both are small resellers with manual payment.
