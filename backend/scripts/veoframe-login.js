// One-time sign-in for the Veoframe worker. Opens the worker's own Chrome profile on the sign-in page and waits
// until you have signed in yourself (the password is typed by you, never by this project). The session is kept in
// storage/browser-profile/veoframe, which is gitignored.
//   node scripts/veoframe-login.js
const path = require("path");
const { chromium } = require("playwright-core");

const PROFILE = path.join(__dirname, "..", "storage", "browser-profile", "veoframe");

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1100, height: 800 },
    // Google refuses sign-in in browsers that announce they are automated.
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto("https://veoframe.com/user/generate.php", { waitUntil: "domcontentloaded" });
  // Veoframe offers email sign-in and "Sign in with Google" (which leaves veoframe.com for a while), so only a
  // page back on veoframe.com under /user/ counts as signed in.
  const inside = (u) => {
    const url = new URL(u.toString());
    return url.hostname.endsWith("veoframe.com") && url.pathname.startsWith("/user/");
  };
  if (!inside(page.url())) {
    console.log("Sign in to Veoframe in the window that just opened. Waiting up to 10 minutes...");
    await page.waitForURL(inside, { timeout: 10 * 60 * 1000 });
    await page.waitForTimeout(2000);
  }
  console.log("Signed in. URL:", page.url());
  await ctx.close();
})().catch((e) => {
  console.error("LOGIN FAILED:", e.message);
  process.exit(1);
});
