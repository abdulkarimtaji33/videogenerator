// Global, non-secret settings stored in the settings table (provider order, pacing, quota overrides...).
import { query } from "./db";
import { DEFAULT_QUOTAS, QuotaDef } from "./providers/quota";

export interface AppSettings {
  provider_order: string[];
  pacing_seconds: number;
  concurrency: number;
  budget_usd_per_day: number;
  quotas: Record<string, QuotaDef>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  provider_order: ["google-flow", "veoframe", "higgsfield", "fal"],
  pacing_seconds: 8,
  concurrency: 2,
  budget_usd_per_day: 5,
  quotas: DEFAULT_QUOTAS,
};

export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const [row] = await query<any[]>("SELECT value FROM settings WHERE `key` = ?", [key]);
  if (!row || row.value == null) return DEFAULT_SETTINGS[key];
  try {
    return JSON.parse(row.value);
  } catch {
    return DEFAULT_SETTINGS[key];
  }
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
  if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unknown setting '${key}'`);
  await query("INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, JSON.stringify(value)]);
}

export async function getAllSettings(): Promise<AppSettings> {
  const entries = await Promise.all((Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]).map(async (k) => [k, await getSetting(k)] as const));
  return Object.fromEntries(entries) as unknown as AppSettings;
}
