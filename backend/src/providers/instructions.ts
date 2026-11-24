// Step-by-step instructions written into each job pack, so the worker (Claude in Chrome, a Cowork scheduled
// task, or a person) can generate every clip the same way. The Veoframe steps come from mapping the live
// Studio page on 2026-11-21 before the plan was active; the parts marked VERIFY need one real generation.
import type { ShortPlan } from "../shorts/plan";

export const VEOFRAME_MODES = {
  "veo-fast": { label: "Veo 3.1 Fast", seconds: 8, toggle: null as string | null },
  "omni-flash": { label: "Omni Flash", seconds: 10, toggle: "Omni Flash" },
  "exclusive-15s": { label: "VEO Frame Exclusive", seconds: 15, toggle: "Exclusive - 15s" },
} as const;

export type VeoframeMode = keyof typeof VEOFRAME_MODES;

export function veoframeMode(): (typeof VEOFRAME_MODES)[VeoframeMode] & { id: VeoframeMode } {
  const id = (process.env.VEOFRAME_MODE as VeoframeMode) in VEOFRAME_MODES ? (process.env.VEOFRAME_MODE as VeoframeMode) : "veo-fast";
  return { id, ...VEOFRAME_MODES[id] };
}

const common = (plan: ShortPlan) =>
  [
    "Rules that make the first attempt succeed:",
    "- Paste the prompt exactly as written in the job JSON. Do not add or remove words.",
    `- Choose ${plan.aspect === "9:16" ? "9:16 (vertical)" : "16:9 (landscape)"} before generating. One output per prompt.`,
    "- If a clip comes out with text, a face artifact or a flicker, regenerate only that clip.",
    "- Save each finished mp4 at the path in its job JSON (the `output` field). The pipeline picks it up from there.",
  ].join("\n");

export function instructionsFor(provider: string, plan: ShortPlan): string {
  const clips = plan.clips.filter((c) => c.type === "ai_video").map((c, i) => `${i + 1}. ${c.id}  ->  save as clips/${c.id}.mp4  (${c.seconds}s used)`).join("\n");
  if (provider === "veoframe") {
    const m = veoframeMode();
    return [
      `# Job pack: Veoframe - ${plan.title}`,
      "",
      `Mode in use: ${m.label} (${m.seconds}s per clip). Set VEOFRAME_MODE to veo-fast, omni-flash or exclusive-15s.`,
      "",
      "## Steps (mapped from the live Studio page)",
      "1. Open https://veoframe.com/user/generate.php while signed in. The sidebar must show the plan as Weekly Pro, not 'Free / No plan'. On Overview, check today's video quota (150 a day on Weekly Pro; resets at midnight).",
      "2. Click the **Video** tab (not Image).",
      "3. Sub-mode **Frame & Text** for text-to-video (the **+** button beside the prompt attaches a start frame). Sub-mode **Reference** attaches up to 7 images, referenced in the prompt as @image1, @image2 and so on.",
      `4. Model: ${m.toggle ? `click the **${m.toggle}** toggle (it switches the model and the duration to ${m.seconds}s)` : "leave the dropdown on **Veo 3.1 Fast** (8s). Other options: Seedance 2.0, Wan 2.6"}.`,
      `5. Resolution: **720p** (1080p currently fails with a provider-balance error on Veoframe's side; the saved file is about 576x1024). Aspect ratio: **${plan.aspect}**. The resolution, aspect and model controls are native dropdowns: set them with form input, clicking the option text does nothing.`,
      "6. Paste the clip prompt into the box 'Describe the content you want to create...', then click **Generate**. Up to 10 renders can run at once; keep to 3-5 and wait a few seconds between submissions.",
      "7. A clip renders in about a minute. Click the finished card to open its job page (/user/job.php?id=ID), then click the **Download** button once and wait: it saves veo-frame-video-ID.mp4 (it has an audio track). Do this straight away, because Veoframe deletes all generated media after 24 hours, and do not use the browser at the same time or the click may be lost.",
      "8. Move the downloaded file to the job's `output` path and make sure it is a complete mp4 (more than 50 KB).",
      "9. A failed generation refunds its quota unit (per the site's FAQ); retry only that clip.",
      "",
      "## Confirmed on 2026-11-22 (first real clip) and still open",
      "- Confirmed: 9:16 works at 720p (file ~576x1024, 8 s, AAC audio); no watermark seen; render about 60 s; the job-page Download button saves the file.",
      "- Open: 1080p fails (provider balance); ask Veoframe support.",
      "- Open: text-only prompts drifted from the plan (a huge cropped planet instead of a small floating one). Attach the start frame with the **+** button where the plan has a first-frame image, and compare with Google Flow.",
      "",
      common(plan),
      "",
      "Clips:",
      clips,
      "",
    ].join("\n");
  }
  if (provider === "google-flow") {
    return [
      `# Job pack: Google Flow - ${plan.title}`,
      "",
      "Credits: free tier 50 a day (resets 3:23 AM). Veo 3.1 Lite 10 credits, Fast 20, Quality 100 per 8s clip. Images are free (Nano Banana). Failed generations are not charged.",
      "",
      "## Steps (mapped from the live Flow project page)",
      "1. Open the Flow project. The right-hand agent panel has a settings gear: **Video defaults** sets model, aspect ratio and number of outputs. Choose the model that fits today's credits, 9:16, x1 output.",
      "2. 'Confirm before generating' is Always: the agent shows what it will generate and waits for confirmation. Check the credit cost shown, then confirm.",
      "3. Ask the agent to generate the clip from the exact prompt in the job JSON (it can also first make a free image to use as the first frame).",
      "4. When the clip is ready, download it, and move it to the job's `output` path.",
      "",
      common(plan),
      "",
      "Clips:",
      clips,
      "",
    ].join("\n");
  }
  return [`# Job pack: ${provider} - ${plan.title}`, "", common(plan), "", "Clips:", clips, ""].join("\n");
}
