import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler";
import { query } from "../db";
import { AppError } from "../errors";
import { intParam, jsonOr, parseBody } from "./util";

export const topicsRouter = Router();

const TopicInput = z.object({
  channelId: z.number().int().positive(),
  title: z.string().min(3).max(255),
  angle: z.string().max(2000).optional(),
  source: z.enum(["claude_research", "analytics", "manual", "trend"]).default("manual"),
  researchNotes: z.string().max(20000).optional(),
  sources: z.array(z.object({ url: z.string().max(1024), claim: z.string().max(500).optional() })).default([]),
  score: z.number().min(0).max(100).optional(),
});

const present = (r: any) => ({
  id: r.id,
  channelId: r.channel_id,
  title: r.title,
  angle: r.angle,
  source: r.source,
  researchNotes: r.research_notes,
  sources: jsonOr(r.sources_json, []),
  score: r.score == null ? null : Number(r.score),
  status: r.status,
  rejectReason: r.reject_reason,
  createdAt: r.created_at,
});

topicsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const where: string[] = [];
    const args: any[] = [];
    if (req.query.channelId) {
      where.push("channel_id = ?");
      args.push(intParam(req.query.channelId, "channelId"));
    }
    if (req.query.status) {
      where.push("status = ?");
      args.push(String(req.query.status));
    }
    const rows = await query<any[]>(`SELECT * FROM topics ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY (score IS NULL), score DESC, id DESC LIMIT 500`, args);
    res.json(rows.map(present));
  })
);

topicsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const b = parseBody(TopicInput, req.body);
    const [ch] = await query<any[]>("SELECT id FROM channels WHERE id = ?", [b.channelId]);
    if (!ch) throw new AppError("channel not found", 404);
    const r = await query<any>(
      "INSERT INTO topics (channel_id, title, angle, source, research_notes, sources_json, score) VALUES (?,?,?,?,?,?,?)",
      [b.channelId, b.title, b.angle ?? null, b.source, b.researchNotes ?? null, JSON.stringify(b.sources), b.score ?? null]
    );
    const [row] = await query<any[]>("SELECT * FROM topics WHERE id = ?", [r.insertId]);
    res.status(201).json(present(row));
  })
);

topicsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id);
    const [row] = await query<any[]>("SELECT * FROM topics WHERE id = ?", [id]);
    if (!row) throw new AppError("topic not found", 404);
    const cur = present(row);
    const b = parseBody(TopicInput, { ...cur, ...(req.body || {}), channelId: cur.channelId });
    await query("UPDATE topics SET title=?, angle=?, source=?, research_notes=?, sources_json=?, score=? WHERE id=?", [b.title, b.angle ?? null, b.source, b.researchNotes ?? null, JSON.stringify(b.sources), b.score ?? null, id]);
    const [out] = await query<any[]>("SELECT * FROM topics WHERE id = ?", [id]);
    res.json(present(out));
  })
);

async function transition(id: number, from: string[], to: string, reason?: string) {
  const [row] = await query<any[]>("SELECT status FROM topics WHERE id = ?", [id]);
  if (!row) throw new AppError("topic not found", 404);
  if (!from.includes(row.status)) throw new AppError(`topic is '${row.status}'; it can only move to '${to}' from: ${from.join(", ")}`, 409);
  await query("UPDATE topics SET status = ?, reject_reason = ? WHERE id = ?", [to, reason ?? null, id]);
  const [out] = await query<any[]>("SELECT * FROM topics WHERE id = ?", [id]);
  return present(out);
}

topicsRouter.post("/:id/approve", asyncHandler(async (req, res) => res.json(await transition(intParam(req.params.id), ["idea", "rejected"], "approved"))));

topicsRouter.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 1000) : "";
    if (!reason.trim()) throw new AppError("a reason is required", 400);
    res.json(await transition(intParam(req.params.id), ["idea", "approved"], "rejected", reason));
  })
);

topicsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const r = await query<any>("DELETE FROM topics WHERE id = ?", [intParam(req.params.id)]);
    if (!r.affectedRows) throw new AppError("topic not found", 404);
    res.json({ ok: true });
  })
);
