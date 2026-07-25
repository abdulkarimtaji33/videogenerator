CREATE DATABASE IF NOT EXISTS videogenerator
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE videogenerator;

CREATE TABLE IF NOT EXISTS projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  idea_prompt TEXT NOT NULL,
  shot_count INT NOT NULL DEFAULT 5,
  shot_duration_seconds INT NOT NULL DEFAULT 8,
  status ENUM('pending', 'story', 'character', 'scenes', 'shots', 'done', 'error') NOT NULL DEFAULT 'pending',
  story_script MEDIUMTEXT,
  character_description MEDIUMTEXT,
  character_image_prompt MEDIUMTEXT,
  character_image_path VARCHAR(512),
  error_message TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS shots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  shot_number INT NOT NULL,
  title VARCHAR(255),
  duration VARCHAR(64),
  duration_seconds INT NOT NULL DEFAULT 8,
  description MEDIUMTEXT,
  voiceover MEDIUMTEXT,
  image_prompt MEDIUMTEXT,
  image_path VARCHAR(512),
  image_regenerations INT NOT NULL DEFAULT 0,
  video_prompt MEDIUMTEXT,
  video_path VARCHAR(512),
  status ENUM('pending', 'image_prompt', 'image', 'video_prompt', 'video', 'done', 'error') NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_shots_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_project_shot (project_id, shot_number)
) ENGINE=InnoDB;
