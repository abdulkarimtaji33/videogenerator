// Job handlers. Importing this file registers them. The original fire-and-forget pipeline calls now run
// through the queue, so they survive a restart (an interrupted pipeline restarts cleanly from scratch).
import { query } from "../db";
import { runPipeline, runShotDuration, runShotImage, runShotVideo } from "../pipeline";
import { FatalJobError, registerHandler } from "./worker";

registerHandler("project.pipeline", async ({ projectId }) => {
  await query("UPDATE projects SET status = 'pending', error_message = NULL WHERE id = ?", [projectId]);
  // Projects made with a niche (all new ones) use the niche-aware pipeline; older ones keep the character flow.
  const [kind] = await query<any[]>("SELECT niche FROM projects WHERE id = ?", [projectId]);
  if (kind?.niche) {
    // No shot cleanup here: runNichePipeline clears shots and anchors itself unless it can resume an interrupted
    // run, in which case the finished shot images must survive.
    const { runNichePipeline } = await import("../nichePipeline");
    await runNichePipeline(projectId);
    const [done] = await query<any[]>("SELECT status, error_message FROM projects WHERE id = ?", [projectId]);
    // A failed plan (blocked idea, too few verified facts, bad JSON twice) would fail the same way again: do not retry.
    if (done?.status === "error") throw new FatalJobError(done.error_message || "pipeline failed");
    return { projectId, status: done?.status };
  }
  // An earlier interrupted attempt may have left shots behind; start clean so the unique key is not violated.
  await query("DELETE FROM shots WHERE project_id = ?", [projectId]);
  await runPipeline(projectId);
  const [p] = await query<any[]>("SELECT status, error_message FROM projects WHERE id = ?", [projectId]);
  if (p?.status === "error") throw new Error(p.error_message || "pipeline failed");
  return { projectId, status: p?.status };
});

registerHandler("short.run", async ({ projectId }) => {
  const { runShortProject } = await import("../shorts/run");
  const { notifyAwaitingApproval } = await import("../notify/email");
  const { enqueue } = await import("./queue");
  return runShortProject(projectId, {
    onAwaitingApproval: async (id, plan) => {
      await notifyAwaitingApproval(id, plan);
    },
    onAutoPublish: async (id) => {
      await enqueue("publish.upload", { projectId: id }, { dedupeKey: `publish:${id}` });
    },
  });
});

registerHandler("publish.upload", async ({ projectId, privacy, publishAt }) => {
  const { publishProject } = await import("../youtube/publish");
  return publishProject(projectId, { privacy, publishAt });
});

registerHandler("shot.image", async ({ projectId, shotId }) => {
  await runShotImage(projectId, shotId);
});

registerHandler("shot.video", async ({ projectId, shotId }) => {
  await runShotVideo(projectId, shotId);
});

registerHandler("project.video", async ({ projectId }) => {
  // One click: every missing clip through the providers (Veoframe first), then narration, captions and QA.
  const { runProjectVideo } = await import("../projectVideo");
  return runProjectVideo(projectId);
});

registerHandler("shot.duration", async ({ projectId, shotId, durationSeconds }) => {
  await runShotDuration(projectId, shotId, durationSeconds);
});
