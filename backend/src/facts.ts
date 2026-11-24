// Facts for a video: the model lists claims it is confident about, then a second, strict pass keeps only the ones it
// confirms (failing closed: if the check cannot be read, nothing is kept as verified). No web search is used (owner's
// decision); sources are the well-known references the model names.
import { generateText } from "./openai";
import { factVerifyPrompt, factsPrompt } from "./prompts";
import type { CreativeBrief, NicheProfile, VerifiedFact } from "./niche/types";

function parseArray(raw: string): any[] {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const v = JSON.parse(cleaned);
  if (!Array.isArray(v)) throw new Error("expected a JSON array");
  return v;
}

export async function gatherVerifiedFacts(
  idea: string,
  brief: CreativeBrief,
  profile: NicheProfile,
  ask: (system: string, user: string) => Promise<string> = generateText
): Promise<VerifiedFact[]> {
  let candidates: { claim: string; source: string }[] = [];
  try {
    const p = factsPrompt({ idea, brief, profile });
    candidates = parseArray(await ask(p.system, p.user))
      .filter((f) => f && typeof f.claim === "string" && f.claim.trim())
      .map((f) => ({ claim: String(f.claim).trim(), source: String(f.source || "").trim() }))
      .slice(0, 12);
  } catch {
    return [];
  }
  if (!candidates.length) return [];

  let verdicts: { i: number; true: boolean }[] | null = null;
  try {
    const v = factVerifyPrompt(candidates);
    verdicts = parseArray(await ask(v.system, v.user));
  } catch {
    verdicts = null;
  }
  // Fail closed: without a readable verdict nothing counts as verified.
  const kept = candidates.filter((_, idx) => verdicts?.find((x) => Number(x.i) === idx + 1)?.true === true);
  return kept.map((f, i) => ({ id: i + 1, claim: f.claim, source: f.source || "general reference" }));
}
