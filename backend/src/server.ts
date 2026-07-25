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

async function main() {
  validateEnv();

  const app = express();
  const PORT = Number(process.env.PORT || 4000);

  // No auth/cookies/session anywhere in this API — reflecting any origin back is harmless here
  // and permanently removes CORS as a source of "can't reach the backend" errors, from any origin/port.
  app.use(cors({ origin: true }));
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
