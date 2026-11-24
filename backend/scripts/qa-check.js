// Read-only health check. Prints PASS / FAIL / WARN lines and never writes, enqueues, or spends anything:
// only GET requests to the API and SELECTs to find the seeded "Demo:" project ids.
//   node scripts/qa-check.js            (API http://localhost:4501, UI http://localhost:4500)
// Exit code 1 when any line is FAIL.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const API = process.env.QA_API || "http://localhost:4501";
const UI = process.env.QA_UI || "http://localhost:4500";
let fails = 0;
const line = (ok, name, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " - " + detail : ""}`);
};
const warn = (name, detail = "") => console.log(`WARN  ${name}${detail ? " - " + detail : ""}`);

async function get(url, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: e.name === "AbortError" ? "timeout" : e.message };
  } finally {
    clearTimeout(t);
  }
}

async function demoIds() {
  try {
    const mysql = require("mysql2/promise");
    const conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || "root",
      password: process.env.MYSQL_PASSWORD || "",
      database: process.env.MYSQL_DATABASE || "videogenerator",
      connectTimeout: 4000,
    });
    try {
      const [rows] = await conn.query("SELECT id, title FROM projects WHERE title LIKE 'Demo:%' ORDER BY id");
      return rows;
    } finally {
      await conn.end();
    }
  } catch (e) {
    return { error: e.message };
  }
}

(async () => {
  const ov = await get(`${API}/api/system/overview`);
  line(ov.ok, "backend up", ov.ok ? `${API}` : ov.error || `HTTP ${ov.status}`);
  if (ov.ok) {
    const f = ov.json?.recentFailures?.length || 0;
    f ? warn("recent failed projects", `${f} in /api/system/overview`) : line(true, "no recent failed projects");
  }

  const img = await get(`${API}/api/system/images`);
  line(img.ok && Array.isArray(img.json?.providers), "image provider layer answers", img.ok ? `default=${img.json?.default}` : img.error || `HTTP ${img.status}`);
  if (img.ok && img.json) {
    const flux = img.json.providers.find((p) => p.id === "flux-local");
    if (flux?.online) line(true, "FLUX server online", `${img.json.flux?.model} @ ${img.json.flux?.url}`);
    else warn("FLUX server offline", "start it with `npm run flux` (or point Settings at a rented GPU URL); images fall back only if the project allows it");
    const oa = img.json.providers.find((p) => p.id === "openai");
    oa && !oa.configured ? warn("openai image provider not configured", oa.detail || "") : null;
  }

  const rows = await demoIds();
  if (!Array.isArray(rows)) {
    line(false, "database reachable", rows.error);
  } else {
    line(rows.length >= 6, "seeded demo projects", `${rows.length} found (expected 6, run node scripts/seed.js)`);
    for (const r of rows) {
      const p = await get(`${API}/api/projects/${r.id}`);
      if (!p.ok) {
        line(false, `project ${r.id} loads`, p.error || `HTTP ${p.status}`);
        continue;
      }
      const v = p.json;
      const migrated = "imageProvider" in v && "imageFallback" in v && "edit" in v && "editReview" in v;
      line(migrated, `${r.title}: migrations applied (imageProvider/edit fields)`);
      const anchors = v.anchors?.length || 0;
      const shots = v.shots?.length || 0;
      line(anchors > 0 && shots > 0, `${r.title}: anchors and shots`, `${anchors} anchors, ${shots} shots`);
      const roles = v.shots?.every((s) => s.beat_role && Array.isArray(s.anchor_keys));
      line(!!roles, `${r.title}: shots carry beat_role and anchor_keys`);
      line(!!v.imageProvider, `${r.title}: image model set`, String(v.imageProvider));
      if (v.edit) {
        const beats = v.edit.beats?.length || 0;
        line(beats === shots && v.editReview?.checks?.length > 0, `${r.title}: edit plan and review saved`, `${beats} beats, ${v.editReview?.checks?.length || 0} checks, passed=${v.editReview?.passed}`);
      }
    }
    const withEdit = [];
    for (const r of rows) {
      const p = await get(`${API}/api/projects/${r.id}`);
      if (p.ok && p.json?.edit) withEdit.push(r.id);
    }
    line(withEdit.length >= 2 || rows.length === 0, "at least two demo projects have an edit plan", `ids ${withEdit.join(", ") || "none"}`);
  }

  const ui = await get(UI);
  line(ui.ok || ui.status > 0, "frontend up", ui.ok ? UI : ui.error || `HTTP ${ui.status}`);

  console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
  process.exit(fails ? 1 : 0);
})();
