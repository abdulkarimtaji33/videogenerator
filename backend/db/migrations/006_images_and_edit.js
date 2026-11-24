// Image provider choice per project (FLUX self-hosted by default) and the edit pass (Editing-Quality-Plan.md, section 1.1).
module.exports = {
  name: "006_images_and_edit",
  async up(conn, h) {
    const P = "projects";
    await h.addColumn(conn, P, "image_provider", "VARCHAR(24) NULL");
    await h.addColumn(conn, P, "image_fallback", "TINYINT NOT NULL DEFAULT 0");
    await h.addColumn(conn, P, "edit_json", "LONGTEXT NULL");
    await h.addColumn(conn, P, "edit_review_json", "LONGTEXT NULL");
    await h.addColumn(conn, "anchors", "image_provider_used", "VARCHAR(24) NULL");
    await h.addColumn(conn, "anchors", "image_ms", "INT NULL");
    await h.addColumn(conn, "shots", "image_provider_used", "VARCHAR(24) NULL");
    await h.addColumn(conn, "shots", "image_ms", "INT NULL");
  },
};
