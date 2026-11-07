// Dev-only proof: the side panel on LIVE proxy data (README Contract 2) beside a real listing with NO
// profile saved (no default persona: the panel must show the matched address and "Take the quiz to see
// your fit", one button to the website quiz, no speedo, sliders, pros/cons or numbers, empty badge),
// then the same listing with the proxy unreachable (the panel must say "Backend offline — retry").
// Nothing writes chrome.storage.local.profile here.
// Needs the team proxy on http://localhost:3000 with a valid key. Live Domain/realestate block
// automated Chromium, so the listing's real archived markup is served at its real URL (page
// scripts blocked); only the address is read from it. Nothing from the page is written to disk.
// The offline check never touches the running proxy: it loads a temp copy of extension/ whose
// API_BASE is http://localhost:3999, where nothing listens.
// Usage: node extension/dev/sidepanel-live-proof.mjs [listingUrl] [waybackTimestamp] [--headless]
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const EXT = path.join(ROOT, "extension");
const { chromium } = createRequire(path.join(ROOT, "tools", "package.json"))("playwright");
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const LISTING = (args[0] || "https://www.domain.com.au/59-portman-street-zetland-nsw-2017-17904853").replace(/\/$/, "");
const SNAP = args[1] || "20251219094851";
const SHOTS = path.join(ROOT, "tools", "shots");
const OFFLINE_BASE = "http://localhost:3999";
const { SITE_URL } = await import(pathToFileURL(path.join(EXT, "src", "config.js")).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

if (!(await fetch("http://127.0.0.1:3000/health").then((r) => r.ok, () => false))) {
  console.error("The proxy on :3000 is not answering. Start it: cd proxy && npm start");
  process.exit(1);
}
if (await fetch(`${OFFLINE_BASE}/health`).then(() => true, () => false)) {
  console.error(`Something answers on ${OFFLINE_BASE}; the offline check needs nothing listening there.`);
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

async function launch(extDir, prefix) {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), prefix)), {
    headless: process.argv.includes("--headless"),
    // The headless shell cannot load extensions; the full Chromium build can, headless too.
    ...(process.argv.includes("--headless") ? { channel: "chromium" } : {}),
    viewport: { width: 1080, height: 900 },
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
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
  return { ctx, sw, extId: new URL(sw.url()).host };
}

