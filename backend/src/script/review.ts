// Script review: deterministic checks from the hook research (docs/Viral-Video-Research-Complete.md sections
// 2.2-2.6, 3.1-3.3, 4, 8.1-8.3) plus an optional AI critic that proposes line fixes.

import type { CreativeBrief, ReviewCheck, ReviewReport, Script, ScriptShot } from "../niche/types";
import { WORDS_PER_SECOND } from "../shorts/review";

const MAX_NARRATION_SECONDS = 7.5; // per 8 s shot

const STOPWORDS = new Set([
  "that", "this", "with", "from", "have", "will", "your", "about", "what", "when", "which", "their", "there", "they",
  "them", "into", "than", "then", "were", "been", "being", "would", "could", "should", "just", "like", "more", "most",
  "some", "such", "only", "over", "does", "make", "makes", "video", "show", "shows", "know",
]);

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function wordsOf(s: string): string[] {
  return norm(s).split(" ").filter(Boolean);
}

function keyWords(s: string): string[] {
  return [...new Set(wordsOf(s).filter((w) => w.length > 3 && !STOPWORDS.has(w)))];
}

/** Share of the key words of `source` that also appear (by 5-letter prefix) in `target`. */
function overlap(source: string, target: string): { matched: number; total: number } {
  const keys = keyWords(source);
  const targetStems = new Set(wordsOf(target).map((w) => w.slice(0, 5)));
  const matched = keys.filter((k) => targetStems.has(k.slice(0, 5))).length;
  return { matched, total: keys.length };
}

