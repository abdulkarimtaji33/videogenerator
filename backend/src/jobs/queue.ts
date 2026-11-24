// Persistent job queue on MySQL/MariaDB. Claiming is a single atomic UPDATE (works on MariaDB 10.4, which has
// no SKIP LOCKED), so several workers never take the same job. Jobs survive restarts: on boot, anything left
// 'running' by a dead process is put back in the queue.
import crypto from "crypto";
import { query } from "../db";

export type JobStatus = "queued" | "running" | "done" | "failed" | "dead";

export interface Job {
  id: number;
  type: string;
  payload: any;
  dedupe_key: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_by: string | null;
  locked_at: string | null;
  last_error: string | null;
  result: any;
  created_at: string;
  updated_at: string;
}

const parse = (raw: any) => {
  if (raw == null || raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

function hydrate(row: any): Job {
  return { ...row, payload: parse(row.payload), result: parse(row.result) };
}

export interface EnqueueOptions {
  delaySeconds?: number;
  maxAttempts?: number;
  /** A second enqueue with the same key returns the existing job instead of creating a duplicate. */
  dedupeKey?: string;
}

export async function enqueue(type: string, payload: unknown = {}, opts: EnqueueOptions = {}): Promise<number> {
  const r = await query<any>(
    `INSERT INTO jobs (type, payload, dedupe_key, max_attempts, run_after)
     VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [type, JSON.stringify(payload), opts.dedupeKey ?? null, opts.maxAttempts ?? 3, opts.delaySeconds ?? 0]
  );
  return Number(r.insertId);
}

export async function claim(workerId: string, types?: string[]): Promise<Job | null> {
  const token = `${workerId}:${crypto.randomBytes(4).toString("hex")}`;
  const typeSql = types && types.length ? ` AND type IN (${types.map(() => "?").join(",")})` : "";
  const r = await query<any>(
    `UPDATE jobs SET status = 'running', locked_by = ?, locked_at = NOW(), attempts = attempts + 1
     WHERE status = 'queued' AND run_after <= NOW()${typeSql} ORDER BY id LIMIT 1`,
    [token, ...(types ?? [])]
  );
  if (!r.affectedRows) return null;
  const [row] = await query<any[]>("SELECT * FROM jobs WHERE locked_by = ? AND status = 'running'", [token]);
  return row ? hydrate(row) : null;
}

export async function complete(id: number, result: unknown = null): Promise<void> {
  await query("UPDATE jobs SET status = 'done', result = ?, locked_by = NULL, last_error = NULL WHERE id = ?", [
    JSON.stringify(result ?? null),
    id,
  ]);
}

/** Records a failure. Retries with backoff until max_attempts, then marks the job dead. */
export async function fail(id: number, error: string, opts: { retry?: boolean; backoffSeconds?: number } = {}): Promise<JobStatus> {
  const [row] = await query<any[]>("SELECT attempts, max_attempts FROM jobs WHERE id = ?", [id]);
  if (!row) return "dead";
  const retry = opts.retry !== false && row.attempts < row.max_attempts;
  if (retry) {
    await query(
      "UPDATE jobs SET status = 'queued', locked_by = NULL, last_error = ?, run_after = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id = ?",
      [error.slice(0, 2000), opts.backoffSeconds ?? 5, id]
    );
    return "queued";
  }
  const status: JobStatus = opts.retry === false ? "failed" : "dead";
  await query("UPDATE jobs SET status = ?, locked_by = NULL, last_error = ? WHERE id = ?", [status, error.slice(0, 2000), id]);
  return status;
}

/** Puts jobs that a dead process left 'running' back in the queue (call on boot with 0). */
export async function recoverStale(olderThanSeconds = 0): Promise<number> {
  const r = await query<any>(
    "UPDATE jobs SET status = 'queued', locked_by = NULL, last_error = 'recovered after restart' WHERE status = 'running' AND locked_at <= DATE_SUB(NOW(), INTERVAL ? SECOND)",
    [olderThanSeconds]
  );
  return Number(r.affectedRows || 0);
}

export async function getJob(id: number): Promise<Job | null> {
  const [row] = await query<any[]>("SELECT * FROM jobs WHERE id = ?", [id]);
  return row ? hydrate(row) : null;
}

export async function listJobs(limit = 50): Promise<Job[]> {
  const rows = await query<any[]>("SELECT * FROM jobs ORDER BY id DESC LIMIT " + Math.max(1, Math.min(500, Math.trunc(limit))));
  return rows.map(hydrate);
}

export async function jobStats(): Promise<Record<JobStatus, number>> {
  const rows = await query<any[]>("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status");
  const out: Record<JobStatus, number> = { queued: 0, running: 0, done: 0, failed: 0, dead: 0 };
  for (const r of rows) out[r.status as JobStatus] = Number(r.n);
  return out;
}
