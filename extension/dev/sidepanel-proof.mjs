#!/usr/bin/env node
// Dev-only end-to-end proof of the MicroMatch side panel (not referenced by manifest.json).
// The REAL unpacked extension + the team backend mock on 127.0.0.1:8000, on REAL listing markup.
// domain.com.au blocks automated Chromium (Akamai / Kasada), so the listing URL is answered, in memory
// only, with the raw archived HTML of that same URL from the Wayback Machine. Page scripts are blocked;
// nothing from the archive is written to disk. The content script reads the address off that markup
// exactly as it would on the live page.
//
//   MM_BACKEND_CMD=/path/to/run-backend.sh node extension/dev/sidepanel-proof.mjs [--headless]
// With MM_BACKEND_CMD the script starts and stops the backend itself (needed for the "backend down"
// check); without it the backend must already be running and that check is skipped.
// Screenshots go to tools/shots/ (gitignored). Exit code 1 on any failed check.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const EXT = path.join(ROOT, "extension");
const SHOTS = path.join(ROOT, "tools", "shots");
const { chromium } = createRequire(path.join(ROOT, "tools", "package.json"))("playwright");

const BACKEND = "http://127.0.0.1:8000/api";
const LISTING = "https://www.domain.com.au/17-young-street-redfern-nsw-2016-17875055";
const SNAPSHOT = "20251210010234";
const SEARCH = "https://www.domain.com.au/rent/redfern-nsw-2016/";
const headless = process.argv.includes("--headless");
const backendCmd = process.env.MM_BACKEND_CMD || null;
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : `  ${JSON.stringify(detail)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- backend lifecycle ----------
let backend = null;
async function health() {
  try {
    const r = await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(1500) });
    return await r.json();
  } catch {
    return null;
  }
}
async function startBackend() {
  if (!backendCmd) return health();
  if (await health()) throw new Error("port 8000 is already serving; stop it or unset MM_BACKEND_CMD");
  backend = spawn(backendCmd, [], { stdio: ["ignore", "pipe", "pipe"] });
  backend.stdout.on("data", (d) => process.stderr.write(`[backend] ${d}`));
  backend.stderr.on("data", () => {}); // request log: noisy
  for (let i = 0; i < 60; i += 1) {
    const h = await health();
    if (h) return h;
    await sleep(250);
  }
  throw new Error("backend did not start");
}
async function stopBackend() {
  if (!backend) return;
  const p = backend;
  backend = null;
  await new Promise((resolve) => {
    p.once("exit", resolve);
    p.kill("SIGTERM");
    setTimeout(() => {
      try { p.kill("SIGKILL"); } catch {}
      resolve();
    }, 4000);
  });
  for (let i = 0; i < 20 && (await health()); i += 1) await sleep(200);
}

// ---------- archive replay, in memory only ----------
const memo = new Map();
function archived(url, flag, ts = SNAPSHOT) {
  const key = `${flag} ${url}`;
  if (!memo.has(key)) {
    memo.set(
      key,
      (async () => {
        const r = await fetch(`https://web.archive.org/web/${ts}${flag}/${url}`, { redirect: "follow", signal: AbortSignal.timeout(45000) });
        return { status: r.status, type: r.headers.get("content-type") || "application/octet-stream", body: Buffer.from(await r.arrayBuffer()) };
      })().catch((e) => {
        memo.delete(key);
        throw e;
      }),
    );
  }
  return memo.get(key);
}
const SEARCH_PAGE =
  '<!doctype html><html><head><title>Rent in Redfern</title></head><body><h1>Properties for rent in Redfern, NSW 2016</h1><p>(placeholder search-results page served at the real search URL)</p></body></html>';

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-proof-"));
let ctx = null;

