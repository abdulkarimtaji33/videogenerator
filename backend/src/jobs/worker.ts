import { logger } from "../log";
import { Job, claim, complete, fail, recoverStale } from "./queue";

export class FatalJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalJobError";
  }
}

export type Handler = (payload: any, job: Job) => Promise<unknown>;
const handlers = new Map<string, Handler>();

export function registerHandler(type: string, fn: Handler) {
  handlers.set(type, fn);
}

export function registeredTypes(): string[] {
  return [...handlers.keys()];
}

/** Claims and runs one job. Returns true if a job was run. */
export async function runOnce(workerId = "worker"): Promise<boolean> {
  const job = await claim(workerId, registeredTypes());
  if (!job) return false;
  const handler = handlers.get(job.type);
  const started = Date.now();
  logger.info("job started", { jobId: job.id, type: job.type, attempt: job.attempts });
  try {
    if (!handler) throw new FatalJobError(`No handler registered for job type '${job.type}'`);
    const result = await handler(job.payload, job);
    await complete(job.id, result);
    logger.info("job done", { jobId: job.id, type: job.type, ms: Date.now() - started });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const fatal = err instanceof FatalJobError;
    const backoff = Math.min(300, 5 * 2 ** Math.max(0, job.attempts - 1));
    const status = await fail(job.id, message, { retry: fatal ? false : undefined, backoffSeconds: backoff });
    logger.error("job failed", { jobId: job.id, type: job.type, status, error: message });
  }
  return true;
}

export interface WorkerHandle {
  stop(): Promise<void>;
}

export async function startWorker(opts: { concurrency?: number; pollMs?: number } = {}): Promise<WorkerHandle> {
  const concurrency = opts.concurrency ?? 2;
  const pollMs = opts.pollMs ?? 2000;
  const recovered = await recoverStale(0);
  if (recovered) logger.warn("recovered jobs left running by a previous process", { recovered });
  let stopping = false;
  const loops: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    loops.push(
      (async () => {
        while (!stopping) {
          let ran = false;
          try {
            ran = await runOnce(`w${i}`);
          } catch (err) {
            logger.error("worker loop error", { error: err instanceof Error ? err.message : String(err) });
          }
          if (!ran) await new Promise((r) => setTimeout(r, pollMs));
        }
      })()
    );
  }
  logger.info("job worker started", { concurrency, pollMs, types: registeredTypes() });
  return {
    async stop() {
      stopping = true;
      await Promise.all(loops);
    },
  };
}
