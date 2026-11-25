// Hook engine: generates candidate hooks (one per hook type), checks each with the rule-based linter,
// optionally runs an LLM rewrite loop on the best one, remembers which hook types were used recently so
// consecutive videos do not reuse one hook skeleton (templated content is ineligible for monetization).

import fs from "fs";
import path from "path";
import { generateText } from "../openai";
import { parseJsonLoose } from "../jsonLoose";
import { HOOK_TYPES, HookFormat, HookType, templatesFor } from "./library";
import { HookReport, lintHook } from "./lint";

export interface HookCandidate {
  type: HookType;
  line: string;
  visual: string;
  /** Set by the fact check: true when every claim is supported by the verified facts. */
  factOk?: boolean;
  factNote?: string;
}

export interface RankedHook extends HookCandidate {
  report: HookReport;
}

export interface HookContext {
  topic: string;
  format: HookFormat;
  niche?: string;
  title?: string;
  language?: string;
  /** Verified facts the hook may use. The generator must not invent numbers beyond these. */
  facts?: string[];
  count?: number;
  /** Rewrite rounds applied to the best candidate when it does not pass. Default 2. */
  optimizeRounds?: number;
}

const HISTORY_FILE = path.join(process.cwd(), "storage", "hooks", "history.json");

interface HistoryEntry {
  type: HookType;
  line: string;
  at: string;
}

function readHistory(): HistoryEntry[] {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
  } catch {
    return [];
  }
}

export function recentHookTypes(n = 3): HookType[] {
  return readHistory().slice(-n).map((h) => h.type);
}

export function recordHookUse(type: HookType, line: string) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  const h = readHistory();
  h.push({ type, line, at: new Date().toISOString() });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h.slice(-200), null, 2));
}

export function rankHooks(
  candidates: HookCandidate[],
  ctx: { format: HookFormat; title?: string; recentTypes?: HookType[] }
): RankedHook[] {
  const recent = ctx.recentTypes ?? recentHookTypes();
  return candidates
    .map((c) => ({
      ...c,
      report: lintHook({ line: c.line, visual: c.visual, format: ctx.format, title: ctx.title, type: c.type, recentTypes: recent, factOk: c.factOk, factNote: c.factNote }),
    }))
    .sort(compareHooks);
}

/** A hook that passes every critical rule always outranks one that does not, whatever its score. */
function compareHooks(a: RankedHook, b: RankedHook): number {
  return Number(b.report.passed) - Number(a.report.passed) || b.report.score - a.report.score || a.report.words - b.report.words;
}

function systemPrompt(format: HookFormat): string {
  const shortRules =
    "Each hook line is spoken in about 3 seconds: at most 12 words, reading level fifth grade or below.";
  const longRules = "Each hook line is the first spoken line of a long video: at most 28 words, reading level eighth grade or below.";
  const types = Object.entries(HOOK_TYPES)
    .map(([k, v]) => `- ${k}: ${v.label}. ${v.how}`)
    .join("\n");
  const forms = templatesFor(format)
    .map((t) => `- ${t.type}: ${t.formula}`)
    .join("\n");
  return [
    "You write opening hooks for faceless YouTube videos made with AI visuals and a synthetic narrator.",
    format === "short" ? shortRules : longRules,
    "Hard rules:",
    "1. No greeting or filler: never start with hey, hi, welcome, so, well, okay, and never say 'in this video', 'today we', 'like and subscribe'.",
    "2. Open a curiosity gap with one concrete subject: a specific number, a named thing, a direct question or a contradiction.",
    "3. Use only facts given to you. Never invent statistics, names or dates.",
    "4. Write numbers as words when spoken (eight, not 8) unless the digit is part of a name.",
    "5. Each hook has a 'visual': ONE focal subject for the first frame (an object, planet or landscape), 10-35 words, understandable with the sound off. It must contain NO people, faces, hands or eyes, NO text, labels, signs, charts, screens, books or clocks with numbers, and NO split screens or collages. Describe one continuous scene.",
    "6. Every candidate must use a DIFFERENT hook type from the list below.",
    "7. State the surprising fact or question itself. Never promise a reveal: avoid 'you'll see', 'find out', 'here's why', 'at the end', 'soon', 'secret', 'will make you', 'in one minute'.",
    "8. No first person (I, my, we). A faceless factual channel states the fact directly.",
    "Hook types:",
    types,
    "Formulas (fill-in guides):",
    forms,
    'Reply with ONLY a JSON array of objects: [{"type": "<hook type id>", "line": "...", "visual": "..."}]. No markdown, no commentary.',
  ].join("\n");
}