async function openListing({ ctx, sw, extId }) {
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(LISTING, { waitUntil: "domcontentloaded", timeout: 60000 });
  const h1 = ((await page.locator("h1").first().textContent({ timeout: 10000 }).catch(() => "")) || "").replace(/\s+/g, " ").trim();
  let tabId = null;
  for (let i = 0; i < 80 && !tabId; i++) {
    tabId = await sw.evaluate(async (u) => {
      const all = await chrome.storage.session.get(null);
      // Only the listing tab's own record: a blank or panel tab can briefly hold a "loading" record
      // with no pageUrl, and attaching the panel to it showed "empty" (the old flake).
      for (const [k, v] of Object.entries(all)) if (k.startsWith("tab:") && typeof v?.pageUrl === "string" && v.pageUrl.startsWith(u)) return Number(k.slice(4));
      return null;
    }, LISTING);
    if (!tabId) await sleep(250);
  }
  if (!tabId) throw new Error("the content script never reported an address for the listing tab");
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 360, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html?tabId=${tabId}`);
  // Harness race: a panel opened in the same instant as the first record can miss it; reload once.
  const left = await panel.waitForFunction(() => document.querySelector("#view")?.dataset.state !== "empty", null, { timeout: 8000 }).then(() => true, () => false);
  if (!left) await panel.reload();
  return { page, panel, tabId, h1 };
}

async function sideBySide(ctx, listingPng, panelPng, out) {
  const comp = await ctx.newPage();
  await comp.setViewportSize({ width: 1440, height: 900 });
  const img = (buf, w) => `<img src="data:image/png;base64,${buf.toString("base64")}" style="width:${w}px;height:900px;display:block">`;
  await comp.setContent(`<body style="margin:0;display:flex;background:#fff">${img(listingPng, 1080)}<div style="width:360px;border-left:1px solid #d0d0d0">${img(panelPng, 359)}</div></body>`);
  await comp.screenshot({ path: out });
  console.log("screenshot:", out);
}

// ---------- 1. LIVE: the real proxy on :3000 ----------
{
  const live = await launch(EXT, "mm-live-");
  const { page, panel, tabId, h1 } = await openListing(live);
  const ok = await panel.waitForSelector('#view[data-state="matched"]', { timeout: 60000 }).then(() => true, () => false);
  await sleep(1500);
  const stored = await live.sw.evaluate(() => chrome.storage.local.get("profile").then((g) => g.profile ?? null));
  const info = await panel.evaluate(() => {
    const visible = (n) => (typeof n.checkVisibility === "function" ? n.checkVisibility() : n.getClientRects().length > 0);
    const view = document.querySelector("#view");
    const result = view?.querySelector('[data-for="matched"]');
    const cta = document.querySelector('.mm-quiz-cta[data-state="no-profile"]');
    // Digits in the matched view outside the address lines (the address itself carries street numbers).
    const addressBits = ["address", "listing", "confidence"].map((b) => document.querySelector(`[data-bind="${b}"]`)?.innerText || "");
    let rest = result ? result.innerText : "";
    for (const bit of addressBits) if (bit) rest = rest.split(bit).join(" ");
    return {
      state: view?.dataset.state,
      matched: document.querySelector('[data-bind="address"]')?.textContent?.trim(),
      listing: document.querySelector('[data-bind="listing"]')?.textContent?.trim(),
      ctaVisible: Boolean(cta && visible(cta)),
      ctaTitle: cta?.querySelector(".mm-quiz-cta__title")?.textContent?.trim() || null,
      ctaButtons: cta ? cta.querySelectorAll("button").length : 0,
      quizButton: Boolean(cta?.querySelector('button[data-action="open-quiz"]')),
      speedo: [...document.querySelectorAll(".mm-speedo, .mm-score")].filter(visible).length,
      sliders: [...document.querySelectorAll(".mm-slider")].filter(visible).length,
      prosCons: [...document.querySelectorAll('[data-kind="halo"], [data-kind="failo"], .mm-halo')].filter(visible).length,
      profileBar: [...document.querySelectorAll(".mm-profile")].filter(visible).length,
      digitsOutsideAddress: (rest.match(/\d/g) || []).length,
      restText: rest.replace(/\s+/g, " ").trim(),
      asof: document.querySelector('[data-bind="asof"]')?.textContent || "",
      exampleText: /\bexample\b|\bsarah\b/i.test(document.body.innerText),
      mockElement: Boolean(document.querySelector(".mm-mock")),
      mockText: /\bmock\b/i.test(document.body.innerText),
      placeholder: document.getElementById("mm-typeit-input")?.getAttribute("placeholder"),
    };
  });
  const record = await live.sw.evaluate((id) => chrome.storage.session.get(`tab:${id}`).then((g) => g[`tab:${id}`]), tabId);
  const badge = await live.sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId).catch(() => null);
  console.log(JSON.stringify({ ok, h1, tabId, badge, storedProfile: stored, contract: record?.contract, ...info }, null, 1));
  check("live: no profile in chrome.storage.local", stored === null, JSON.stringify(stored));
  check("live: panel reaches the matched state", ok && info.state === "matched");
  check("live: answer is README Contract 2 from the proxy", record?.contract === 2 && Boolean(record?.matched?.gnaf_id));
  check("live: matched address shown", Boolean(info.matched), info.matched);
  check("live: 'Take the quiz to see your fit' shown", info.ctaVisible && info.ctaTitle === "Take the quiz to see your fit", String(info.ctaTitle));
  check("live: exactly one button in the quiz state, and it opens the quiz", info.ctaButtons === 1 && info.quizButton, String(info.ctaButtons));
  check("live: no speedo", info.speedo === 0, String(info.speedo));
  check("live: no sliders", info.sliders === 0, String(info.sliders));
  check("live: no pros/cons", info.prosCons === 0, String(info.prosCons));
  check("live: no profile summary bar", info.profileBar === 0, String(info.profileBar));
  check("live: no numbers outside the address", info.digitsOutsideAddress === 0, info.restText);
  check("live: no fetched-at stamp", info.asof === "", info.asof);
  check("live: no 'Example' / 'Sarah' anywhere", !info.exampleText);
  check("live: badge empty without a profile", badge === "", JSON.stringify(badge));
  check("live: no .mm-mock element", !info.mockElement);
  check("live: no 'mock' text anywhere in the panel", !info.mockText);
  check("live: neutral type-it placeholder", info.placeholder === "Street address and suburb", info.placeholder);

  const listingPng = await page.screenshot({ type: "png" });
  await panel.evaluate(() => { document.activeElement?.blur?.(); document.scrollingElement?.scrollTo(0, 0); window.scrollTo(0, 0); });
  await sleep(300);
  const finalPanel = await panel.screenshot({ type: "png" });
  fs.writeFileSync(path.join(SHOTS, "proof-no-profile-panel.png"), finalPanel);
  await sideBySide(live.ctx, listingPng, finalPanel, path.join(SHOTS, "proof-no-profile.png"));

  // The one button opens the website quiz in a new tab (chrome.tabs.create).
  const opened = live.ctx.waitForEvent("page", { timeout: 15000 }).catch(() => null);
  await panel.click('.mm-quiz-cta button[data-action="open-quiz"]', { timeout: 5000 }).catch(() => {});
  const quizTab = await opened;
  if (quizTab) await quizTab.waitForURL((u) => u.href.startsWith(`${SITE_URL}/quiz`), { timeout: 10000 }).catch(() => {});
  const tabUrls = await live.sw.evaluate(() => chrome.tabs.query({}).then((ts) => ts.map((t) => t.pendingUrl || t.url))).catch(() => []);
  const quizUrl = [quizTab?.url() || "", ...tabUrls].find((u) => u.startsWith(`${SITE_URL}/quiz`)) || `${quizTab?.url() || ""} | ${tabUrls.join(" ")}`;
  check("live: the button opens SITE_URL/quiz", quizUrl.startsWith(`${SITE_URL}/quiz`), quizUrl);
  await live.ctx.close();
}

// ---------- 2. OFFLINE: a copy of the extension pointed at :3999 (nothing listens) ----------
{
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mm-offline-ext-")), "extension");
  fs.cpSync(EXT, copy, { recursive: true, filter: (src) => !src.includes(`${path.sep}dev${path.sep}`) && !src.endsWith(`${path.sep}dev`) });
  const configPath = path.join(copy, "src", "config.js");
  const config = fs.readFileSync(configPath, "utf8");
  if (!/export const API_BASE = "[^"]*";/.test(config)) throw new Error("could not find API_BASE in the copied src/config.js");
  fs.writeFileSync(configPath, config.replace(/export const API_BASE = "[^"]*";/, `export const API_BASE = "${OFFLINE_BASE}";`));
  const manifestPath = path.join(copy, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), "http://localhost:3999/*", "http://127.0.0.1:3999/*"])];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const off = await launch(copy, "mm-offline-");
  const { page, panel, tabId } = await openListing(off);
  const reached = await panel.waitForSelector('#view[data-state="error"]', { timeout: 40000 }).then(() => true, () => false);
  await sleep(500);
  const look = () => panel.evaluate(() => {
    const visible = (n) => (typeof n.checkVisibility === "function" ? n.checkVisibility() : n.getClientRects().length > 0);
    return {
      state: document.querySelector("#view")?.dataset.state,
      text: document.body.innerText.replace(/\s+/g, " ").trim(),
      visibleNumbers: [...document.querySelectorAll(".mm-speedo, .mm-halo, .mm-slider, [data-kind=\"halo\"], [data-kind=\"failo\"]")].filter(visible).length,
      digits: (document.body.innerText.match(/\d/g) || []).length,
      inlineRetry: Boolean(document.querySelector('[data-bind="error"] button[data-action="retry"]')),
      mockElement: Boolean(document.querySelector(".mm-mock")),
    };
  });
  const info = await look();
  const record = await off.sw.evaluate((id) => chrome.storage.session.get(`tab:${id}`).then((g) => g[`tab:${id}`]), tabId);
  const badge = await off.sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId).catch(() => null);
  console.log(JSON.stringify({ reached, tabId, badge, record: { status: record?.status, code: record?.code, message: record?.message }, ...info }, null, 1));
  check("offline: panel reaches the error state", reached && info.state === "error");
  check("offline: background wrote code offline", record?.status === "error" && record?.code === "offline" && record?.message === "Backend offline");
  check("offline: visible text contains 'Backend offline — retry'", info.text.includes("Backend offline — retry"), info.text);
  check("offline: retry is an inline button", info.inlineRetry);
  check("offline: no speedo, halo or slider visible", info.visibleNumbers === 0, String(info.visibleNumbers));
  check("offline: no number visible", info.digits === 0, String(info.digits));
  check("offline: badge cleared", badge === "", JSON.stringify(badge));
  check("offline: no .mm-mock element", !info.mockElement);

  const listingPng = await page.screenshot({ type: "png" });
  await panel.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  const offlinePanel = await panel.screenshot({ type: "png" });
  await sideBySide(off.ctx, listingPng, offlinePanel, path.join(SHOTS, "proof-offline.png"));

  // Clicking "retry" sends the retry message: background asks the (still absent) proxy again.
  const before = record?.fetchedAt;
  await panel.click('[data-bind="error"] button[data-action="retry"]');
  let after = before;
  for (let i = 0; i < 40 && after === before; i++) {
    await sleep(250);
    after = await off.sw.evaluate((id) => chrome.storage.session.get(`tab:${id}`).then((g) => g[`tab:${id}`]?.fetchedAt), tabId);
  }
  const back = await panel.waitForSelector('#view[data-state="error"]', { timeout: 20000 }).then(() => true, () => false);
  await sleep(300);
  const again = await look();
  check("offline: retry re-asks the proxy and lands on 'Backend offline — retry' again", Boolean(after) && after !== before && back && again.text.includes("Backend offline — retry"), `${before} -> ${after}`);
  await off.ctx.close();
  fs.rmSync(path.dirname(copy), { recursive: true, force: true });
}

console.log(failures.length ? `FAILED: ${failures.join("; ")}` : "ALL CHECKS PASSED");
process.exit(failures.length ? 1 : 0);
