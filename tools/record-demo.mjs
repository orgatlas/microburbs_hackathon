// Records the 3-minute demo (docs/PITCH.md storyboard) in headed Chromium with the unpacked
// extension on ONE home, 59 Portman Street, Zetland: the content script reads the address from the
// page itself (no typing). Left = listing/website (1560x1080), right = side panel (360x1080).
// Captions are drawn into the page (burned into the frames) and use the numbers the panel shows.
// Needs run.sh (proxy :3000, Django :8001, website :3001). Output: tools/shots/demo-raw/*.webm + beats.json
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXT = path.join(ROOT, "extension");
const OUT = path.join(ROOT, "tools", "shots", "demo-raw");
const { chromium } = createRequire(path.join(ROOT, "tools", "package.json"))("playwright");
const SITE = "http://localhost:3001";
const HOST = "https://www.domain.com.au/59-portman-street-zetland-nsw-2017-17904853";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();
const PASSWORD = "microscope-demo-2026";

const dir = path.join(os.tmpdir(), "mbx-e2e-archive");
const html = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => f.includes("59_portman"))), "utf8");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "mm-demo-")), {
  headless: false,
  viewport: { width: 1560, height: 1080 },
  recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--window-size=1600,1200"],
});
await ctx.route("**/*", (route) => {
  const req = route.request(); const url = req.url();
  if (!/^https?:/.test(url) || ["localhost", "127.0.0.1"].includes(new URL(url).hostname)) return route.continue();
  if (url.split("#")[0].replace(/\/$/, "") === HOST) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
  return ["script", "xhr", "fetch"].includes(req.resourceType()) ? route.abort() : route.continue();
});
const left = ctx.pages()[0] || (await ctx.newPage());
const leftStart = Date.now();
const panel = await ctx.newPage();
const panelStart = Date.now();
await panel.setViewportSize({ width: 360, height: 1080 });
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 20000 }));
const extId = new URL(sw.url()).host;

// ---- captions burned into the left page, re-applied after every navigation ----
let caption = "";
const beats = [];
const capCss = { position: "fixed", left: "0", right: "0", bottom: "0", padding: "18px 40px", background: "rgba(16,18,20,.86)",
  color: "#fff", font: "600 27px/1.38 system-ui,-apple-system,'Segoe UI',sans-serif", zIndex: "2147483647", textAlign: "center" };
async function paint() {
  await left.evaluate(([text, css]) => {
    let el = document.getElementById("__demo_cap");
    if (!el) { el = document.createElement("div"); el.id = "__demo_cap"; Object.assign(el.style, css); document.documentElement.appendChild(el); }
    if (el.textContent !== text) el.textContent = text;
    el.style.display = text ? "block" : "none";
  }, [caption, capCss]).catch(() => {});
}
const painter = setInterval(paint, 300);
function beat(text) { caption = text; beats.push({ t: (Date.now() - leftStart) / 1000, text }); paint(); }
async function until(sec) { const wait = leftStart + sec * 1000 - Date.now(); if (wait > 0) await sleep(wait); }

