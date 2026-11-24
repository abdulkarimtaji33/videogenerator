import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler";
import { query } from "../db";
import { AppError } from "../errors";
import { intParam, jsonOr, parseBody, validTimeZone } from "./util";

export const channelsRouter = Router();

const StyleGuide = z.object({
  tone: z.string().max(500).optional(),
  visual_prefix: z.string().max(1000).optional(),
  palette: z.string().max(300).optional(),
  banned_topics: z.array(z.string().max(80)).default([]),
});

const ChannelInput = z.object({
  name: z.string().min(2).max(150),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(80).optional(),
  language: z.enum(["en", "ur", "hi"]).default("en"),
  niche: z.string().max(190).optional(),
  styleGuide: StyleGuide.default(() => StyleGuide.parse({})),
  defaultAudioMode: z.enum(["narrated", "native", "mixed"]).default("narrated"),
  publishMode: z.enum(["review", "auto"]).default("review"),
  dailyCapLong: z.number().int().min(0).max(20).default(1),
  dailyCapShorts: z.number().int().min(0).max(50).default(3),
  publishSlots: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).default(["09:00"]),
  timezone: z.string().default("UTC").refine(validTimeZone, "unknown time zone"),
  status: z.enum(["active", "paused"]).default("active"),
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "channel";

function present(r: any) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    youtubeChannelId: r.youtube_channel_id,
    language: r.language,
    niche: r.niche,
    styleGuide: jsonOr(r.style_guide, {}),
    defaultAudioMode: r.default_audio_mode,
    publishMode: r.publish_mode,
    dailyCapLong: r.daily_cap_long,
    dailyCapShorts: r.daily_cap_shorts,
    publishSlots: jsonOr(r.publish_slots, ["09:00"]),
    timezone: r.timezone,
    status: r.status,
    createdAt: r.created_at,
  };
}

channelsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json((await query<any[]>("SELECT * FROM channels ORDER BY id")).map(present));
  })
);

channelsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const b = parseBody(ChannelInput, req.body);
    const slug = b.slug || slugify(b.name);
    const [dup] = await query<any[]>("SELECT id FROM channels WHERE slug = ?", [slug]);
    if (dup) throw new AppError(`a channel with slug '${slug}' already exists`, 409);
    const r = await query<any>(
      `INSERT INTO channels (name, slug, language, niche, style_guide, default_audio_mode, publish_mode, daily_cap_long, daily_cap_shorts, publish_slots, timezone, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.name, slug, b.language, b.niche ?? null, JSON.stringify(b.styleGuide), b.defaultAudioMode, b.publishMode, b.dailyCapLong, b.dailyCapShorts, JSON.stringify(b.publishSlots), b.timezone, b.status]
    );
    const [row] = await query<any[]>("SELECT * FROM channels WHERE id = ?", [r.insertId]);
    res.status(201).json(present(row));
  })
);

channelsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [row] = await query<any[]>("SELECT * FROM channels WHERE id = ?", [intParam(req.params.id)]);
    if (!row) throw new AppError("channel not found", 404);
    res.json(present(row));
  })
);

channelsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = intParam(req.params.id);
    const [row] = await query<any[]>("SELECT * FROM channels WHERE id = ?", [id]);
    if (!row) throw new AppError("channel not found", 404);
    const merged = { ...present(row), ...(req.body || {}) };
    const b = parseBody(ChannelInput, merged);
    await query(
      `UPDATE channels SET name=?, language=?, niche=?, style_guide=?, default_audio_mode=?, publish_mode=?, daily_cap_long=?, daily_cap_shorts=?, publish_slots=?, timezone=?, status=? WHERE id=?`,
      [b.name, b.language, b.niche ?? null, JSON.stringify(b.styleGuide), b.defaultAudioMode, b.publishMode, b.dailyCapLong, b.dailyCapShorts, JSON.stringify(b.publishSlots), b.timezone, b.status, id]
    );
    const [out] = await query<any[]>("SELECT * FROM channels WHERE id = ?", [id]);
    res.json(present(out));
  })
);
