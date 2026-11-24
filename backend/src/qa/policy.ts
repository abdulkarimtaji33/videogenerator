// Policy and originality checks that run before a video can be approved. They encode YouTube's published
// monetization rules (docs/Viral-Video-Research-Complete.md, sections 5 and 8.3): sourced facts, no AI persona
// giving advice on sensitive topics, synthetic-media disclosure, no templated or repeated content.
import { query } from "../db";
import { contentWords } from "../hooks/lint";
import type { ShortPlan } from "../shorts/plan";

export interface PolicyFinding {
  level: "ok" | "warn" | "error";
  id: string;
  message: string;
}

const SENSITIVE = /\b(invest(ing|ment)?|stocks?|crypto(currency)?|trading|loan|mortgage|tax(es)?|diagnos(e|is)|symptoms?|treatment|cure|medication|dosage|lawsuit|legal advice|sue|attorney|supplement)\b/i;
const ADVICE_VERBS = /\b(you should|you must|buy|sell|take|stop taking|how to (cure|treat|invest|avoid tax)|best way to)\b/i;

export function policyCheck(plan: ShortPlan, opts: { bannedTopics?: string[] } = {}): PolicyFinding[] {
  const out: PolicyFinding[] = [];
  const add = (level: PolicyFinding["level"], id: string, message: string) => out.push({ level, id, message });
  const text = [plan.title, plan.topic, ...plan.clips.map((c) => c.narration)].join(" ");

  if (SENSITIVE.test(text) && ADVICE_VERBS.test(text)) {
    add("error", "ai_persona_advice", "Looks like finance, health or legal advice. YouTube makes AI personas giving advice on these topics ineligible for monetization.");
  } else {
    add("ok", "ai_persona_advice", "No finance, health or legal advice detected.");
  }
  for (const b of opts.bannedTopics ?? []) {
    if (b && new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) add("error", "banned_topic", `Mentions a banned topic from the channel style guide: '${b}'.`);
  }
  if (plan.facts.length === 0) add("error", "sources", "No sources listed for the facts in this video.");
  else add("ok", "sources", `${plan.facts.length} source(s) listed.`);
  add("ok", "synthetic_disclosure", "Will be uploaded with the altered or synthetic content setting enabled (all visuals are AI-generated).");
  const distress = /\b(dies|dying|death|kill(ed|ing)?|murder|suffer(ing)?|torture|abuse)\b/i.test(text);
  add(distress ? "warn" : "ok", "distress", distress ? "Mentions death, violence or suffering; check it is not emotionally manipulative content." : "No distressing themes detected.");
  return out;
}

const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni ? inter / uni : 0;
};

export interface UniquenessResult {
  findings: PolicyFinding[];
  compared: number;
  maxSimilarity: number;
}

/** Compares this plan with the channel's last 20 videos (repeated topic, hook type or near-identical narration). */
export async function uniquenessCheck(plan: ShortPlan, channelId: number | null, excludeProjectId?: number): Promise<UniquenessResult> {
  const rows = await query<any[]>(
    `SELECT id, title, plan_json FROM projects WHERE plan_json IS NOT NULL AND (? IS NULL OR channel_id = ?) AND (? IS NULL OR id <> ?) ORDER BY id DESC LIMIT 20`,
    [channelId, channelId, excludeProjectId ?? null, excludeProjectId ?? null]
  );
  const mine = new Set(contentWords(plan.clips.map((c) => c.narration).join(" ")));
  const findings: PolicyFinding[] = [];
  let max = 0;
  const recentTypes: string[] = [];
  for (const r of rows) {
    let other: any;
    try {
      other = JSON.parse(r.plan_json);
    } catch {
      continue;
    }
    if (recentTypes.length < 3 && other?.hook?.type) recentTypes.push(other.hook.type);
    const sim = jaccard(mine, new Set(contentWords((other.clips || []).map((c: any) => c.narration || "").join(" "))));
    max = Math.max(max, sim);
    if (norm(other.title) === norm(plan.title) || norm(other.topic) === norm(plan.topic)) {
      findings.push({ level: "error", id: "duplicate_topic", message: `Same title or topic as project ${r.id} ('${r.title}').` });
    } else if (sim >= 0.6) {
      findings.push({ level: "error", id: "near_duplicate", message: `Narration is ${(sim * 100).toFixed(0)}% similar to project ${r.id}; templated or repeated content is ineligible for monetization.` });
    } else if (sim >= 0.4) {
      findings.push({ level: "warn", id: "similar", message: `Narration is ${(sim * 100).toFixed(0)}% similar to project ${r.id}.` });
    }
  }
  if (recentTypes.includes(plan.hook.type)) findings.push({ level: "warn", id: "hook_type_repeat", message: `Hook type '${plan.hook.type}' was used in one of the last 3 videos.` });
  if (findings.length === 0) findings.push({ level: "ok", id: "unique", message: `Distinct from the last ${rows.length} video(s).` });
  return { findings, compared: rows.length, maxSimilarity: Math.round(max * 100) / 100 };
}

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
