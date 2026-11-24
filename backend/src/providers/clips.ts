// Picks a clip provider in the configured order, skipping any that is switched off or out of quota today,
// and falling back to the next one when a provider fails. Records spend against the daily quota.
import { logger } from "../log";
import { getSetting } from "../settings";
import { CLIP_PROVIDERS } from "./index";
import { QuotaDef, canSpend, recordSpend } from "./quota";
import type { ClipProvider, ClipRequest, ClipResult } from "./types";

export interface Attempt {
  provider: string;
  outcome: "ok" | "skipped" | "failed";
  detail?: string;
}

export async function generateClipWithFallback(
  req: ClipRequest,
  opts: { order?: string[]; providers?: Record<string, ClipProvider>; quotas?: Record<string, QuotaDef>; automaticOnly?: boolean } = {}
): Promise<ClipResult & { attempts: Attempt[] }> {
  const order = opts.order ?? (await getSetting("provider_order"));
  const registry = opts.providers ?? CLIP_PROVIDERS;
  const quotas = opts.quotas ?? (await getSetting("quotas"));
  const attempts: Attempt[] = [];

  for (const id of order) {
    const p = registry[id];
    if (!p) continue;
    // One-click runs must never sit waiting for a person: skip providers that need manual clicking (job packs).
    if (opts.automaticOnly && p.kind === "browser" && !(p.automatic?.() ?? false)) {
      attempts.push({ provider: id, outcome: "skipped", detail: "needs a person to make the clip (manual job pack); not used for one-click runs" });
      continue;
    }
    const st = p.status();
    if (!st.ok) {
      attempts.push({ provider: id, outcome: "skipped", detail: st.reason });
      continue;
    }
    const units = p.cost(req);
    const q = await canSpend(id, units, quotas);
    if (!q.ok) {
      attempts.push({ provider: id, outcome: "skipped", detail: `daily quota: ${q.used}/${q.quota} used, this clip needs ${units}` });
      continue;
    }
    try {
      const result = await p.generateClip(req);
      await recordSpend(id, units, quotas[id]?.unit === "usd" ? units : 0, quotas);
      attempts.push({ provider: id, outcome: "ok" });
      return { ...result, attempts };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logger.warn("clip provider failed, trying next", { provider: id, clip: req.clipId, error: detail });
      attempts.push({ provider: id, outcome: "failed", detail });
    }
  }
  throw new Error("No clip provider could generate this clip: " + attempts.map((a) => `${a.provider} ${a.outcome}${a.detail ? " (" + a.detail + ")" : ""}`).join("; "));
}