const GREETING_RE = /^\s*(hi|hello|hey|hiya|welcome|what'?s up|good (morning|afternoon|evening)|greetings|so,|well,|okay,|ok,|um|uh|alright|today (we|i)|let'?s (get started|dive)|before we (start|begin)|don'?t forget to|like and subscribe)\b/i;
const FILLER_RE = /\b(in this video|in today'?s video|in this episode|today we('| a)re going to|today i('| a)m going to|hey guys|welcome back|welcome to)\b/i;
const FIRST_PERSON_RE = /\b(i|i'm|i've|i'll|i'd|my|me|mine|myself|we|we're|we've|our|us)\b/i;

const SPOKEN_WORDS_PER_SECOND = Math.min(WORDS_PER_SECOND, 2.4);

/** Checks that are reported but do not decide whether the script passed. */
const ADVISORY_CHECKS = new Set(["hook_type_rotates"]);

function check(id: string, ok: boolean, okMsg: string, failMsg: string): ReviewCheck {
  return { id, ok, message: ok ? okMsg : failMsg };
}

function stripNameDigits(text: string): string {
  // digits attached to letters are part of a name (K2, GPT-4, COVID-19, B52); bare numbers are not
  return text.replace(/[A-Za-z]+[-]?\d+[A-Za-z0-9]*/g, " ").replace(/\d+[-]?[A-Za-z]+[A-Za-z0-9]*/g, " ");
}

export function reviewScript(script: Script, brief: CreativeBrief, opts?: { recentHookTypes?: string[] }): ReviewReport {
  const shots: ScriptShot[] = script.shots ?? [];
  const checks: ReviewCheck[] = [];
  const first = shots[0];
  const format = script.format;

  // 1. first_line_is_hook
  {
    const hookNorm = norm(script.hook.line);
    const firstNorm = first ? norm(first.narration) : "";
    const startsWithHook = !!first && hookNorm.length > 0 && firstNorm.startsWith(hookNorm);
    const greeting = !!first && (GREETING_RE.test(first.narration) || FILLER_RE.test(first.narration));
    const hookGreeting = GREETING_RE.test(script.hook.line) || FILLER_RE.test(script.hook.line);
    const ok = startsWithHook && !greeting && !hookGreeting;
    checks.push(
      check(
        "first_line_is_hook",
        ok,
        "Shot 1 opens with the hook line and no greeting.",
        !first
          ? "The script has no shots."
          : !startsWithHook
            ? "Shot 1 narration does not start with the hook line."
            : "The opening line is a greeting or filler ('in this video', 'welcome', ...). Start with the claim.",
      ),
    );
  }

  // 2. promise_early
  {
    const early = format === "short" ? shots.slice(0, 1) : shots.slice(0, 2);
    const text = early.map((s) => s.narration).join(" ");
    const o = overlap(brief.promise || script.promise, text);
    const need = Math.min(2, o.total);
    const ok = o.total === 0 ? true : o.matched >= Math.max(1, need);
    checks.push(
      check(
        "promise_early",
        ok,
        format === "short" ? "The promise lands in shot 1." : "The promise lands within the first two shots.",
        format === "short"
          ? `The promise ("${brief.promise}") is not stated in the first line (matched ${o.matched}/${o.total} key words).`
          : `The promise ("${brief.promise}") is not stated within the first two shots (matched ${o.matched}/${o.total} key words).`,
      ),
    );
  }

  // 3. no_and_then
  {
    const bad: number[] = [];
    shots.forEach((s, i) => {
      if (i === 0) return;
      if (s.link !== "but" && s.link !== "therefore") bad.push(i + 1);
      else if (/^\s*and then\b/i.test(s.narration)) bad.push(i + 1);
    });
    checks.push(
      check(
        "no_and_then",
        bad.length === 0,
        "Every shot after the first follows with 'but' or 'therefore'.",
        `Shots ${bad.join(", ")} use 'and then' / no causal link. Link each beat with 'but' or 'therefore'.`,
      ),
    );
  }

  // 4. loops_closed
  {
    const open: string[] = [];
    shots.forEach((s, i) => {
      if (!s.loopOpened) return;
      const key = norm(s.loopOpened);
      const closed = shots.slice(i + 1).some((t) => t.loopClosed && norm(t.loopClosed) === key);
      if (!closed) open.push(s.loopOpened);
    });
    checks.push(
      check(
        "loops_closed",
        open.length === 0,
        "Every open loop is closed by a later shot.",
        `Unclosed loops: ${open.map((o) => `"${o}"`).join("; ")}.`,
      ),
    );
  }

  // 5. payoff_present
  {
    const payoffIdx = shots.map((s, i) => (s.role === "payoff" ? i : -1)).filter((i) => i >= 0);
    const lastBody = Math.max(-1, ...shots.map((s, i) => (s.role === "body" ? i : -1)));
    const ok = payoffIdx.length > 0 && payoffIdx[0] > lastBody;
    checks.push(
      check(
        "payoff_present",
        ok,
        "A payoff shot exists after all body shots.",
        payoffIdx.length === 0 ? "No shot has the role 'payoff'." : "The payoff comes before the last body shot; it must close the story.",
      ),
    );
  }

  // 6. narration_fits
  {
    const long: string[] = [];
    shots.forEach((s, i) => {
      const words = s.narration.trim().split(/\s+/).filter(Boolean).length;
      // The synthetic voice measured about 2.4 words a second on real videos (the generic 2.7 estimate let 19-20 word
      // lines through that then did not fit their 8 s shot).
      const secs = words / SPOKEN_WORDS_PER_SECOND;
      if (secs > MAX_NARRATION_SECONDS) long.push(`shot ${i + 1} (${words} words, ${secs.toFixed(1)}s)`);
    });
    checks.push(
      check(
        "narration_fits",
        long.length === 0,
        "Narration fits each 8 s shot.",
        `Narration too long for 7.5 s: ${long.join(", ")}.`,
      ),
    );
  }

  // 7. numbers_as_words
  {
    const bad: number[] = [];
    shots.forEach((s, i) => {
      if (/\d/.test(stripNameDigits(s.narration))) bad.push(i + 1);
    });
    checks.push(
      check(
        "numbers_as_words",
        bad.length === 0,
        "Numbers are written as words.",
        `Digits in narration (shots ${bad.join(", ")}); write numbers as words so TTS reads them correctly.`,
      ),
    );
  }

  // 8. hook_type_rotates
  {
    const recent = opts?.recentHookTypes ?? [];
    const ok = !recent.includes(script.hook.type);
    checks.push(
      check(
        "hook_type_rotates",
        ok,
        "The hook type differs from recent videos.",
        `Hook type '${script.hook.type}' was used in a recent video; pick a different type.`,
      ),
    );
  }

  // 9. no_first_person (hook line only)
  {
    const ok = !FIRST_PERSON_RE.test(script.hook.line);
    checks.push(check("no_first_person", ok, "The hook line has no first person.", "The hook line uses first person (I, my, we, our); address the subject or the viewer."));
  }

  // 10/11. structure
  if (format === "short") {
    const rank: Record<string, number> = { hook: 0, foreshadow: 1, body: 2, payoff: 3, loop: 4 };
    const roles = shots.map((s) => s.role);
    const problems: string[] = [];
    if (roles[0] !== "hook") problems.push("first shot role must be 'hook'");
    if (roles.length && roles[roles.length - 1] !== "loop") problems.push("last shot role must be 'loop'");
    // Shorts of 5+ shots have a separate foreshadow shot; shorter ones carry the foreshadow in the hook shot.
    if (roles.length >= 5 && !roles.includes("foreshadow")) problems.push("missing 'foreshadow' shot");
    if (!roles.includes("payoff")) problems.push("missing 'payoff' shot");
    let prev = -1;
    for (const r of roles) {
      const k = rank[r];
      if (k === undefined) {
        problems.push(`role '${r}' is not allowed in a Short`);
        break;
      }
      if (k < prev) {
        problems.push("roles must run hook, foreshadow, body..., payoff, loop");
        break;
      }
      prev = k;
    }
    checks.push(
      check("short_structure", problems.length === 0, "Short structure is hook, foreshadow, body, payoff, loop.", `Short structure: ${problems.join("; ")}.`),
    );
  } else {
    const n = shots.length;
    const tol = Math.max(2, Math.ceil(n * 0.15));
    const near = (role: string, target: number) => shots.some((s, i) => s.role === role && Math.abs(i + 1 - target) <= tol);
    const problems: string[] = [];
    if (!near("rehook", n / 3)) problems.push("no 'rehook' near one third");
    if (!near("rehook", (2 * n) / 3)) problems.push("no 'rehook' near two thirds");
    if (!near("side_story", n / 2)) problems.push("no 'side_story' near the middle");
    if (n === 0 || shots[n - 1].role !== "bridge") problems.push("last shot role must be 'bridge'");
    checks.push(
      check("long_structure", problems.length === 0, "Long structure has re-hooks, a mid side story and a closing bridge.", `Long structure: ${problems.join("; ")}.`),
    );
  }

  // 12. anchors_known
  {
    const known = new Set((brief.anchors ?? []).map((a) => a.key));
    const unknown = new Set<string>();
    for (const s of shots) for (const k of s.anchorKeys ?? []) if (!known.has(k)) unknown.add(k);
    checks.push(
      check(
        "anchors_known",
        unknown.size === 0,
        "Every anchor key exists in the brief.",
        `Unknown anchor keys: ${[...unknown].join(", ")}.`,
      ),
    );
  }

  // hook_type_rotates is a policy guard that is shown but never fails a script: the critic cannot change the hook
  // type, and a good video should not read as "Failed" because the same hook type was used recently.
  return { enabled: true, passed: checks.every((c) => c.ok || ADVISORY_CHECKS.has(c.id)), rounds: 0, checks };
}

// ---------------------------------------------------------------------------------------------------------------------
// AI critic + fix loop

export interface ReviewDeps {
  generateText: (system: string, user: string) => Promise<string>;
  enabled: boolean;
  recentHookTypes?: string[];
  maxRounds?: number;
}

interface Fix {
  shotIndex: number;
  field: "narration" | "visual";
  newText: string;
  reason?: string;
}

const CRITIC_SYSTEM = `You are a strict script editor for faceless YouTube videos (Shorts and long-form). You fix a script so it passes the checks listed in the request. You change as little as possible.

Hook checklist (research section 4):
1. The first line is a specific claim, number, scene or question, never a greeting.
2. The first visual matches the title and thumbnail.
3. The title's promise is stated within about 10 seconds (long-form) or in the first line (Shorts).
4. There is one open loop and it is paid off.
5. Branding comes after the hook.
6. The Short makes sense on mute.
7. AI visuals are free of text, face and hand artifacts in the first 3 seconds.
8. Narration is short enough for TTS to land the key noun early.
9. The hook formula differs from the last several videos.
10. Every number or claim is verified.

Pre-publish QA (section 8.3):
- Every beat passes the "but / therefore" test; never "and then".
- At least one open loop, and it is closed later.
- Narration lines are short (at most about 20 words per 8 second shot), key noun early, numbers written as words (no digits).
- Hook, structure and topic differ from recent videos.
- Not built on distress, shock or a manufactured emotional formula.

Rules for your fixes:
- Only rewrite the "narration" or "visual" of a shot. You cannot change roles, links or loop fields.
- Keep shot 1's narration beginning with the exact hook line.
- Keep all facts; do not invent claims.
- Visuals describe one focal moment, with no text, no logos and no speech.

Return ONLY JSON, no prose and no code fences:
{"fixes":[{"shotIndex":1,"field":"narration","newText":"...","reason":"..."}]}
Return {"fixes":[]} if nothing can be fixed by rewriting text.`;

function extractJson(raw: string): unknown {
  let t = (raw ?? "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parseFixes(raw: string): Fix[] {
  const j = extractJson(raw) as { fixes?: unknown } | null;
  if (!j || typeof j !== "object" || !Array.isArray(j.fixes)) return [];
  const out: Fix[] = [];
  for (const f of j.fixes as Record<string, unknown>[]) {
    if (!f || typeof f !== "object") continue;
    const shotIndex = Number(f.shotIndex);
    const field = f.field;
    const newText = f.newText;
    if (!Number.isFinite(shotIndex) || (field !== "narration" && field !== "visual")) continue;
    if (typeof newText !== "string" || !newText.trim()) continue;
    out.push({ shotIndex, field, newText: newText.trim(), reason: typeof f.reason === "string" ? f.reason : undefined });
  }
  return out;
}

function applyFixes(script: Script, fixes: Fix[]): { script: Script; applied: number } {
  const copy: Script = JSON.parse(JSON.stringify(script));
  let applied = 0;
  for (const f of fixes) {
    const shot = copy.shots.find((s) => s.index === f.shotIndex) ?? copy.shots[f.shotIndex - 1];
    if (!shot) continue;
    if (shot[f.field] === f.newText) continue;
    shot[f.field] = f.newText;
    applied++;
  }
  return { script: copy, applied };
}

function failingCount(r: ReviewReport): number {
  return r.checks.filter((c) => !c.ok).length;
}

export async function reviewAndFixScript(
  script: Script,
  brief: CreativeBrief,
  deps: ReviewDeps,
): Promise<{ script: Script; report: ReviewReport }> {
  if (!deps.enabled) return { script, report: { enabled: false, passed: true, rounds: 0, checks: [] } };

  const maxRounds = deps.maxRounds ?? 2;
  const opts = { recentHookTypes: deps.recentHookTypes };
  const initial = reviewScript(script, brief, opts);
  const initiallyFailed = new Set(initial.checks.filter((c) => !c.ok).map((c) => c.id));

  let best = script;
  let bestReport = initial;
  let current = script;
  let currentReport = initial;
  let rounds = 0;

  while (rounds < maxRounds && !currentReport.passed) {
    const failing = currentReport.checks.filter((c) => !c.ok);
    const user = [
      `Format: ${current.format}. Promise: ${brief.promise}`,
      `Hook type: ${current.hook.type}. Hook line: ${current.hook.line}`,
      `Failing checks:`,
      ...failing.map((c) => `- ${c.id}: ${c.message}`),
      `Shots:`,
      ...current.shots.map(
        (s) => `${s.index}. [${s.role}${s.link ? `, ${s.link}` : ""}] narration: ${s.narration} | visual: ${s.visual}`,
      ),
    ].join("\n");

    let fixes: Fix[] = [];
    try {
      fixes = parseFixes(await deps.generateText(CRITIC_SYSTEM, user));
    } catch {
      fixes = [];
    }
    rounds++;
    const { script: next, applied } = applyFixes(current, fixes);
    if (applied === 0) break;
    current = next;
    currentReport = reviewScript(current, brief, opts);
    if (failingCount(currentReport) <= failingCount(bestReport)) {
      best = current;
      bestReport = currentReport;
    }
  }

  const finalReport = reviewScript(best, brief, opts);
  const checks = finalReport.checks.map((c) => (c.ok && initiallyFailed.has(c.id) ? { ...c, fixed: true } : c));
  return { script: best, report: { enabled: true, passed: finalReport.passed, rounds, checks } };
}
