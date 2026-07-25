// Applies db/schema.sql against MySQL using the same env vars as the app.
// Run with: npm run db:init
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

async function main() {
  const schemaPath = path.join(__dirname, "..", "db", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    multipleStatements: true,
  });

  await connection.query(sql);

  // schema.sql uses CREATE TABLE IF NOT EXISTS, which won't alter a table that
  // already existed before these columns were added. Add them here if missing.
  await connection.query(`
    SET @dbname = DATABASE();
    SET @exists_video_path = (
      SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'shots' AND COLUMN_NAME = 'video_path'
    );
    SET @sql = IF(@exists_video_path = 0,
      'ALTER TABLE shots ADD COLUMN video_path VARCHAR(512) AFTER video_prompt',
      'SELECT 1');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;

    SET @exists_video_status = (
      SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'shots' AND COLUMN_NAME = 'status'
        AND COLUMN_TYPE LIKE '%''video''%'
    );
    SET @sql = IF(@exists_video_status = 0,
      "ALTER TABLE shots MODIFY COLUMN status ENUM('pending', 'image_prompt', 'image', 'video_prompt', 'video', 'done', 'error') NOT NULL DEFAULT 'pending'",
      'SELECT 1');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;

    SET @exists_duration_seconds = (
      SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'shots' AND COLUMN_NAME = 'duration_seconds'
    );
    SET @sql = IF(@exists_duration_seconds = 0,
      'ALTER TABLE shots ADD COLUMN duration_seconds INT NOT NULL DEFAULT 8 AFTER duration',
      'SELECT 1');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  `);

  await connection.end();
  console.log("Database schema applied successfully.");
}

main().catch((err) => {
  console.error("Failed to initialize database:", err);
  process.exit(1);
});
