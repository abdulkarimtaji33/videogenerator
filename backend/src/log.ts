// Structured JSON-lines logging with secret masking.
import fs from "fs";
import path from "path";

const SECRET_KEY = /(key|token|secret|password|authorization|cookie)/i;
const SECRET_VALUE = /(sk-[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z_-]+|Bearer\s+[A-Za-z0-9._-]{10,})/g;

export function mask(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[masked]");
  if (typeof value !== "object" || depth > 5) return value;
  if (Array.isArray(value)) return value.map((v) => mask(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? "[masked]" : mask(v, depth + 1);
  }
  return out;
}

export type Level = "debug" | "info" | "warn" | "error";
const LOG_DIR = path.join(process.cwd(), "storage", "logs");

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg: mask(msg), ...(mask(fields) as object) });
  (level === "error" ? console.error : console.log)(line);
  if (process.env.NODE_ENV !== "test") {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      const jobId = fields.jobId;
      fs.appendFileSync(path.join(LOG_DIR, jobId ? `job-${jobId}.log` : "app.log"), line + "\n");
    } catch {
      /* logging must never throw */
    }
  }
}

export const logger = {
  debug: (m: string, f?: Record<string, unknown>) => log("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => log("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => log("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => log("error", m, f),
};
