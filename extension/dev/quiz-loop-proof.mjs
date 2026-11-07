// Dev-only proof of the REAL loop, end to end, with no direct storage writes:
//   sign up on the website (:3001) -> take the quiz -> dashboard posts the saved profile ->
//   extension/src/site-bridge.js -> chrome.storage.local.profile -> side panel fit for a listing.
// Run twice with two accounts and clearly different answers; the fit must change.
// chrome.storage is only READ (through the service worker) to verify what the bridge stored.
// Needs run.sh up: proxy :3000, Django :8001, website :3001.
// Usage: node extension/dev/quiz-loop-proof.mjs [--headless]
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const EXT = path.join(ROOT, "extension");
const { chromium } = createRequire(path.join(ROOT, "tools", "package.json"))("playwright");
const HEADED = !process.argv.includes("--headless");
const SITE = "http://localhost:3001";
const ADDRESS = "401/2 Victoria Park Parade, Zetland";
const HOST = "https://www.domain.com.au/59-portman-street-zetland-nsw-2017-17904853";
const SNAP = "20251219094851";
const SHOTS = path.join(ROOT, "tools", "shots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();

// A: first-home renter, every dollar counts, office commute by train. B: downsizing buyer with a
// big budget who wants culture, food and an "always buzzing" street. Labels are the quiz's own.
const RUNS = {
  A: {
    name: "Ava", email: `microscope+${stamp}-a@example.com`,
    story: ["My first place", "An office job", "Every dollar counts", "Train, bus or ferry", "Getting there fast",
      "Out of the area", "The repayments", "Go smaller", "Sensible money"],
    mode: "rent", budget: "$550", income: "$1,200", address: "188 Pitt Street, Sydney",
  },
  B: {
    name: "Ben", email: `microscope+${stamp}-b@example.com`,
    story: ["Slowing down or downsizing", "Being too far from things", "Culture and good food", "On foot or by bike",
      "Ten minutes on foot", "Cafes and markets", "Always buzzing", "Paying too much", "Love matters more", "Feeling at home"],
    mode: "buy", budget: "$3,000,000", income: "", address: "",
  },
};
const PASSWORD = "microscope-proof-2026";

async function waitUp(url, label) {
  for (let i = 0; i < 300; i++) {
    if (await fetch(url, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false)) return;
    if (i % 15 === 0) console.log(`waiting for ${label} (${url})…`);
    await sleep(2000);
  }
  console.error(`${label} never answered at ${url}`);
  process.exit(1);
}
await waitUp("http://127.0.0.1:3000/health", "proxy");
await waitUp("http://localhost:8001/api/health", "Django");
await waitUp(SITE, "website");

const dir = path.join(os.tmpdir(), "mbx-e2e-archive");
const hit = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.startsWith(`${SNAP}id_`) && f.includes("59_portman"));
const html = hit ? fs.readFileSync(path.join(dir, hit), "utf8")
  : await (await fetch(`https://web.archive.org/web/${SNAP}id_/${HOST}`, { signal: AbortSignal.timeout(45000) })).text();

