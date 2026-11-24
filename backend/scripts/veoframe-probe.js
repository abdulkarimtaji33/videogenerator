// One-off discovery for the Veoframe worker: opens the Studio in the worker's own Chrome profile and prints
// what it finds (login state, selects, file inputs, buttons). It never clicks Generate.
//   node scripts/veoframe-probe.js
const path = require("path");
const { chromium } = require("playwright-core");

const PROFILE = path.join(__dirname, "..", "storage", "browser-profile", "veoframe");

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto("https://veoframe.com/user/generate.php", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  console.log("URL:", page.url());
  console.log("TITLE:", await page.title());
  if (!page.url().includes("login")) {
    await page.getByRole("button", { name: "Video", exact: true }).click().catch((e) => console.log("video tab click:", e.message));
    await page.waitForTimeout(800);
  }
  const info = await page.evaluate(() => ({
    jobLinks: [...document.querySelectorAll("a[href*='job.php'], [data-id], [data-job], [data-job-id]")].slice(0, 6).map((e) => ({ tag: e.tagName, href: e.getAttribute("href"), data: { ...e.dataset } })),
    selects: [...document.querySelectorAll("select")].map((s) => ({ id: s.id, name: s.name, options: [...s.options].map((o) => o.value + "|" + o.text) })),
    fileInputs: [...document.querySelectorAll("input[type=file]")].map((i) => ({ id: i.id, name: i.name, accept: i.accept, multiple: i.multiple })),
    textareas: [...document.querySelectorAll("textarea")].map((t) => ({ id: t.id, name: t.name, placeholder: t.placeholder })),
    buttons: [...document.querySelectorAll("button")].map((b) => ({ id: b.id, type: b.type, text: (b.innerText || "").trim().slice(0, 30), cls: b.className.slice(0, 40) })).slice(0, 40),
    forms: [...document.forms].map((f) => ({ id: f.id, action: f.action, method: f.method })),
  }));
  console.log(JSON.stringify(info, null, 1));
  await ctx.close();
})().catch((e) => {
  console.error("PROBE FAILED:", e.message);
  process.exit(1);
});
