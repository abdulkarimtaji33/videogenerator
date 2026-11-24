// Numbered, idempotent migrations. Replaces the single schema.sql / init-db.js approach.
//   node scripts/migrate.js                      (uses MYSQL_* from backend/.env)
//   node scripts/migrate.js --db videogenerator_test
// Each file in db/migrations exports { name, up(conn, h) }. Applied names are recorded in _migrations.
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const helpers = {
  async columnExists(conn, table, column) {
    const [r] = await conn.query(
      "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
      [table, column]
    );
    return r[0].n > 0;
  },
  async addColumn(conn, table, column, ddl) {
    if (!(await helpers.columnExists(conn, table, column))) {
      await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
    }
  },
  async indexExists(conn, table, index) {
    const [r] = await conn.query(
      "SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
      [table, index]
    );
    return r[0].n > 0;
  },
  async addIndex(conn, table, index, columns) {
    if (!(await helpers.indexExists(conn, table, index))) {
      await conn.query(`ALTER TABLE \`${table}\` ADD INDEX \`${index}\` (${columns})`);
    }
  },
};

async function migrate(opts = {}) {
  const database = opts.database || process.env.MYSQL_DATABASE || "videogenerator";
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    multipleStatements: true,
  });
  const applied = [];
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await conn.query(`USE \`${database}\``);
    await conn.query(
      "CREATE TABLE IF NOT EXISTS _migrations (name VARCHAR(190) PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB"
    );
    const [done] = await conn.query("SELECT name FROM _migrations");
    const have = new Set(done.map((r) => r.name));
    const dir = path.join(__dirname, "..", "db", "migrations");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
    for (const f of files) {
      const m = require(path.join(dir, f));
      if (have.has(m.name)) continue;
      await m.up(conn, helpers);
      await conn.query("INSERT INTO _migrations (name) VALUES (?)", [m.name]);
      applied.push(m.name);
    }
  } finally {
    await conn.end();
  }
  return { database, applied };
}

module.exports = { migrate, helpers };

if (require.main === module) {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  const i = process.argv.indexOf("--db");
  migrate({ database: i >= 0 ? process.argv[i + 1] : undefined })
    .then((r) => console.log(`Database ${r.database}: ${r.applied.length ? "applied " + r.applied.join(", ") : "already up to date"}`))
    .catch((e) => {
      console.error("Migration failed:", e.message);
      process.exit(1);
    });
}