const typeSlow = (page, sel, text) => page.locator(sel).pressSequentially(text, { delay: 45 });
async function answer(labels) {
  for (const label of [].concat(labels)) {
    const b = left.getByRole("button", { name: label, exact: true });
    if (await b.isVisible({ timeout: 2500 }).catch(() => false)) { await b.click(); return; }
  }
  throw new Error(`no quiz answer among ${labels}`);
}
async function quiz(run, pace) {
  await left.goto(`${SITE}/quiz`, { waitUntil: "domcontentloaded" });
  await left.getByRole("button", { name: "Start my story" }).click({ timeout: 30000 });
  for (const labels of run.story) { await sleep(pace); await answer(labels); }
  await sleep(pace);
  if (run.mode === "rent") await left.getByRole("button", { name: "I'm renting" }).click();
  await typeSlow(left, 'input[name="budget"]', run.budget);
  if (run.income) await typeSlow(left, 'input[name="income"]', run.income);
  if (run.address) await typeSlow(left, 'input[name="address"]', run.address);
  await sleep(pace);
  await left.getByRole("button", { name: "Save my profile" }).click();
  await left.getByRole("button", { name: "That sounds like me" }).waitFor({ timeout: 30000 });
  await sleep(pace * 2);
  await left.getByRole("button", { name: "That sounds like me" }).click();
  await left.getByRole("link", { name: "Go to my dashboard" }).click({ timeout: 15000 });
  await left.waitForURL(/\/dashboard/, { timeout: 30000 });
  for (let i = 0; i < 60; i++) { if ((await sw.evaluate(() => chrome.storage.local.get("profile"))).profile?.metricWeights) break; await sleep(250); }
}
async function signUp(name, email) {
  await left.goto(`${SITE}/login`, { waitUntil: "domcontentloaded" });
  await typeSlow(left, 'input[name="name"]', name);
  await typeSlow(left, 'input[name="email"]', email);
  await left.fill('input[name="password"]', PASSWORD);
  await left.getByRole("button", { name: "Create my account" }).click();
  await left.waitForURL(/\/dashboard/, { timeout: 30000 });
}
const panelText = () => panel.evaluate(() => (document.querySelector("#view")?.innerText || "").replace(/\s+/g, " ")).catch(() => "");
// The needle is read only once the panel says "Scored for <name>" and the fit has held for 2 s,
// so the end card always matches what is on screen.
async function stableFitFor(name) {
  let last = null, same = 0;
  for (let i = 0; i < 160; i++) {
    const [f, text] = await Promise.all([
      panel.evaluate(() => document.querySelector("[data-fit]")?.dataset.fit ?? null).catch(() => null),
      panelText(),
    ]);
    const ok = f && f !== "null" && text.includes(`Scored for ${name}`);
    if (ok && f === last) { same += 1; if (same >= 8) return f; } else { same = 0; }
    last = ok ? f : null;
    await sleep(250);
  }
  return last;
}
async function factLine(re) {
  const lines = await panel.evaluate(() => [...document.querySelectorAll(".mbx-fit__fact-main")].map((e) => e.textContent.replace(/\s+/g, " ").trim())).catch(() => []);
  return lines.find((l) => re.test(l)) || null;
}

// ---------------- the storyboard (same beats as docs/PITCH.md) ----------------
beat("Sarah · 19 · casual retail · about $600 a week. Fresh install: MicroMatch reads only the listing's address.");
await left.goto(HOST, { waitUntil: "domcontentloaded", timeout: 60000 });
let tabId = null;
for (let i = 0; i < 80 && !tabId; i++) {
  tabId = await sw.evaluate(async (u) => {
    const all = await chrome.storage.session.get(null);
    for (const [k, v] of Object.entries(all)) if (k.startsWith("tab:") && typeof v?.pageUrl === "string" && v.pageUrl.startsWith(u)) return Number(k.slice(4));
    return null;
  }, HOST);
  if (!tabId) await sleep(200);
}
await panel.goto(`chrome-extension://${extId}/sidepanel/index.html?tabId=${tabId}`);
await panel.waitForFunction(() => document.querySelector("#view")?.dataset.state === "matched", null, { timeout: 30000 }).catch(() => {});
const matchedName = await panel.evaluate(() => document.querySelector('[data-bind="address"]')?.textContent?.trim() || "").catch(() => "");
const exact = /exact match/i.test(await panelText());
await until(12);
beat(`Read from the page: ${matchedName}${exact ? " (Exact match)" : ""}. No profile yet, so no score: take the quiz.`);
await until(24);

beat("Sarah signs up on our website. Her account saves her quiz answers so the extension can use her own priorities.");
await signUp("Sarah", `microscope+${stamp}-sarah@example.com`);
await until(36);
beat("First place, shift work, every dollar counts, public transport: each answer changes what matters to her.");
await quiz({
  story: [["My first place"], ["Shifts at odd hours", "An office job"], ["Every dollar counts"], ["Train, bus or ferry"],
    ["A stop close to home", "Getting there fast"], ["Out of the area"], ["The repayments"], ["Go smaller"], ["Sensible money"]],
  mode: "rent", budget: "$250", income: "$600", address: "Broadway, Ultimo NSW",
}, 1700);
beat("Rent, a $250 budget, $600 a week income and her workplace: saved. These weights come from her answers, not a default.");
await until(86);

