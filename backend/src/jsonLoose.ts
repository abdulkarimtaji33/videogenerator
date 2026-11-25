// Tolerant JSON for model output. Small local models (a 4B model on a small server) often write JSON that is almost right:
// a missing comma, a double quote inside a sentence, a trailing comma, a code fence, text before or after. Strict parsing
// would throw the whole step away, so this tries strict first, then cleans and repairs.

import { jsonrepair } from "jsonrepair";

/** Removes code fences and any text around the outermost JSON value. */
export function extractJsonText(raw: string): string {
  let t = (raw ?? "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const firstObj = t.indexOf("{");
  const firstArr = t.indexOf("[");
  const first = firstObj < 0 ? firstArr : firstArr < 0 ? firstObj : Math.min(firstObj, firstArr);
  if (first < 0) return t;
  const closer = t[first] === "{" ? "}" : "]";
  const last = t.lastIndexOf(closer);
  return last > first ? t.slice(first, last + 1) : t.slice(first);
}

const isContainer = (v: unknown) => typeof v === "object" && v !== null;

/** True when every { and [ outside of strings is closed. */
function isBalanced(s: string): boolean {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
  }
  return depth === 0 && !inStr;
}

/**
 * Parses model output as JSON: strict if it can be, repaired if not. The result is always an object or array (the repair
 * tool would turn plain prose into a JSON string, which is never what a step wants). Throws when nothing JSON-like can be made.
 */
export function parseJsonLoose(raw: string): unknown {
  const text = extractJsonText(raw);
  let strictError: unknown;
  try {
    const v = JSON.parse(text);
    if (isContainer(v)) return v;
  } catch (e) {
    strictError = e;
  }
  // Repair the trimmed text first; if the output was cut off, the part after the last closing bracket is needed, so also
  // try from the first bracket to the very end.
  const t = (raw ?? "").trim();
  const first = Math.min(...["{", "["].map((c) => (t.indexOf(c) < 0 ? Infinity : t.indexOf(c))));
  const tail = Number.isFinite(first) ? t.slice(first) : "";
  // A reply cut off mid-way has unclosed brackets: repair everything that was written, not just the part up to the last bracket.
  const candidates = (tail && !isBalanced(tail) ? [tail, text] : [text, tail]).filter(Boolean);
  for (const c of candidates) {
    try {
      const v = JSON.parse(jsonrepair(c));
      if (isContainer(v)) return v;
    } catch {
      /* try the next candidate */
    }
  }
  throw strictError ?? new Error("The reply contains no JSON object or array.");
}
