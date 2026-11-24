module.exports = {
  name: "003_assets_jobs_usage_uploads_settings",
  async up(conn) {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS assets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        shot_id INT NULL,
        kind ENUM('image','clip','voice','music','stock','caption','thumbnail') NOT NULL,
        path VARCHAR(512) NOT NULL,
        provider VARCHAR(64),
        licence VARCHAR(255),
        source_url VARCHAR(1024),
        checksum VARCHAR(64),
        width INT,
        height INT,
        duration DECIMAL(8,2),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_assets_project (project_id, kind),
        CONSTRAINT fk_assets_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ENGINE=InnoDB`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        type VARCHAR(64) NOT NULL,
        payload LONGTEXT,
        dedupe_key VARCHAR(190) NULL,
        status ENUM('queued','running','done','failed','dead') NOT NULL DEFAULT 'queued',
        attempts INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 3,
        run_after DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        locked_by VARCHAR(96) NULL,
        locked_at DATETIME NULL,
        last_error TEXT,
        result LONGTEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_jobs_claim (status, run_after),
        UNIQUE KEY uniq_jobs_dedupe (dedupe_key)
      ) ENGINE=InnoDB`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS provider_usage (
        id INT AUTO_INCREMENT PRIMARY KEY,
        provider VARCHAR(64) NOT NULL,
        usage_date DATE NOT NULL,
        units INT NOT NULL DEFAULT 0,
        quota INT NULL,
        cost_usd DECIMAL(10,4) NOT NULL DEFAULT 0,
        UNIQUE KEY uniq_usage (provider, usage_date)
      ) ENGINE=InnoDB`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS uploads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        youtube_video_id VARCHAR(32),
        privacy ENUM('private','unlisted','public') NOT NULL DEFAULT 'private',
        publish_at DATETIME NULL,
        state ENUM('uploading','private','scheduled','public','failed') NOT NULL DEFAULT 'uploading',
        stats LONGTEXT,
        error TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_uploads_project (project_id),
        CONSTRAINT fk_uploads_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ENGINE=InnoDB`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS settings (
        \`key\` VARCHAR(100) PRIMARY KEY,
        value LONGTEXT,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB`);
  },
};