beat("Back on the listing. The panel loads Sarah's saved profile and the needle settles on her fit.");
await left.goto(HOST, { waitUntil: "domcontentloaded", timeout: 60000 });
const sarahFit = await stableFitFor("Sarah");
const rentLine = (await factLine(/^Rent · /)) || "";
const rentMatch = /\$([\d,]+)\/wk · (\d+)% of income/.exec(rentLine);
const rent = rentMatch ? rentMatch[1] : null;
const pct = rentMatch ? rentMatch[2] : null;
const destLine = (await factLine(/^Your destination/)) || "";
const busLine = (await factLine(/^(Bus|Train|Light rail|Ferry) · /)) || "";
await until(102);
const destKm = (/· ([\d.]+ km) to/.exec(destLine) || [])[1];
beat(`Commute: ${[destKm ? `${destKm} to work` : null, busLine ? busLine.replace(" · ", " ") : null].filter(Boolean).join(", ") || "distance to work and transport"}. Straight-line distances; minutes marked est. are estimates. Sources sit under each fact.`);
await panel.evaluate(() => { const d = [...document.querySelectorAll("details")].find((x) => /commute/i.test(x.querySelector("summary")?.textContent || "")); if (d) { d.open = true; d.scrollIntoView({ block: "center", behavior: "smooth" }); } });
await until(118);
beat(rent && pct ? `Cons: $${rent} a week rent is ${pct}% of Sarah's $600 income. A nearby bus doesn't erase that trade-off.`
  : "Cons: the rent line shows what share of Sarah's $600 income this home would take.");
await panel.evaluate(() => { const c = [...document.querySelectorAll("*")].find((x) => x.children.length === 0 && /^Cons$/.test(x.textContent.trim())); (c || document.body).scrollIntoView({ block: "start", behavior: "smooth" }); });
await until(136);

beat("Sign out. Second persona: Alex, a buyer with different priorities, takes the quiz.");
await left.goto(`${SITE}/dashboard`, { waitUntil: "domcontentloaded" });
await left.getByRole("button", { name: "Log out" }).click({ timeout: 15000 });
await sleep(800);
await signUp("Alex", `microscope+${stamp}-alex@example.com`);
await quiz({
  story: [["Slowing down or downsizing"], ["Being too far from things"], ["Culture and good food"], ["On foot or by bike"],
    ["Ten minutes on foot"], ["Cafes and markets"], ["Always buzzing"], ["Paying too much"], ["Love matters more"], ["Feeling at home"]],
  mode: "buy", budget: "$3,000,000", income: "", address: "",
}, 450);
beat("Same home, different person: Alex's saved profile gives a different needle. The facts didn't change; the priorities did.");
await left.goto(HOST, { waitUntil: "domcontentloaded", timeout: 60000 });
await panel.evaluate(() => document.scrollingElement?.scrollTo({ top: 0, behavior: "smooth" }));
const alexFit = await stableFitFor("Alex");
await sleep(5000);
beat(`${rent && pct ? `For Sarah, rent is ${pct}% of her weekly income ($${rent} ÷ $600). ` : ""}Same home: Sarah ${sarahFit} · Alex ${alexFit}. MicroMatch by team Microscope.`);
await sleep(9000);

clearInterval(painter);
const end = (Date.now() - leftStart) / 1000;
await ctx.close();
const leftVideo = await left.video().path();
const panelVideo = await panel.video().path();
const summary = { end, matchedName, exact, sarahFit, alexFit, rent, pct, destLine, busLine, leftVideo, panelVideo, panelOffset: (panelStart - leftStart) / 1000 };
fs.writeFileSync(path.join(OUT, "beats.json"), JSON.stringify({ ...summary, beats }, null, 1));
console.log(JSON.stringify(summary));
