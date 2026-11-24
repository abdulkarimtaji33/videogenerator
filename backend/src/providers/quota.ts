// Daily quota guard backed by the provider_usage table. It stops the pipeline from queueing work a provider
// cannot do today (for example more Google Flow credits than the free tier allows).
import { query } from "../db";

export interface QuotaDef {
  unit: "credits" | "clips" | "usd";
  perDay: number;
}

/** Defaults; override in the settings table under 'quotas'. Flow figures are from Flow's own pricing guide (free tier: 50 credits/day). */
export const DEFAULT_QUOTAS: Record<string, QuotaDef> = {
  "google-flow": { unit: "credits", perDay: 50 },
  // Veoframe's own Overview page (read 2026-11-21): Weekly Pro = 150 HD video generations and 200 images a day,
  // up to 10 renders at once, resetting at midnight. (Its landing page says 120 + 30; the account page is used.)
  veoframe: { unit: "clips", perDay: 150 },
  higgsfield: { unit: "clips", perDay: 20 },
  fal: { unit: "usd", perDay: 5 },
};

/** Credits per 8-second Veo 3.1 clip in Flow (Flow pricing guide, read 2026-11-21). */
export function flowCredits(model: string): number {
  const m = model.toLowerCase();
  if (m.includes("quality")) return 100;
  if (m.includes("fast")) return 20;
  if (m.includes("lite")) return 10;
  return 20;
}

export async function usedToday(provider: string): Promise<number> {
  const [row] = await query<any[]>("SELECT units FROM provider_usage WHERE provider = ? AND usage_date = CURDATE()", [provider]);
  return row ? Number(row.units) : 0;
}

export interface QuotaCheck {
  ok: boolean;
  used: number;
  quota: number | null;
  remaining: number | null;
}

export async function canSpend(provider: string, units: number, defs: Record<string, QuotaDef> = DEFAULT_QUOTAS): Promise<QuotaCheck> {
  const used = await usedToday(provider);
  const def = defs[provider];
  if (!def) return { ok: true, used, quota: null, remaining: null };
  const remaining = def.perDay - used;
  return { ok: units <= remaining, used, quota: def.perDay, remaining };
}

export async function recordSpend(provider: string, units: number, costUsd = 0, defs: Record<string, QuotaDef> = DEFAULT_QUOTAS): Promise<void> {
  await query(
    `INSERT INTO provider_usage (provider, usage_date, units, quota, cost_usd) VALUES (?, CURDATE(), ?, ?, ?)
     ON DUPLICATE KEY UPDATE units = units + VALUES(units), cost_usd = cost_usd + VALUES(cost_usd)`,
    [provider, units, defs[provider]?.perDay ?? null, costUsd]
  );
}

export async function usageSummary(defs: Record<string, QuotaDef> = DEFAULT_QUOTAS) {
  const out: Record<string, QuotaCheck & { unit: string | null }> = {};
  for (const id of new Set([...Object.keys(defs)])) {
    const c = await canSpend(id, 0, defs);
    out[id] = { ...c, unit: defs[id]?.unit ?? null };
  }
  return out;
}