function userPrompt(ctx: HookContext): string {
  const count = ctx.count ?? 10;
  return [
    `Topic: ${ctx.topic}`,
    ctx.niche ? `Niche: ${ctx.niche}` : "",
    ctx.title ? `Working title (the hook must deliver this promise): ${ctx.title}` : "",
    `Language: ${ctx.language || "English"}`,
    ctx.facts?.length ? `Verified facts you may use:\n${ctx.facts.map((f) => `- ${f}`).join("\n")}` : "No facts are verified; do not state any specific number you are not sure of.",
    `Write ${count} candidate hooks, each with a different type.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseCandidates(raw: string): HookCandidate[] {
  const arr = parseJsonLoose(raw);
  if (!Array.isArray(arr)) throw new Error("Hook generator did not return an array");
  const known = new Set(Object.keys(HOOK_TYPES));
  return arr
    .filter((x) => x && typeof x.line === "string" && x.line.trim() && known.has(x.type))
    .map((x) => ({ type: x.type as HookType, line: String(x.line).trim(), visual: String(x.visual || "").trim() }));
}

/**
 * Checks every hook's claims against the verified facts and marks unsupported ones. The rule checker cannot know
 * what is true (a generated hook once claimed Saturn is "almost lighter than air"), so this step fails closed:
 * if the check cannot be read, every hook is marked unsupported.
 */
export async function factCheckHooks(cands: HookCandidate[], facts: string[]): Promise<HookCandidate[]> {
  if (!facts.length || !cands.length) return cands;
  const prompt = [
    "Verified facts:",
    ...facts.map((f) => `- ${f}`),
    "",
    "For each numbered hook, decide whether EVERY factual claim in the hook line is directly supported by, or a plain restatement of, the verified facts above. A claim that goes beyond the facts, exaggerates, or is false is NOT supported. Questions that assert nothing are supported.",
    'Reply with ONLY a JSON array covering every hook, like [{"i":1,"supported":true,"reason":"..."}].',
    ...cands.map((c, i) => `${i + 1}. ${c.line}`),
  ].join("\n");
  let verdicts: { i: number; supported: boolean; reason?: string }[] | null = null;
  try {
    const raw = await generateText("You are a strict fact checker. Reply with only JSON.", prompt);
    const arr = parseJsonLoose(raw);
    if (Array.isArray(arr)) verdicts = arr as { i: number; supported: boolean; reason?: string }[];
  } catch {
    verdicts = null;
  }
  return cands.map((c, idx) => {
    const v = verdicts?.find((x) => Number(x.i) === idx + 1);
    if (!v) return { ...c, factOk: false, factNote: "the fact check could not be completed" };
    return { ...c, factOk: v.supported === true, factNote: v.supported === true ? undefined : v.reason || "not supported by the verified facts" };
  });
}

export async function generateHooks(ctx: HookContext): Promise<{ ranked: RankedHook[]; best: RankedHook; rounds: number; factChecked: boolean }> {
  const raw = await generateText(systemPrompt(ctx.format), userPrompt(ctx));
  const recent = recentHookTypes();
  const factChecked = !!ctx.facts?.length;
  let ranked = rankHooks(await factCheckHooks(parseCandidates(raw), ctx.facts ?? []), { format: ctx.format, title: ctx.title, recentTypes: recent });
  if (ranked.length === 0) throw new Error("Hook generator returned no usable candidates");

  let rounds = 0;
  const maxRounds = ctx.optimizeRounds ?? 2;
  while (!ranked[0].report.passed && rounds < maxRounds) {
    rounds++;
    const best = ranked[0];
    const problems = best.report.checks.filter((c) => !c.ok).map((c) => `- ${c.message}`).join("\n");
    const fixRaw = await generateText(
      systemPrompt(ctx.format),
      [
        userPrompt({ ...ctx, count: 1 }),
        `Rewrite this hook so it passes every rule. Keep type '${best.type}'.`,
        `Current line: ${best.line}`,
        `Current visual: ${best.visual}`,
        `Problems found:\n${problems}`,
      ].join("\n")
    );
    try {
      const fixed = rankHooks(await factCheckHooks(parseCandidates(fixRaw), ctx.facts ?? []), { format: ctx.format, title: ctx.title, recentTypes: recent });
      ranked = [...fixed, ...ranked].sort(compareHooks);
    } catch {
      break;
    }
  }
  return { ranked, best: ranked[0], rounds, factChecked };
}
