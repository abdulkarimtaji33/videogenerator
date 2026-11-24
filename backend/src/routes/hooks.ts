import { Router } from "express";
import { asyncHandler } from "../asyncHandler";
import { AppError } from "../errors";
import { HOOK_TEMPLATES, HOOK_TYPES, HookFormat } from "../hooks/library";
import { lintHook } from "../hooks/lint";
import { generateHooks, rankHooks, recentHookTypes, recordHookUse } from "../hooks/engine";

export const hooksRouter = Router();

const fmt = (v: unknown): HookFormat => (v === "long" ? "long" : "short");

/** The hook types and the 24 fill-in templates from the research. */
hooksRouter.get("/library", (_req, res) => {
  res.json({ types: HOOK_TYPES, templates: HOOK_TEMPLATES, recentTypes: recentHookTypes(5) });
});

/** Scores one hook line against the rules and explains every failure. */
hooksRouter.post(
  "/lint",
  asyncHandler(async (req, res) => {
    const { line, visual, format, title, type } = req.body || {};
    if (typeof line !== "string" || !line.trim()) throw new AppError("line is required", 400);
    res.json(lintHook({ line, visual, format: fmt(format), title, type, recentTypes: recentHookTypes() }));
  })
);

/** Ranks candidate hooks supplied by the caller (for example written by Claude). */
hooksRouter.post(
  "/rank",
  asyncHandler(async (req, res) => {
    const { candidates, format, title } = req.body || {};
    if (!Array.isArray(candidates) || candidates.length === 0) throw new AppError("candidates[] is required", 400);
    res.json({ ranked: rankHooks(candidates, { format: fmt(format), title }) });
  })
);

/** Generates, checks and (if needed) rewrites hooks for a topic using the LLM. */
hooksRouter.post(
  "/generate",
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (typeof b.topic !== "string" || !b.topic.trim()) throw new AppError("topic is required", 400);
    res.json(await generateHooks({ ...b, format: fmt(b.format) }));
  })
);

/** Records that a hook type was used so the next video rotates. */
hooksRouter.post(
  "/use",
  asyncHandler(async (req, res) => {
    const { type, line } = req.body || {};
    if (!HOOK_TYPES[type as keyof typeof HOOK_TYPES] || typeof line !== "string") throw new AppError("valid type and line required", 400);
    recordHookUse(type, line);
    res.json({ ok: true, recentTypes: recentHookTypes(5) });
  })
);
