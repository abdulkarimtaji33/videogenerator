module.exports = {
  name: "002_channels_topics",
  async up(conn) {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS channels (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        slug VARCHAR(80) NOT NULL,
        youtube_channel_id VARCHAR(64),
        language ENUM('en','ur','hi') NOT NULL DEFAULT 'en',
        niche VARCHAR(190),
        style_guide LONGTEXT,
        default_audio_mode ENUM('narrated','native','mixed') NOT NULL DEFAULT 'narrated',
        publish_mode ENUM('review','auto') NOT NULL DEFAULT 'review',
        daily_cap_long INT NOT NULL DEFAULT 1,
        daily_cap_shorts INT NOT NULL DEFAULT 3,
        publish_slots LONGTEXT,
        timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
        oauth_token_ref VARCHAR(255),
        status ENUM('active','paused') NOT NULL DEFAULT 'active',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_channel_slug (slug)
      ) ENGINE=InnoDB`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS topics (
        id INT AUTO_INCREMENT PRIMARY KEY,
        channel_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        angle TEXT,
        source ENUM('claude_research','analytics','manual','trend') NOT NULL DEFAULT 'manual',
        research_notes MEDIUMTEXT,
        sources_json LONGTEXT,
        score DECIMAL(5,2),
        status ENUM('idea','approved','planned','used','rejected') NOT NULL DEFAULT 'idea',
        reject_reason TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_topics_channel_status (channel_id, status),
        CONSTRAINT fk_topics_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
      ) ENGINE=InnoDB`);
  },
};
