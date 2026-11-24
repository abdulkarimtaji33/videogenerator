import "dotenv/config";
import path from "path";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { getPool } from "./db";
import "./jobs/handlers";
import { startWorker } from "./jobs/worker";
import { logger } from "./log";

// OPENAI_API_KEY is optional now: Ollama writes the text by default (OpenAI is the standby and the optional image/speech model).
const REQUIRED_ENV_VARS = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_DATABASE"];

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
    console.error("Could not connect to MySQL on startup. Check MYSQL_* in backend/.env.");
    console.error(err);
  }
}

async function main() {
  validateEnv();
  const cfg = loadConfig();

  // Apply any pending migrations, then start the persistent job worker (it also resumes interrupted jobs).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { migrate } = require(path.join(process.cwd(), "scripts", "migrate.js"));
    const m = await migrate();
    if (m.applied.length) logger.info("migrations applied", { applied: m.applied });
  } catch (err) {
    logger.error("migration failed", { error: err instanceof Error ? err.message : String(err) });
  }
  await verifyDatabaseConnection();
  const worker = await startWorker({ concurrency: cfg.JOB_CONCURRENCY, pollMs: cfg.JOB_POLL_MS });

  const app = createApp();
  const server = app.listen(cfg.PORT, () => {
    console.log(`Backend listening on http://localhost:${cfg.PORT}`);
  });

  const shutdown = async () => {
    logger.info("shutting down");
    server.close();
    await worker.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
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