async function main() {
  const h = await startBackend();
  check("backend /api/health", h && h.status === "ok", h);

  ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless,
    viewport: { width: 1080, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await ctx.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    const type = req.resourceType();
    let host = "";
    try { host = new URL(url).hostname; } catch {}
    if (host === "localhost" || host === "127.0.0.1" || !/^https?:/.test(url)) return route.continue();
    const isDomain = /^https:\/\/www\.domain\.com\.au\//.test(url);
    if (isDomain && type === "document") {
      if (url.startsWith(SEARCH)) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: SEARCH_PAGE });
      try {
        const a = await archived(url.split("#")[0], "id_");
        return route.fulfill({ status: a.status, contentType: "text/html; charset=utf-8", body: a.body });
      } catch (e) {
        return route.fulfill({ status: 502, contentType: "text/plain", body: `archive fetch failed: ${e.message}` });
      }
    }
    if (type === "stylesheet" || type === "image" || type === "font") {
      if (isDomain) {
        try {
          const a = await archived(url, type === "stylesheet" ? "cs_" : "im_");
          return route.fulfill({ status: a.status, contentType: a.type, body: a.body });
        } catch {
          return route.abort();
        }
      }
      return route.continue();
    }
    return route.abort(); // the page's own scripts, XHR, trackers
  });

  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  check("service worker started", /src\/background\.js$/.test(sw.url()), sw.url());
  const swErrors = [];
  try { sw.on("console", (m) => { if (m.type() === "error") swErrors.push(m.text()); }); } catch {}

  // 1. the real Domain rental
  const listing = ctx.pages()[0] || (await ctx.newPage());
  await listing.goto(LISTING, { waitUntil: "domcontentloaded", timeout: 90000 });
  const h1 = await listing.evaluate(() => document.querySelector("h1")?.textContent?.trim() || null);
  check("archived listing markup loaded", !!h1, h1);

  // The background stores the tab's record with the page URL the content script reported.
  let tabId = null;
  for (let i = 0; i < 80 && tabId === null; i += 1) {
    tabId = await sw.evaluate(async (want) => {
      const all = await chrome.storage.session.get(null);
      for (const [k, v] of Object.entries(all)) if (k.startsWith("tab:") && v?.pageUrl === want) return Number(k.slice(4));
      return null;
    }, LISTING);
    if (tabId === null) await sleep(250);
  }
  check("content script reported the listing address (tab record exists)", tabId !== null, tabId);

  const panel = await ctx.newPage();
  const panelErrors = [];
  panel.on("pageerror", (e) => panelErrors.push(String(e)));
  panel.on("console", (m) => { if (m.type() === "error") panelErrors.push(m.text()); });
  await panel.setViewportSize({ width: 360, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html?tabId=${tabId}`);
  const waitState = (state, timeout = 30000) => panel.waitForSelector(`#view[data-state="${state}"]`, { timeout }).then(() => true, () => false);

  check("panel reached matched", await waitState("matched"));
  await sleep(1400); // let the needle finish its sweep before the screenshot
  const facts = await panel.evaluate(() => {
    const t = (s) => document.querySelector(s)?.textContent?.trim() ?? null;
    return {
      address: t('[data-bind="address"]'),
      listing: t('[data-bind="listing"]'),
      confidence: t('[data-bind="confidence"]'),
      facts: t('[data-bind="facts"]'),
      mockBadge: !document.querySelector(".mm-mock").hidden,
      fit: document.querySelector(".mm-speedo")?.dataset.fit ?? null,
      band: document.querySelector(".mm-speedo")?.dataset.band ?? null,
      verdict: t('[data-slot="verdict"]'),
      halos: [...document.querySelectorAll('li.mm-halo[data-kind="halo"]')].map((n) => n.dataset.signal),
      failos: [...document.querySelectorAll('li.mm-halo[data-kind="failo"]')].map((n) => n.dataset.signal),
      sliders: [...document.querySelectorAll(".mm-slider")].map((n) => `${n.dataset.dim}:${n.dataset.score}@${n.dataset.weight}`),
      profileCollapsed: document.querySelector(".mm-profile")?.dataset.collapsed ?? null,
      footer: t(".mm-foot"),
      status: t("#mm-status"),
    };
  });
  console.log(JSON.stringify(facts, null, 2));
  const record = await sw.evaluate(async (id) => (await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`], tabId);
  check("query sent = address read from the page", record?.request?.address && /17 Young Street/i.test(record.request.address), record?.request);
  check("matched address shown", facts.address === record?.property?.address, facts.address);
  check("listing line names the page address", /^Listing: .*17 Young Street.* · read from the page$/i.test(facts.listing || ""), facts.listing);
  check("mock badge visible", facts.mockBadge);
  check("bed/bath/parking line names its source", /source: basics\/all/.test(facts.facts || ""), facts.facts);
  check("speedo has a fit", facts.fit !== "" && facts.fit !== null, { fit: facts.fit, band: facts.band });
  check("four sliders", facts.sliders.length === 4, facts.sliders);
  check("profile collapsed", facts.profileCollapsed === "true");
  check("footer disclaimer", (facts.footer || "").startsWith("Microburbs estimates, indicative only — not a valuation or financial advice"), facts.footer);
  const badge = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  check("toolbar badge = panel fit", badge === facts.fit, { badge, fit: facts.fit });

  // Screenshots: listing 1080x900 + panel 360x900, composited side by side.
  await listing.bringToFront();
  await listing.setViewportSize({ width: 1080, height: 900 });
  const listingPng = await listing.screenshot();
  await panel.bringToFront();
  const panelPng = await panel.screenshot();
  await panel.screenshot({ path: path.join(SHOTS, "proof-sidepanel-full.png"), fullPage: true });
  const composite = await ctx.newPage();
  await composite.setViewportSize({ width: 1441, height: 900 });
  await composite.setContent(
    `<!doctype html><html><body style="margin:0;display:flex;background:#fff"><img style="width:1080px;height:900px;display:block" src="data:image/png;base64,${listingPng.toString("base64")}"><div style="width:1px;background:#c8c8c8"></div><img style="width:360px;height:900px;display:block" src="data:image/png;base64,${panelPng.toString("base64")}"></body></html>`,
  );
  await composite.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  await composite.screenshot({ path: path.join(SHOTS, "proof-sidepanel-domain-rental.png") });
  await composite.close();
  console.log(`shot ${path.join(SHOTS, "proof-sidepanel-domain-rental.png")}`);

  // 2. the type-it box: ambiguous -> pick a candidate (resends with gnaf_id)
  const typeIt = async (text) => {
    await panel.fill("#mm-typeit-input", text);
    await panel.click('form[data-slot="typeit"] button[type="submit"]');
  };
  await typeIt("ambiguous");
  check("ambiguous state", await waitState("ambiguous"));
  const cands = await panel.$$eval('[data-for="ambiguous"] [data-slot="ambiguous-list"] > li > button', (b) => b.map((x) => x.textContent.trim()));
  check("ambiguous shows candidates", cands.length === 2, cands);
  check("badge ? while ambiguous", (await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId)) === "?");
  await panel.screenshot({ path: path.join(SHOTS, "proof-sidepanel-ambiguous.png") });
  await panel.click('[data-for="ambiguous"] [data-slot="ambiguous-list"] > li:first-child > button');
  check("picked candidate -> matched", await waitState("matched"));
  const picked = await sw.evaluate(async (id) => (await chrome.storage.session.get(`tab:${id}`))[`tab:${id}`], tabId);
  check("pick resent with gnaf_id", picked?.request?.gnaf_id === "GANSW000000001" && picked?.property?.gnaf_id === "GANSW000000001", picked?.request);
  check("pick sends the gnaf_id alone (no address for the backend to re-geocode)", picked?.request?.address === null, picked?.request);
  const pickedLine = await panel.textContent('[data-bind="listing"]');
  check("listing line says the user picked it", /you picked this home/.test(pickedLine || ""), pickedLine);

  // "Not this one?" opens the picker
  await panel.click('[data-action="not-this-one"]');
  const pickerOpen = await panel.evaluate(() => !document.getElementById("mm-picker").hidden && document.querySelector('[data-action="not-this-one"]').getAttribute("aria-expanded") === "true");
  check("Not this one? opens the picker", pickerOpen);

  // 3. out of area, no match
  await typeIt("melbourne");
  check("out_of_area state", await waitState("out_of_area"));
  const oaMsg = await panel.textContent('[data-for="out_of_area"] [data-bind="message"]');
  check("out_of_area message from backend", /City of Sydney/.test(oaMsg || ""), oaMsg);
  await panel.screenshot({ path: path.join(SHOTS, "proof-sidepanel-out_of_area.png") });
  await typeIt("nowhere");
  check("no_match state", await waitState("no_match"));
  await panel.screenshot({ path: path.join(SHOTS, "proof-sidepanel-no_match.png") });

  // 4. backend down -> error, then retry after it is back
  if (backendCmd) {
    await stopBackend();
    check("backend stopped", !(await health()));
    await typeIt("26 Tudor Street, Surry Hills NSW 2010");
    check("error state while the backend is down", await waitState("error", 40000));
    const errText = await panel.textContent('[data-for="error"] [data-bind="error"]');
    check("error message shown", /Could not reach MicroMatch/.test(errText || ""), errText);
    await panel.screenshot({ path: path.join(SHOTS, "proof-sidepanel-error.png") });
    await startBackend();
    await panel.click('[data-for="error"] [data-action="retry"]');
    check("retry after the backend is back -> matched", await waitState("matched", 40000));
    const tl = await panel.textContent('[data-bind="listing"]');
    check("typed address labelled as typed", /typed by you/.test(tl || ""), tl);
  } else {
    console.log("SKIP backend-down check (set MM_BACKEND_CMD to run it)");
  }

  // 5. a search-results page -> empty state
  await listing.goto(SEARCH, { waitUntil: "domcontentloaded" });
  check("search-results page -> empty state", await waitState("empty", 20000));
  const emptyBadge = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  check("badge cleared on the search page", emptyBadge === "", emptyBadge);
  await panel.screenshot({ path: path.join(SHOTS, "proof-sidepanel-empty.png") });

  // 6. back to the listing: matched again, no stale score while loading
  await listing.goto(LISTING, { waitUntil: "domcontentloaded", timeout: 90000 });
  check("back on the listing -> matched again", await waitState("matched", 30000));

  // 6b. an in-page URL change on the listing (pushState): Chrome hides the URL from this extension, so the
  // background sees only status "loading". The panel may show "checking" but must never flash "empty".
  await panel.evaluate(() => {
    window.__mmStates = [];
    const v = document.getElementById("view");
    new MutationObserver(() => window.__mmStates.push(v.dataset.state)).observe(v, { attributes: true, attributeFilter: ["data-state"] });
  });
  await listing.evaluate(() => history.pushState({}, "", `${location.pathname}?mm=1`));
  await sleep(4000);
  const pushStates = await panel.evaluate(() => window.__mmStates);
  const afterPush = await panel.getAttribute("#view", "data-state");
  check("pushState on the listing: no empty flash, back to matched", !pushStates.includes("empty") && afterPush === "matched", { pushStates, afterPush });

  // 7. the quiz saves a profile -> the panel re-scores (the onboarding page's quiz shape)
  const fitBefore = await panel.getAttribute(".mm-speedo", "data-fit");
  await sw.evaluate(() =>
    chrome.storage.local.set({
      profile: { version: 1, buyer_type: "first_home", budget_max: 1300000, household: "couple", min_bedrooms: 2, vibe: "buzzing", commute_modes: ["walk", "train"], must_haves: ["near_transport"], weights: { lifestyle: 40, price: 35, safety: 25 } },
    }),
  );
  const moved = await panel
    .waitForFunction((before) => {
      const s = document.querySelector(".mm-speedo");
      return document.querySelector("#view").dataset.state === "matched" && s && s.dataset.fit !== "" && s.dataset.fit !== before ? s.dataset.fit : false;
    }, fitBefore, { timeout: 20000 })
    .then((h) => h.jsonValue(), () => null);
  const summary = await panel.textContent(".mm-profile__summary").catch(() => null);
  check("saved quiz profile re-scores the home", moved !== null, { before: fitBefore, after: moved, summary });
  await sleep(1200);
  const badgeAfter = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  check("badge follows the new profile", badgeAfter === moved, { badgeAfter, fit: moved });

  check("no panel page errors", panelErrors.length === 0, panelErrors.slice(0, 5));
  check("no service worker console errors", swErrors.length === 0, swErrors.slice(0, 5));
}

try {
  await main();
} catch (error) {
  failures += 1;
  console.log(`FAIL crashed: ${error?.stack || error}`);
} finally {
  if (ctx) await ctx.close().catch(() => {});
  await stopBackend();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  console.log(failures ? `${failures} check(s) failed` : "ALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}
