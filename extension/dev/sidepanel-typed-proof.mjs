// Dev-only proof: type an address into the side panel and record what the dropdown shows on LIVE
// proxy data. Needs the team proxy on http://localhost:3000. The host tab is a real (archived)
// listing page; the typed address is looked up through the extension exactly as a user would.
// Usage: node extension/dev/sidepanel-typed-proof.mjs ["401/2 Victoria Park Parade, Zetland"] [--headed]
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const EXT = path.join(ROOT, "extension");
const { chromium } = createRequire(path.join(ROOT, "tools", "package.json"))("playwright");
const ADDRESS = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--profile" && all[i - 1] !== "--shot") || "401/2 Victoria Park Parade, Zetland";
const SHOT_NAME = process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : "proof-typed-dropdown.png";
const HEADED = process.argv.includes("--headed");
const HOST = "https://www.domain.com.au/59-portman-street-zetland-nsw-2017-17904853";
const SNAP = "20251219094851";
const SHOTS = path.join(ROOT, "tools", "shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!(await fetch("http://127.0.0.1:3000/health").then((r) => r.ok, () => false))) {
  console.error("Backend offline: start the proxy (cd proxy && npm start).");
  process.exit(1);
}
const dir = path.join(os.tmpdir(), "mbx-e2e-archive");
const hit = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.startsWith(`${SNAP}id_`) && f.includes("59_portman"));
const html = hit ? fs.readFileSync(path.join(dir, hit), "utf8")
  : await (await fetch(`https://web.archive.org/web/${SNAP}id_/${HOST}`, { signal: AbortSignal.timeout(45000) })).text();

fs.mkdirSync(SHOTS, { recursive: true });
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "mm-typed-")), {
  headless: !HEADED, ...(HEADED ? {} : { channel: "chromium" }),
  viewport: { width: 1080, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await ctx.route("**/*", (route) => {
  const req = route.request(); const url = req.url();
  if (!/^https?:/.test(url) || ["localhost", "127.0.0.1"].includes(new URL(url).hostname)) return route.continue();
  if (url.split("#")[0].replace(/\/$/, "") === HOST) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
  return ["script", "xhr", "fetch"].includes(req.resourceType()) ? route.abort() : route.continue();
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 20000 }));
const extId = new URL(sw.url()).host;
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto(HOST, { waitUntil: "domcontentloaded", timeout: 60000 });
let tabId = null;
for (let i = 0; i < 80 && !tabId; i++) {
  tabId = await sw.evaluate(async () => {
    const all = await chrome.storage.session.get(null);
    const k = Object.keys(all).find((key) => key.startsWith("tab:"));
    return k ? Number(k.slice(4)) : null;
  });
  if (!tabId) await sleep(250);
}
// --profile <file.json>: store a quiz persona exactly where site-bridge.js puts the website's saved
// profile (chrome.storage.local.profile). Without it the panel shows "Take the quiz to see your fit" (no score).
const profileArg = process.argv.indexOf("--profile");
const persona = profileArg > 0 ? JSON.parse(fs.readFileSync(process.argv[profileArg + 1], "utf8")) : null;
if (persona) await sw.evaluate((p) => chrome.storage.local.set({ profile: p }), persona);
const panel = await ctx.newPage();
await panel.setViewportSize({ width: 360, height: 900 });
await panel.goto(`chrome-extension://${extId}/sidepanel/index.html?tabId=${tabId}`);
await panel.waitForSelector("#mm-typeit-input", { timeout: 30000 });
await panel.fill("#mm-typeit-input", ADDRESS);
await panel.press("#mm-typeit-input", "Enter");
await panel.waitForFunction((needle) => document.querySelector("#view")?.dataset.state === "matched"
  && (document.querySelector('[data-bind="address"]')?.textContent || "").toLowerCase().includes(needle), ADDRESS.split(",")[0].split(" ").slice(-3).join(" ").toLowerCase(), { timeout: 60000 })
  .catch(async () => { console.error("did not reach matched for", ADDRESS, await panel.evaluate(() => document.querySelector("#view")?.dataset.state)); });
await sleep(1500);
await panel.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
await sleep(300);
const out = await panel.evaluate(() => {
  const text = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
  return {
    matched: text(document.querySelector('[data-bind="address"]')),
    fit: document.querySelector(".mm-speedo")?.dataset.fit ?? document.querySelector("[data-fit]")?.dataset.fit,
    cons: [...document.querySelectorAll(".mbx-fit__insights, .mbx-fit")].length ? text(document.querySelector('[class*="cons"], [data-group="cons"]')) : "",
    facts: [...document.querySelectorAll(".mbx-fit__fact-main")].map((m) => `${text(m)}  ||  ${text(m.parentElement?.querySelector(".mbx-fit__fact-src"))}`),
    all: text(document.querySelector("#view")).slice(0, 2500),
  };
});
console.log(JSON.stringify(out, null, 1));
await panel.screenshot({ path: path.join(SHOTS, SHOT_NAME), fullPage: true });
console.log("screenshot:", path.join(SHOTS, SHOT_NAME));
await ctx.close();
