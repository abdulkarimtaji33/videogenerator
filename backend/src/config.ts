// Typed, validated configuration. Secrets only ever come from the environment (backend/.env), never the DB.
import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().default(4501),
  MYSQL_HOST: z.string().default("127.0.0.1"),
  MYSQL_PORT: z.coerce.number().default(3306),
  MYSQL_USER: z.string().default("root"),
  MYSQL_PASSWORD: z.string().default(""),
  MYSQL_DATABASE: z.string().default("videogenerator"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TEXT_MODEL: z.string().default("gpt-4.1"),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-2"),
  HIGGSFIELD_API_KEY: z.string().optional(),
  FAL_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  FLOW_MODEL: z.string().default("Veo 3.1 - Lite"),
  VEOFRAME_ENABLED: z.string().default("false"),
  VEOFRAME_PROFILE_DIR: z.string().optional(),
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_REDIRECT_URI: z.string().default("http://localhost:4501/api/youtube/callback"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  NOTIFY_TO: z.string().optional(),
  JOB_CONCURRENCY: z.coerce.number().min(1).max(8).default(2),
  JOB_POLL_MS: z.coerce.number().min(200).default(2000),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = Env.safeParse(env);
  if (!r.success) {
    throw new Error("Invalid configuration: " + r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return r.data;
}

/** Which optional integrations are configured. Values are never exposed, only whether they are set. */
export function integrationStatus(env: NodeJS.ProcessEnv = process.env) {
  const c = loadConfig(env);
  return {
    openai: !!c.OPENAI_API_KEY,
    higgsfield: !!c.HIGGSFIELD_API_KEY,
    fal: !!c.FAL_KEY,
    gemini: !!c.GEMINI_API_KEY,
    veoframe: c.VEOFRAME_ENABLED === "true",
    youtube: !!(c.YOUTUBE_CLIENT_ID && c.YOUTUBE_CLIENT_SECRET),
    email: !!(c.SMTP_HOST && c.SMTP_USER && c.SMTP_PASSWORD && c.NOTIFY_TO),
  };
}
