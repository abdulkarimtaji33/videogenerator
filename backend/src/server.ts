import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { projectsRouter } from "./routes/projects";
import { imagesRouter } from "./routes/images";
import { AppError } from "./errors";
import { getPool } from "./db";

const REQUIRED_ENV_VARS = ["OPENAI_API_KEY", "MYSQL_HOST", "MYSQL_USER", "MYSQL_DATABASE"];

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.warn(
      `Warning: missing required env vars: ${missing.join(", ")}. ` +
        "The server will start, but requests that need them will fail until backend/.env is filled in."
    );
  }
}

async function verifyDatabaseConnection() {
  try {
    await getPool().query("SELECT 1");
    console.log("Database connection OK.");
  } catch (err) {
    console.error(
      "Could not connect to MySQL on startup. Check MYSQL_HOST/PORT/USER/PASSWORD/DATABASE in backend/.env " +
        "and that the schema has been applied with `npm run db:init`."
    );
    console.error(err);
  }
}

/**
 * Builds the CORS origin check. FRONTEND_ORIGIN can be a comma-separated list, so one backend
 * can serve a fixed set of known origins (e.g. the deployed domain plus its www variant).
 *
 * In non-production, ALSO accept any http://localhost:<port> / http://127.0.0.1:<port> origin —
 * Next's dev server auto-picks a free port when its default is taken, so pinning dev to one exact
 * port here would just move this bug rather than fix it. Production stays strict: only the
 * explicitly configured origin(s) are ever allowed.
 */
function buildCorsOriginCheck(): (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void {
  const configured = (process.env.FRONTEND_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const allowAnyLocalhostPort = process.env.NODE_ENV !== "production";
  const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

  return (origin, callback) => {
    if (!origin || configured.includes(origin) || (allowAnyLocalhostPort && localhostPattern.test(origin))) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    }
  };
}

async function main() {
  validateEnv();

  const app = express();
  const PORT = Number(process.env.PORT || 4000);

  app.use(cors({ origin: buildCorsOriginCheck() }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/projects", projectsRouter);
  app.use("/api/images", imagesRouter);

  // 404 for any unmatched route.
  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  // Central error handler. Must be registered last, and must have 4 args for
  // Express to recognize it as an error middleware.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }

    console.error("Unhandled error while processing request:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  });

  await verifyDatabaseConnection();

  app.listen(PORT, () => {
    console.log(`Backend listening on http://localhost:${PORT}`);
  });
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

main().catch((err) => {
  console.error("Fatal error during server startup:", err);
  process.exit(1);
});
