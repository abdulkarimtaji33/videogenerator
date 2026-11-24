import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "module";
import { query } from "../src/db";
import { claim, complete, enqueue, fail, getJob, jobStats, recoverStale } from "../src/jobs/queue";
import { FatalJobError, registerHandler, runOnce } from "../src/jobs/worker";

const require = createRequire(import.meta.url);

beforeAll(async () => {
  const { migrate } = require("../scripts/migrate.js");
  await migrate({ database: "videogenerator_test" });
});

beforeEach(async () => {
  await query("DELETE FROM jobs");
});

describe("job queue", () => {
  it("enqueues, claims and completes a job", async () => {
    const id = await enqueue("test.echo", { a: 1 });
    const job = await claim("t");
    expect(job?.id).toBe(id);
    expect(job?.payload).toEqual({ a: 1 });
    expect(job?.attempts).toBe(1);
    await complete(id, { ok: true });
    const done = await getJob(id);
    expect(done?.status).toBe("done");
    expect(done?.result).toEqual({ ok: true });
  });

  it("never lets two workers claim the same job", async () => {
    for (let i = 0; i < 3; i++) await enqueue("test.race", { i });
    const claimed = await Promise.all(Array.from({ length: 8 }, (_, i) => claim(`w${i}`)));
    const ids = claimed.filter(Boolean).map((j) => j!.id);
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("does not claim a delayed job early", async () => {
    await enqueue("test.later", {}, { delaySeconds: 60 });
    expect(await claim("t")).toBeNull();
  });

  it("retries with backoff and then marks the job dead", async () => {
    const id = await enqueue("test.flaky", {}, { maxAttempts: 2 });
    await claim("t");
    expect(await fail(id, "boom", { backoffSeconds: 0 })).toBe("queued");
    await claim("t");
    expect(await fail(id, "boom again", { backoffSeconds: 0 })).toBe("dead");
    const j = await getJob(id);
    expect(j?.status).toBe("dead");
    expect(j?.last_error).toContain("boom again");
  });

  it("marks a non-retryable failure as failed straight away", async () => {
    const id = await enqueue("test.fatal", {}, { maxAttempts: 5 });
    await claim("t");
    expect(await fail(id, "bad input", { retry: false })).toBe("failed");
  });

  it("puts jobs left running by a dead process back in the queue", async () => {
    const id = await enqueue("test.crash", {});
    await claim("t");
    expect((await getJob(id))?.status).toBe("running");
    expect(await recoverStale(0)).toBe(1);
    expect((await getJob(id))?.status).toBe("queued");
    expect((await claim("t2"))?.id).toBe(id);
  });

  it("returns the existing job for a repeated dedupe key", async () => {
    const a = await enqueue("test.once", {}, { dedupeKey: "same" });
    const b = await enqueue("test.once", {}, { dedupeKey: "same" });
    expect(b).toBe(a);
    const s = await jobStats();
    expect(s.queued).toBe(1);
  });
});

describe("worker", () => {
  it("runs the registered handler and stores the result", async () => {
    registerHandler("test.double", async (p: { n: number }) => ({ n: p.n * 2 }));
    const id = await enqueue("test.double", { n: 21 });
    expect(await runOnce("t")).toBe(true);
    const j = await getJob(id);
    expect(j?.status).toBe("done");
    expect(j?.result).toEqual({ n: 42 });
  });

  it("requeues a throwing handler and fails fatal errors immediately", async () => {
    registerHandler("test.throws", async () => {
      throw new Error("transient");
    });
    registerHandler("test.fatal2", async () => {
      throw new FatalJobError("do not retry");
    });
    const a = await enqueue("test.throws", {});
    const b = await enqueue("test.fatal2", {});
    await runOnce("t");
    await runOnce("t");
    expect((await getJob(a))?.status).toBe("queued");
    expect((await getJob(b))?.status).toBe("failed");
  });

  it("returns false when there is nothing to do", async () => {
    expect(await runOnce("t")).toBe(false);
  });
});
