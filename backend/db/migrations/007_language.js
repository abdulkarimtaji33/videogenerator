// Urdu and Hindi videos: the project's language, and per shot the spoken line (native script), its Roman transliteration
// (used for captions), the English line it came from, and who speaks it (a character key or "narrator").
module.exports = {
  name: "007_language",
  async up(conn, h) {
    await h.addColumn(conn, "projects", "language", "VARCHAR(8) NOT NULL DEFAULT 'en'");
    await h.addColumn(conn, "shots", "caption_text", "TEXT NULL");
    await h.addColumn(conn, "shots", "narration_en", "TEXT NULL");
    await h.addColumn(conn, "shots", "speaker", "VARCHAR(48) NULL");
  },
};