fs.mkdirSync(SHOTS, { recursive: true });
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "mm-quiz-loop-")), {
  headless: !HEADED, ...(HEADED ? {} : { channel: "chromium" }),
  viewport: { width: 1180, height: 900 },
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
const readProfile = async () => (await sw.evaluate(() => chrome.storage.local.get("profile"))).profile ?? null;

// The listing tab the panel is attached to (the real archived Domain listing).
const listing = ctx.pages()[0] || (await ctx.newPage());
await listing.goto(HOST, { waitUntil: "domcontentloaded", timeout: 60000 });
let tabId = null;
for (let i = 0; i < 80 && !tabId; i++) {
  tabId = await sw.evaluate(async () => {
    const all = await chrome.storage.session.get(null);
    const k = Object.keys(all).find((key) => key.startsWith("tab:"));
    return k ? Number(k.slice(4)) : null;
  });
  if (!tabId) await sleep(250);
}
const site = await ctx.newPage();

async function signUpAndTakeQuiz(run) {
  await site.goto(`${SITE}/login`, { waitUntil: "domcontentloaded" });
  await site.fill('input[name="name"]', run.name);
  await site.fill('input[name="email"]', run.email);
  await site.fill('input[name="password"]', PASSWORD);
  await site.getByRole("button", { name: "Create my account" }).click();
  await site.waitForURL(/\/dashboard/, { timeout: 30000 });
  await site.goto(`${SITE}/quiz`, { waitUntil: "domcontentloaded" });
  await site.getByRole("button", { name: "Start my story" }).click({ timeout: 30000 });
  for (const label of run.story) await site.getByRole("button", { name: label, exact: true }).click({ timeout: 15000 });
  if (run.mode === "rent") await site.getByRole("button", { name: "I'm renting" }).click();
  await site.fill('input[name="budget"]', run.budget);
  if (run.income) await site.fill('input[name="income"]', run.income);
  if (run.address) await site.fill('input[name="address"]', run.address);
  await site.getByRole("button", { name: "Save my profile" }).click();
  await site.getByRole("button", { name: "That sounds like me" }).waitFor({ timeout: 30000 });
  const archetype = (await site.locator("h1").first().textContent().catch(() => "")) || "";
  await site.getByRole("button", { name: "That sounds like me" }).click();
  await site.getByRole("link", { name: "Go to my dashboard" }).click({ timeout: 15000 });
  await site.waitForURL(/\/dashboard/, { timeout: 30000 });
  await site.getByRole("button", { name: "Log out" }).waitFor({ timeout: 30000 });
  // The dashboard posts {...extension_profile, metricWeights} through the bridge; wait for it.
  let profile = null;
  for (let i = 0; i < 60; i++) {
    profile = await readProfile();
    if (profile && profile.metricWeights) break;
    await sleep(250);
  }
  return { profile, archetype: archetype.replace(/\s+/g, " ").trim() };
}

async function fitFor(shotName) {
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html?tabId=${tabId}`);
  await panel.waitForSelector("#mm-typeit-input", { timeout: 30000 });
  await panel.fill("#mm-typeit-input", ADDRESS);
  await panel.press("#mm-typeit-input", "Enter");
  await panel.waitForFunction(() => document.querySelector("#view")?.dataset.state === "matched"
    && /victoria park parade/i.test(document.querySelector('[data-bind="address"]')?.textContent || ""), null, { timeout: 60000 })
    .catch(async () => console.error("panel did not reach matched:", await panel.evaluate(() => document.querySelector("#view")?.dataset.state)));
  const readFit = () => panel.evaluate(() => document.querySelector(".mm-speedo")?.dataset.fit ?? document.querySelector("[data-fit]")?.dataset.fit ?? null);
  let fit = null; let same = 0;
  for (let i = 0; i < 50 && same < 6; i++) { // settle: same fit for ~3 s while live signals arrive
    await sleep(500);
    const now = await readFit();
    same = now !== null && now === fit ? same + 1 : 0;
    fit = now;
  }
  const seen = await panel.evaluate(() => {
    const text = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
    return {
      matched: text(document.querySelector('[data-bind="address"]')),
      profileLine: text(document.querySelector(".mm-profile__text")),
      profileTag: document.querySelector(".mm-profile__tag:not([hidden])") ? text(document.querySelector(".mm-profile__tag")) : "",
    };
  });
  await panel.screenshot({ path: path.join(SHOTS, shotName), fullPage: true });
  await panel.close();
  return { fit: fit === null ? null : Number(fit), ...seen, screenshot: path.join(SHOTS, shotName) };
}

const before = await readProfile();
const a = await signUpAndTakeQuiz(RUNS.A);
console.log("profile A keys:", a.profile && Object.keys(a.profile));
const panelA = await fitFor("proof-quiz-A.png");
console.log("A:", JSON.stringify(panelA));

await site.getByRole("button", { name: "Log out" }).click();
await site.waitForURL((u) => new URL(u).pathname === "/", { timeout: 30000 }).catch(() => undefined);
let cleared = false;
for (let i = 0; i < 40 && !cleared; i++) { cleared = (await readProfile()) === null; if (!cleared) await sleep(250); }

const b = await signUpAndTakeQuiz(RUNS.B);
console.log("profile B keys:", b.profile && Object.keys(b.profile));
const panelB = await fitFor("proof-quiz-B.png");
console.log("B:", JSON.stringify(panelB));
await ctx.close();

const summary = {
  address: ADDRESS,
  profileBeforeSignup: before,
  fitA: panelA.fit, fitB: panelB.fit,
  profileA: { keys: a.profile && Object.keys(a.profile), metricWeights: a.profile?.metricWeights, archetype: a.archetype, panelLine: panelA.profileLine, tag: panelA.profileTag, matched: panelA.matched },
  profileClearedOnLogout: cleared,
  profileB: { keys: b.profile && Object.keys(b.profile), metricWeights: b.profile?.metricWeights, archetype: b.archetype, panelLine: panelB.profileLine, tag: panelB.profileTag, matched: panelB.matched },
  screenshots: [panelA.screenshot, panelB.screenshot],
};
console.log(JSON.stringify(summary, null, 1));
if (!a.profile || !b.profile) { console.error("FAIL: the quiz profile never reached chrome.storage.local.profile"); process.exit(1); }
if (summary.fitA === null || summary.fitB === null) { console.error("FAIL: a fit is missing"); process.exit(1); }
if (summary.fitA === summary.fitB) { console.error("FAIL: both accounts got the same fit"); process.exit(1); }
console.log(`PASS: fit A ${summary.fitA} vs fit B ${summary.fitB} from two accounts' own quiz weights`);
