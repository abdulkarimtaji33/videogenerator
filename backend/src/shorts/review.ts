// One place that reviews a Short plan before any money or credits are spent: hook rules, Veo prompt rules,
// narration timing, sources and flow availability. Used by the command line, the import API and the tests.
import { recentHookTypes } from "../hooks/engine";
import type { HookType } from "../hooks/library";
import { HookReport, lintHook } from "../hooks/lint";
import { getProvider } from "../providers";
import type { ShortPlan } from "./plan";
import { lintPlanPrompts } from "./promptLint";

export const WORDS_PER_SECOND = 2.7;

export interface Finding {
  level: "ok" | "warn" | "error";
  area: "hook" | "prompt" | "narration" | "facts" | "flow" | "plan";
  id: string;
  message: string;
}

export interface PlanReview {
  findings: Finding[];
  errors: number;
  warnings: number;
  hook: HookReport;
  narrationWords: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export function reviewPlan(plan: ShortPlan, opts: { recentTypes?: HookType[]; skipFlowCheck?: boolean } = {}): PlanReview {
  const findings: Finding[] = [];
  const add = (level: Finding["level"], area: Finding["area"], id: string, message: string) => findings.push({ level, area, id, message });

  const hook = lintHook({
    line: plan.hook.line,
    visual: plan.hook.visual,
    format: "short",
    title: plan.title,
    type: plan.hook.type as HookType,
    recentTypes: opts.recentTypes ?? recentHookTypes(),
  });
  // The hook rules are tuned for English (word counts, capitalised names, reading grade, English filler phrases).
  // For other languages they are advisory only, because they cannot judge Urdu or Hindi text fairly.
  const english = plan.language === "en";
  for (const c of hook.checks) add(c.ok ? "ok" : c.critical && english ? "error" : "warn", "hook", c.id, english || c.ok ? c.message : `${c.message} (advisory: hook rules are English-tuned)`);

  if (plan.narration.mode === "tts") {
    if (!norm(plan.clips[0].narration).startsWith(norm(plan.hook.line))) {
      add("error", "hook", "narration_starts_with_hook", "The first clip's narration must begin with the hook line.");
    } else {
      add("ok", "hook", "narration_starts_with_hook", "The first clip's narration begins with the hook line.");
    }
  }

  for (const { clip, issues } of lintPlanPrompts(plan)) {
    if (issues.length === 0) add("ok", "prompt", clip, `${clip}: passes every prompt rule`);
    for (const i of issues) add(i.level, "prompt", `${clip}.${i.id}`, `${clip}: ${i.message}`);
  }

  let narrationWords = 0;
  for (const c of plan.clips) {
    const words = c.narration.split(/\s+/).filter(Boolean).length;
    narrationWords += words;
    if (plan.narration.mode !== "tts") continue;
    const est = words / WORDS_PER_SECOND;
    const room = c.seconds - plan.narration.delay - 0.3;
    if (est > room) add("error", "narration", `${c.id}.too_long`, `${c.id}: about ${est.toFixed(1)}s of speech does not fit in ${room.toFixed(1)}s (${words} words); shorten it.`);
    else if (est < c.seconds * 0.45) add("warn", "narration", `${c.id}.dead_air`, `${c.id}: only about ${est.toFixed(1)}s of speech in a ${c.seconds}s clip; there will be dead air.`);
    else add("ok", "narration", c.id, `${c.id}: about ${est.toFixed(1)}s of speech in ${room.toFixed(1)}s available (${words} words)`);
  }

  // Continuity: independent clips with different framing and colour read as random footage cut together.
  const ai = plan.clips.filter((c) => c.type === "ai_video");
  if (ai.length >= 3) {
    const unchained = ai.slice(1).filter((c) => c.continuesFrom !== "previous");
    if (unchained.length) {
      add("warn", "plan", "continuity", `Clips ${unchained.map((c) => c.id).join(", ")} do not continue from the previous clip's last frame; they will look like unrelated shots. Set continuesFrom: "previous" and start each from the last frame.`);
    } else add("ok", "plan", "continuity", "Every clip after the first continues from the previous clip's last frame.");
  }

  if (plan.facts.length === 0) add("warn", "facts", "no_sources", "No sourced facts listed; every factual claim in the narration needs a source.");
  else add("ok", "facts", "sources", `${plan.facts.length} sourced fact(s) listed`);
  if (plan.facts.some((f) => !f.source.trim())) add("error", "facts", "empty_source", "A fact has an empty source.");

  const total = plan.clips.reduce((n, c) => n + c.seconds, 0);
  if (Math.abs(total - plan.targetSeconds) > 4) add("warn", "plan", "target_length", `Clips total ${total}s but targetSeconds is ${plan.targetSeconds}.`);

  if (!opts.skipFlowCheck) {
    try {
      const st = getProvider(plan.flow).status();
      add(st.ok ? "ok" : "warn", "flow", plan.flow, st.ok ? `flow '${plan.flow}' is available` : `flow '${plan.flow}': ${st.reason}`);
    } catch (e) {
      add("error", "flow", plan.flow, e instanceof Error ? e.message : String(e));
    }
  }

  return {
    findings,
    errors: findings.filter((f) => f.level === "error").length,
    warnings: findings.filter((f) => f.level === "warn").length,
    hook,
    narrationWords,
  };
}
