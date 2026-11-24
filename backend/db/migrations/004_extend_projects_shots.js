// Extends the original tables for the channel pipeline. Old projects keep working: every new column is
// nullable or has a default, and the original `status` column (old pipeline) is left alone.
module.exports = {
  name: "004_extend_projects_shots",
  async up(conn, h) {
    const P = "projects";
    await h.addColumn(conn, P, "channel_id", "INT NULL");
    await h.addColumn(conn, P, "topic_id", "INT NULL");
    await h.addColumn(conn, P, "format", "ENUM('long','short') NOT NULL DEFAULT 'long'");
    await h.addColumn(conn, P, "parent_project_id", "INT NULL");
    await h.addColumn(conn, P, "language", "VARCHAR(8) NOT NULL DEFAULT 'en'");
    await h.addColumn(conn, P, "aspect", "VARCHAR(8) NOT NULL DEFAULT '16:9'");
    await h.addColumn(conn, P, "audio_mode", "ENUM('narrated','native','mixed') NOT NULL DEFAULT 'narrated'");
    await h.addColumn(conn, P, "plan_source", "ENUM('claude','openai') NOT NULL DEFAULT 'openai'");
    await h.addColumn(conn, P, "plan_json", "LONGTEXT NULL");
    await h.addColumn(conn, P, "title", "VARCHAR(255) NULL");
    await h.addColumn(conn, P, "description", "MEDIUMTEXT NULL");
    await h.addColumn(conn, P, "tags", "LONGTEXT NULL");
    await h.addColumn(conn, P, "chapters", "LONGTEXT NULL");
    await h.addColumn(conn, P, "final_video_path", "VARCHAR(512) NULL");
    await h.addColumn(conn, P, "thumbnail_path", "VARCHAR(512) NULL");
    await h.addColumn(conn, P, "qa_status", "ENUM('pending','passed','failed') NOT NULL DEFAULT 'pending'");
    await h.addColumn(conn, P, "qa_report", "LONGTEXT NULL");
    await h.addColumn(conn, P, "publish_mode", "ENUM('review','auto') NOT NULL DEFAULT 'review'");
    await h.addColumn(conn, P, "publish_at", "DATETIME NULL");
    await h.addColumn(conn, P, "cost_estimate", "DECIMAL(10,4) NULL");
    // Channel pipeline stage machine: draft, planned, assets, assembling, qa, awaiting_approval,
    // uploading, scheduled, published, failed, rejected.
    await h.addColumn(conn, P, "stage", "VARCHAR(24) NOT NULL DEFAULT 'draft'");
    await h.addIndex(conn, P, "idx_projects_channel_stage", "channel_id, stage");

    const S = "shots";
    await h.addColumn(conn, S, "clip_type", "ENUM('ai_video','still_kenburns','stock','card','chart') NOT NULL DEFAULT 'ai_video'");
    await h.addColumn(conn, S, "provider", "VARCHAR(32) NULL");
    await h.addColumn(conn, S, "provider_job_ref", "VARCHAR(128) NULL");
    await h.addColumn(conn, S, "attempt_count", "INT NOT NULL DEFAULT 0");
    await h.addColumn(conn, S, "narration_text", "MEDIUMTEXT NULL");
    await h.addColumn(conn, S, "dialogue_text", "MEDIUMTEXT NULL");
    await h.addColumn(conn, S, "sfx_hint", "VARCHAR(255) NULL");
    await h.addColumn(conn, S, "accepted", "TINYINT NOT NULL DEFAULT 0");
    await h.addColumn(conn, S, "qa_notes", "TEXT NULL");
  },
};
