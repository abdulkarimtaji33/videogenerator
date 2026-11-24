// Niche-aware pipeline (plan: product-improvement plan, section 1.1). Every new column is nullable or has a default,
// so projects made by the old character-only pipeline keep working.
module.exports = {
  name: "005_niche_pipeline",
  async up(conn, h) {
    const P = "projects";
    await h.addColumn(conn, P, "niche", "VARCHAR(48) NULL");
    await h.addColumn(conn, P, "length_seconds", "INT NULL");
    await h.addColumn(conn, P, "review_enabled", "TINYINT NOT NULL DEFAULT 1");
    await h.addColumn(conn, P, "auto_publish", "TINYINT NOT NULL DEFAULT 0");
    await h.addColumn(conn, P, "brief_json", "LONGTEXT NULL");
    await h.addColumn(conn, P, "facts_json", "LONGTEXT NULL");
    await h.addColumn(conn, P, "seo_json", "LONGTEXT NULL");
    await h.addColumn(conn, P, "hook_json", "LONGTEXT NULL");
    await h.addColumn(conn, P, "script_json", "LONGTEXT NULL");
    await h.addColumn(conn, P, "review_json", "LONGTEXT NULL");
    await h.addColumn(conn, P, "cost_estimate_json", "LONGTEXT NULL");
    await h.addColumn(conn, P, "chosen_title", "VARCHAR(255) NULL");
    await h.addColumn(conn, P, "thumbnails_json", "LONGTEXT NULL");
    await h.addColumn(conn, P, "youtube_video_id", "VARCHAR(32) NULL");
    await h.addColumn(conn, P, "publish_status", "VARCHAR(24) NULL");
    // 'plan' stops after the plan is written (no clips are spent); 'full' goes on to the video.
    await h.addColumn(conn, P, "run_mode", "VARCHAR(8) NOT NULL DEFAULT 'full'");

    await conn.query(
      `CREATE TABLE IF NOT EXISTS anchors (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        \`key\` VARCHAR(48) NOT NULL,
        kind VARCHAR(16) NOT NULL,
        name VARCHAR(120) NOT NULL,
        locked_features TEXT NULL,
        image_prompt TEXT NULL,
        image_path VARCHAR(512) NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        error_message TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_anchor (project_id, \`key\`),
        KEY idx_anchor_project (project_id)
      ) ENGINE=InnoDB`
    );

    const S = "shots";
    await h.addColumn(conn, S, "beat_role", "VARCHAR(16) NULL");
    await h.addColumn(conn, S, "beat_index", "INT NULL");
    await h.addColumn(conn, S, "anchor_keys", "TEXT NULL");
    await h.addColumn(conn, S, "continues_previous", "TINYINT NOT NULL DEFAULT 0");
    await h.addColumn(conn, S, "link", "VARCHAR(12) NULL");
    await h.addColumn(conn, S, "narration_fits", "TINYINT NULL");
  },
};
