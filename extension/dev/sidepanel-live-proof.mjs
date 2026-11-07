// Dev-only proof: the side panel on LIVE proxy data (README Contract 2) beside a real listing.
// Needs the team proxy on http://localhost:3000 with a valid key. Live Domain/realestate block
// automated Chromium, so the listing's real archived markup is served at its real URL (page
// scripts blocked); only the address is read from it. Nothing from the page is written to disk.
// Usage: node extension/dev/sidepanel-live-proof.mjs [listingUrl] [waybackTimestamp]
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const EXT = path.join(ROOT, "extension");
const { chromium } = createRequire(path.join(ROOT, "tools", "package.json"))("playwright");
const LISTING = (process.argv[2] || "https://www.domain.com.au/59-portman-street-zetland-nsw-2017-17904853").replace(/\/$/, "");
const SNAP = process.argv[3] || "20251219094851";
const SHOTS = path.join(ROOT, "tools", "shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!(await fetch("http://127.0.0.1:3000/health").then((r) => r.ok, () => false))) {
  console.error("The proxy on :3000 is not answering. Start it: cd proxy && npm start");
  process.exit(1);
}

async function archivedHtml() {
  const dir = path.join(os.tmpdir(), "mbx-e2e-archive"); // in-memory replay cache left by earlier runs
  const slug = LISTING.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "_");
  const hit = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.startsWith(`${SNAP}id_`) && f.includes(slug.slice(0, 50)));
  if (hit) return fs.readFileSync(path.join(dir, hit), "utf8");
  const r = await fetch(`https://web.archive.org/web/${SNAP}id_/${LISTING}`, { signal: AbortSignal.timeout(45000) });
  if (!r.ok) throw new Error(`archive answered HTTP ${r.status}`);
  return r.text();
}

const html = await archivedHtml();
fs.mkdirSync(SHOTS, { recursive: true });
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "mm-live-")), {
  headless: process.argv.includes("--headless"),
  viewport: { width: 1080, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await ctx.route("**/*", (route) => {
  const req = route.request();
  const url = req.url();
  if (!/^https?:/.test(url) || ["localhost", "127.0.0.1"].includes(new URL(url).hostname)) return route.continue();
  if (url.split("#")[0].replace(/\/$/, "") === LISTING) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
  if (req.resourceType() === "script" || req.resourceType() === "xhr" || req.resourceType() === "fetch") return route.abort();
  return route.continue(); // stylesheets, fonts and photos from the sites' CDNs, so the page looks like itself
});

const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 20000 }));
const extId = new URL(sw.url()).host;
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto(LISTING, { waitUntil: "domcontentloaded", timeout: 60000 });
const h1 = ((await page.locator("h1").first().textContent({ timeout: 10000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();

let tabId = null;
for (let i = 0; i < 80 && !tabId; i++) {
  tabId = await sw.evaluate(async (u) => {
    const all = await chrome.storage.session.get(null);
    for (const [k, v] of Object.entries(all)) if (k.startsWith("tab:") && v && (!v.pageUrl || v.pageUrl.startsWith(u))) return Number(k.slice(4));
    return null;
  }, LISTING);
  if (!tabId) await sleep(250);
}
if (!tabId) throw new Error("the content script never reported an address for the listing tab");

const panel = await ctx.newPage();
await panel.setViewportSize({ width: 360, height: 900 });
await panel.goto(`chrome-extension://${extId}/sidepanel/index.html?tabId=${tabId}`);
const ok = await panel.waitForSelector('#view[data-state="matched"]', { timeout: 60000 }).then(() => true, () => false);
const midSweep = await panel.screenshot({ type: "png" }); // needle still sweeping up from 0
await sleep(1800);
const info = await panel.evaluate(() => {
  const s = document.querySelector(".mm-speedo");
  return {
    state: document.querySelector("#view")?.dataset.state,
    matched: document.querySelector('[data-bind="address"]')?.textContent?.trim(),
    listing: document.querySelector('[data-bind="listing"]')?.textContent?.trim(),
    fit: s?.dataset.fit, band: s?.dataset.band,
    mockBadge: !(document.querySelector(".mm-mock")?.hidden ?? true),
    halos: [...document.querySelectorAll('li[data-kind="halo"]')].map((li) => li.dataset.signal),
    failos: [...document.querySelectorAll('li[data-kind="failo"]')].map((li) => li.dataset.signal),
    sliders: [...document.querySelectorAll(".mm-slider")].map((r) => `${r.dataset.dim}:${r.dataset.score}`),
  };
});
const badge = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId).catch(() => null);
console.log(JSON.stringify({ ok, h1, tabId, badge, ...info }, null, 1));

const listingPng = await page.screenshot({ type: "png" });
// The type-it box can take focus and scroll the panel; show the top (address, speedo, verdict).
await panel.evaluate(() => { document.activeElement?.blur?.(); document.scrollingElement?.scrollTo(0, 0); window.scrollTo(0, 0); });
await sleep(300);
const finalPanel = await panel.screenshot({ type: "png" });
fs.writeFileSync(path.join(SHOTS, "proof-live-sidepanel-full.png"), await panel.screenshot({ type: "png", fullPage: true }));
const comp = await ctx.newPage();
await comp.setViewportSize({ width: 1440, height: 900 });
const img = (buf, w) => `<img src="data:image/png;base64,${buf.toString("base64")}" style="width:${w}px;height:900px;display:block">`;
await comp.setContent(`<body style="margin:0;display:flex;background:#fff">${img(listingPng, 1080)}<div style="width:360px;border-left:1px solid #d0d0d0">${img(finalPanel, 359)}</div></body>`);
const out = path.join(SHOTS, "proof-live-sidepanel.png");
await comp.screenshot({ path: out });
fs.writeFileSync(path.join(SHOTS, "proof-live-sidepanel-midsweep.png"), midSweep);
console.log("screenshot:", out);
await ctx.close();
process.exit(ok ? 0 : 1);
