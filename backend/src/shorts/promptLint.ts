// Checks a Veo-style video prompt against Google's published prompting guidance (one focused moment per
// prompt, rich camera/lighting detail, avoid quotation marks because they can trigger text rendering)
// and the project's own rules (shared style bible, no on-screen text, no stray speech when a separate
// narrator is used, no hard-to-render faces or hands). See docs/Viral-Video-Research-Complete.md, section 6.

import type { ClipPlan, ShortPlan } from "./plan";
import { contentWords } from "../hooks/lint";

export interface PromptIssue {
  level: "error" | "warn";
  id: string;
  message: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.,;]+$/g, "").trim();

export function lintPrompt(plan: ShortPlan, clip: ClipPlan, index: number): PromptIssue[] {
  const issues: PromptIssue[] = [];
  const add = (level: PromptIssue["level"], id: string, message: string) => issues.push({ level, id, message });
  const p = clip.prompt;
  const words = p.trim().split(/\s+/).length;

  if (!norm(p).includes(norm(plan.styleBible))) {
    add("error", "style_bible", "Prompt does not contain the plan's style bible sentence; clips will not match each other.");
  }
  if (/["“”]/.test(p)) {
    // Quotation marks are how Veo is given dialogue, so they are only an error when a separate narrator speaks.
    if (plan.narration.mode === "veo-native") add("warn", "quotes", "Quotation marks are treated as spoken dialogue; keep the lines short and keep one voice per clip.");
    else add("error", "quotes", "Contains quotation marks; Veo can render quoted words as on-screen text or speech.");
  }
  const stripped = p.replace(/\b(no|without|free of|zero|never any)\s+(any\s+)?(on-screen\s+)?(text|captions?|subtitles?|logos?|watermarks?|lettering|words|writing)\b/gi, "");
  if (/\b(text|captions?|subtitles?|title card|logo|watermark|lettering|label|signage|written)\b/i.test(stripped)) {
    add("error", "onscreen_text", "Mentions text, captions or logos; AI video renders text badly. Describe the scene without any writing, and add 'no text'.");
  }
  if (!/\bno (on-screen )?(text|captions?|subtitles?|logos?|watermarks?)\b|\bwithout (any )?(text|captions?|logos?)\b/i.test(p)) {
    add("warn", "no_text_clause", "Add an explicit 'no text, no logos, no watermarks' clause.");
  }
  if (plan.narration.mode === "tts" && !/\bno (speech|dialogue|voice-?over|voices?|talking|narration|spoken)\b|\bwithout (any )?(speech|dialogue|voice)/i.test(p)) {
    add("error", "stray_speech", "A separate narrator is used, so the prompt must say there is no speech or dialogue; otherwise Veo may add a random voice.");
  }
  if (words < 45 || words > 150) {
    add("warn", "length", `${words} words; aim for about 60-120 words of concrete detail.`);
  }
  if (!/\b(dolly|tracking|pan|tilt|orbit|push-?in|pull-?back|crane|handheld|static|zoom|aerial|macro|wide shot|close-up|low[- ]angle|high[- ]angle|slow (push|move|drift)|camera)\b/i.test(p)) {
    add("warn", "camera", "No camera direction (for example 'slow push-in' or 'wide shot').");
  }
  if (!/\b(light|lighting|glow|backlit|rim|volumetric|cinematic|photoreal|imax|anamorphic|35mm|lens|sunrise|shadow|haze)\b/i.test(p)) {
    add("warn", "lighting", "No lighting or lens/style detail.");
  }
  if (!/\baudio\s*:/i.test(p)) {
    add("warn", "audio_line", "Add an 'Audio:' line describing ambient sound so the track is predictable.");
  }
  if (!/9:16|vertical|portrait/i.test(p)) {
    add("warn", "vertical", "Mention vertical 9:16 framing so the subject sits in the middle of a tall frame.");
  }
  const chain = (p.match(/\b(then|after that|next|finally|afterwards|and then|meanwhile)\b/gi) || []).length;
  if (chain > 1) {
    add("warn", "chained_actions", "Several chained actions; Google's guidance is one focused moment per prompt, or results get muddled.");
  }
  if (/\b(face|faces|close-up of (a |an |the )?(person|man|woman|child)|hands?|fingers|crowd|people|person|astronaut)\b/i.test(p)) {
    add("warn", "artifact_risk", "Faces, hands or crowds are where AI video artifacts show most; keep them small, distant or avoid them.");
  }
  if (index === 0) {
    const hv = new Set(contentWords(plan.hook.visual));
    const overlap = contentWords(p).filter((w) => hv.has(w));
    if (overlap.length < 3) {
      add("error", "hook_visual", "The first clip must open on the hook's visual (cold open); it shares fewer than 3 key words with hook.visual.");
    }
  }
  return issues;
}

export function lintPlanPrompts(plan: ShortPlan): { clip: string; issues: PromptIssue[] }[] {
  // Only AI clips have prompts; stills and cards are rendered locally.
  return plan.clips.map((c, i) => ({ clip: c.id, issues: c.type === "ai_video" ? lintPrompt(plan, c, i) : [] }));
}
