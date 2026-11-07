// MicroMatch side panel: the profile the fit score is weighed against (README Contract 1).
//
//   SARAH                      the default profile, verbatim from README Contract 1 (frozen)
//   loadProfile()              chrome.storage.local "profile" -> normalised profile; missing -> SARAH + isDefault:true
//   normalizeProfile(raw)      README shape passes through (invalid fields dropped); the backend quiz shape
//                              (docs/API_CONTRACT.md, POST /api/match "profile") converts, marked converted:true
//   watchProfile(cb)           calls cb(normalisedProfile) whenever onboarding saves a new profile; returns unsubscribe
//   profileSummary(profile)    "Scored for Sarah · renting · up to $250/wk · income $600/wk"
//   openOnboarding()           opens extension/onboarding/index.html in a new tab
//   renderProfile(container, profile, { onOpenOnboarding }) -> { update(profile), el }
//
// This file only READS the profile. Onboarding owns writing it. Nothing here sends anything anywhere.
// DOM is built with createElement/textContent only.

const STORAGE_KEY = "profile";
const STORAGE_TIMEOUT_MS = 2000;
const DIMS = ["commute", "safety", "lifestyle", "price"];
const DIM_LABELS = { commute: "Commute", safety: "Safety", lifestyle: "Lifestyle", price: "Price" };
const QUIZ_DIMS = ["lifestyle", "price", "safety"];
const QUIZ_KEYS = ["buyer_type", "budget_max", "household", "min_bedrooms", "vibe", "commute_modes", "must_haves"];
// The quiz has no commute question, so a converted quiz profile gets a fixed commute weight and the
// quiz's lifestyle/price/safety points share the rest in their own proportions.
const QUIZ_COMMUTE_WEIGHT = 0.25;
const DOT = " · ";

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
}

export const SARAH = deepFreeze({
  name: "Sarah",
  mode: "rent",
  budgetWeekly: 250,
  incomeWeekly: 600,
  workAddress: "Broadway, Ultimo NSW",
  weights: { commute: 0.35, safety: 0.25, lifestyle: 0.15, price: 0.25 },
});

function sarahDefault() {
  return { ...SARAH, weights: { ...SARAH.weights }, isDefault: true };
}

/* ---------- validation ---------- */

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

function positiveNumber(v) {
  if (typeof v === "string" && /^\s*\d+(\.\d+)?\s*$/.test(v)) v = Number(v);
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

function cleanText(v, max) {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : undefined;
}

const tidy = (x) => Math.round(x * 1e12) / 1e12; // strip float noise only

// Non-negative finite numbers per key (anything else counts as 0), scaled to sum to 1.
// Weights that already sum to 1 pass through untouched. Returns undefined when nothing usable.
function normalizeWeights(raw, keys) {
  if (!isObj(raw)) return undefined;
  const out = {};
  let total = 0;
  for (const k of keys) {
    let v = raw[k];
    if (typeof v === "string" && v.trim() !== "") v = Number(v);
    const ok = typeof v === "number" && Number.isFinite(v) && v >= 0;
    out[k] = ok ? v : 0;
    total += out[k];
  }
  if (!(total > 0)) return undefined;
  if (Math.abs(total - 1) <= 1e-6) return out;
  for (const k of keys) out[k] = tidy(out[k] / total);
  return out;
}

function equalWeights() {
  return Object.fromEntries(DIMS.map((k) => [k, 1 / DIMS.length]));
}

function isQuizShape(raw) {
  if (raw.mode !== undefined) return false;
  if (QUIZ_KEYS.some((k) => raw[k] !== undefined)) return true;
  return raw.version !== undefined && isObj(raw.weights) && raw.weights.commute === undefined;
}

function cleanQuiz(raw) {
  const q = {};
  if (Number.isInteger(raw.version)) q.version = raw.version;
  for (const k of ["buyer_type", "household", "vibe"]) {
    const s = cleanText(raw[k], 40);
    if (s) q[k] = s;
  }
  const budget = positiveNumber(raw.budget_max);
  if (budget !== undefined) q.budget_max = budget;
  const beds = positiveNumber(raw.min_bedrooms);
  if (beds !== undefined) q.min_bedrooms = beds;
  for (const k of ["commute_modes", "must_haves"]) {
    if (Array.isArray(raw[k])) q[k] = raw[k].filter((x) => typeof x === "string" && x.length <= 40);
  }
  if (isObj(raw.weights)) {
    const w = {};
    for (const k of QUIZ_DIMS) {
      const n = Number(raw.weights[k]);
      if (Number.isFinite(n) && n >= 0) w[k] = n;
    }
    q.weights = w;
  }
  return q;
}

function fromQuiz(raw) {
  const p = { mode: "buy" };
  const budget = positiveNumber(raw.budget_max);
  if (budget !== undefined) p.budgetPrice = budget;
  const qw = normalizeWeights(raw.weights, QUIZ_DIMS) || { lifestyle: 1 / 3, price: 1 / 3, safety: 1 / 3 };
  const rest = 1 - QUIZ_COMMUTE_WEIGHT;
  p.weights = {
    commute: QUIZ_COMMUTE_WEIGHT,
    safety: tidy(rest * qw.safety),
    lifestyle: tidy(rest * qw.lifestyle),
    price: tidy(rest * qw.price),
  };
  // Flags the quiz answers imply. Absent flag = README "weighted at half".
  if (Array.isArray(raw.commute_modes) && raw.commute_modes.length) p.hasCar = raw.commute_modes.includes("car");
  if (raw.vibe === "buzzing") p.nightlife = true;
  else if (raw.vibe === "quiet") p.nightlife = false;
  p.quiz = cleanQuiz(raw); // original answers, for anything that forwards them to POST /api/match
  p.converted = true;
  return p;
}

function fromReadme(raw) {
  const p = {};
  let found = 0;
  const name = cleanText(raw.name, 40);
  if (name) (p.name = name), found++;
  const budgetWeekly = positiveNumber(raw.budgetWeekly);
  const budgetPrice = positiveNumber(raw.budgetPrice);
  let mode = raw.mode === "rent" || raw.mode === "buy" ? raw.mode : undefined;
  if (mode) found++;
  else mode = budgetPrice !== undefined && budgetWeekly === undefined ? "buy" : "rent";
  p.mode = mode;
  if (mode === "rent" && budgetWeekly !== undefined) (p.budgetWeekly = budgetWeekly), found++;
  if (mode === "buy" && budgetPrice !== undefined) (p.budgetPrice = budgetPrice), found++;
  const income = positiveNumber(raw.incomeWeekly);
  if (income !== undefined) (p.incomeWeekly = income), found++;
  const work = cleanText(raw.workAddress, 200);
  if (work) (p.workAddress = work), found++;
  const weights = normalizeWeights(raw.weights, DIMS);
  if (weights) found++;
  p.weights = weights || equalWeights();
  for (const flag of ["hasCar", "nightlife"]) {
    if (typeof raw[flag] === "boolean") (p[flag] = raw[flag]), found++;
  }
  if (isObj(raw.metricWeights)) p.metricWeights = raw.metricWeights;
  // Keep our own flags so normalizeProfile(normalizeProfile(x)) is stable.
  if (raw.converted === true) {
    p.converted = true;
    if (isObj(raw.quiz)) p.quiz = cleanQuiz(raw.quiz);
  }
  if (raw.isDefault === true) p.isDefault = true;
  return found ? p : sarahDefault(); // nothing recognisable: treat as no profile
}

export function normalizeProfile(raw) {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  if (!isObj(raw)) return sarahDefault();
  return isQuizShape(raw) ? fromQuiz(raw) : fromReadme(raw);
}

/* ---------- chrome.* ---------- */

function storageArea() {
  try {
    return globalThis.chrome?.storage?.local || null;
  } catch {
    return null;
  }
}

export async function loadProfile() {
  const area = storageArea();
  let raw;
  if (area) {
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("storage timeout")), STORAGE_TIMEOUT_MS);
      });
      const got = await Promise.race([area.get(STORAGE_KEY), timeout]);
      raw = got ? got[STORAGE_KEY] : undefined;
    } catch (err) {
      console.warn("[MicroMatch] could not read the profile, using the Sarah example", err);
    } finally {
      clearTimeout(timer);
    }
  }
  return normalizeProfile(raw);
}

export function watchProfile(callback) {
  const onChanged = globalThis.chrome?.storage?.onChanged;
  if (!onChanged || typeof callback !== "function") return () => {};
  const listener = (changes, areaName) => {
    if (areaName === "local" && changes && Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) {
      callback(normalizeProfile(changes[STORAGE_KEY].newValue));
    }
  };
  onChanged.addListener(listener);
  return () => onChanged.removeListener(listener);
}

export function openOnboarding() {
  const path = "onboarding/index.html";
  const c = globalThis.chrome;
  try {
    if (c?.tabs?.create && c?.runtime?.getURL) return c.tabs.create({ url: c.runtime.getURL(path) });
  } catch (err) {
    console.warn("[MicroMatch] could not open the quiz tab", err);
  }
  // Outside the extension (preview pages): sidepanel/ and onboarding/ are siblings.
  globalThis.open?.(new URL(`../${path}`, import.meta.url).href, "_blank", "noopener");
  return Promise.resolve();
}

/* ---------- formatting ---------- */

const whole = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });

function weekly(n) {
  return `$${whole.format(n)}/wk`;
}

function shortPrice(n) {
  const k = Math.round(n / 1e3);
  if (k >= 1000) return `$${Number((n / 1e6).toFixed(2))}m`;
  if (n >= 1e3) return `$${k}k`;
  return `$${whole.format(n)}`;
}

export function profileSummary(profile) {
  const p = profile || SARAH;
  const parts = [`Scored for ${p.name || "you"}`];
  if (p.mode === "buy") {
    parts.push("buying");
    if (p.budgetPrice) parts.push(`up to ${shortPrice(p.budgetPrice)}`);
  } else {
    parts.push("renting");
    if (p.budgetWeekly) parts.push(`up to ${weekly(p.budgetWeekly)}`);
  }
  if (p.incomeWeekly) parts.push(`income ${weekly(p.incomeWeekly)}`);
  return parts.join(DOT);
}

// Whole percentages that always add up to 100 (largest remainder).
export function weightPercentages(weights) {
  const vals = DIMS.map((k) => {
    const n = Number(weights && weights[k]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
  const total = vals.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return Object.fromEntries(DIMS.map((k) => [k, 0]));
  const scaled = vals.map((v) => Math.round(((v * 100) / total) * 1e9) / 1e9);
  const pct = scaled.map(Math.floor);
  const left = 100 - pct.reduce((a, b) => a + b, 0);
  scaled
    .map((v, i) => [v - pct[i], i])
    .sort((a, b) => b[0] - a[0])
    .slice(0, left)
    .forEach(([, i]) => pct[i]++);
  return Object.fromEntries(DIMS.map((k, i) => [k, pct[i]]));
}

/* ---------- DOM ---------- */

const CSS = `
.mm-profile{border:1px solid var(--mm-hairline,rgba(0,0,0,.08));border-radius:var(--mm-radius,10px);background:var(--mm-bg,#fff);color:var(--mm-ink,#18191b);font-family:var(--mm-font,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif);font-size:13px;line-height:1.45;font-variant-numeric:tabular-nums}
.mm-profile *{box-sizing:border-box}
.mm-profile__bar{display:flex;align-items:center;gap:2px;padding:3px 4px 3px 3px}
.mm-profile__toggle{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:8px;margin:0;padding:7px 8px 7px 9px;border:0;border-radius:8px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mm-profile__toggle:hover{background:var(--mm-accent-tint,#ecf8f6)}
.mm-profile__text{flex:1 1 auto;min-width:0}
.mm-profile__tag{display:inline-block;margin-left:6px;font-size:11px;line-height:16px;padding:0 6px;border:1px solid var(--mm-hairline,rgba(0,0,0,.08));border-radius:999px;color:var(--mm-muted,#62666d);vertical-align:1px}
.mm-profile__tag[hidden]{display:none}
.mm-profile__chevron{flex:none;width:14px;height:14px;color:var(--mm-muted,#62666d);transition:transform .15s ease}
.mm-profile[data-collapsed="false"] .mm-profile__chevron{transform:rotate(180deg)}
.mm-profile__gear{flex:none;display:inline-grid;place-items:center;width:32px;height:32px;margin:0;padding:0;border:0;border-radius:8px;background:none;color:var(--mm-muted,#62666d);cursor:pointer}
.mm-profile__gear:hover{background:var(--mm-accent-tint,#ecf8f6);color:var(--mm-ink,#18191b)}
.mm-profile__gear svg{width:16px;height:16px}
.mm-profile button:focus-visible{outline:2px solid var(--mm-accent,#009485);outline-offset:1px}
.mm-profile__details{padding:2px 12px 12px;border-top:1px solid var(--mm-hairline,rgba(0,0,0,.08))}
.mm-profile__details[hidden]{display:none}
.mm-profile__note{margin:10px 0 0;padding:8px 10px;border-radius:8px;background:var(--mm-accent-tint,#ecf8f6);color:var(--mm-ink,#18191b)}
.mm-profile__aside{margin:10px 0 0;color:var(--mm-muted,#62666d)}
.mm-profile__facts{display:grid;grid-template-columns:104px 1fr;gap:4px 8px;margin:10px 0 0}
.mm-profile__facts dt{color:var(--mm-muted,#62666d)}
.mm-profile__facts dd{margin:0;min-width:0;overflow-wrap:anywhere}
.mm-profile__label{margin:12px 0 6px;font-size:12px;color:var(--mm-muted,#62666d)}
.mm-profile__weights{list-style:none;margin:0;padding:0;display:grid;gap:5px}
.mm-profile__weight{display:grid;grid-template-columns:104px 1fr 34px;align-items:center;gap:8px}
.mm-profile__track{height:4px;border-radius:2px;background:var(--mm-hairline,rgba(0,0,0,.08));overflow:hidden}
.mm-profile__fill{display:block;height:100%;border-radius:inherit;background:var(--mm-muted,#62666d)}
.mm-profile__pct{text-align:right}
.mm-profile__retake{display:inline-block;margin:12px 0 0;padding:0;border:0;background:none;color:var(--mm-accent,#009485);font:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
@media (prefers-reduced-motion:reduce){.mm-profile__chevron{transition:none}}
`;

function injectCss() {
  if (typeof document === "undefined" || document.getElementById("mm-css-profile")) return;
  const style = document.createElement("style");
  style.id = "mm-css-profile";
  style.textContent = CSS;
  document.head.append(style);
}

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
// Feather "settings" and "chevron-down" (MIT): static paths, no data.
const GEAR_PATH =
  "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z";

function icon(className, parts) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (className) svg.setAttribute("class", className);
  for (const [tag, attrs] of parts) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  }
  return svg;
}

function flagText(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Not set (half weight)";
}

function budgetText(p) {
  if (p.mode === "buy") return p.budgetPrice ? `Up to $${whole.format(p.budgetPrice)}` : "Not set";
  return p.budgetWeekly ? `Up to ${weekly(p.budgetWeekly)} rent` : "Not set";
}

function buildDetails(p, open) {
  const kids = [];
  if (p.isDefault) kids.push(h("p", "mm-profile__note", "Example profile. Take the quiz to make it yours."));
  if (p.converted) {
    kids.push(
      h("p", "mm-profile__aside", `From your quiz answers. The quiz has no commute question, so commute is set to ${Math.round(QUIZ_COMMUTE_WEIGHT * 100)}%.`),
    );
  }

  const facts = h("dl", "mm-profile__facts");
  const rows = [
    ["Work", p.workAddress || "Not set"],
    ["Budget", budgetText(p)],
    ["Income", p.incomeWeekly ? weekly(p.incomeWeekly) : "Not set"],
  ];
  for (const [term, value] of rows) facts.append(h("dt", "", term), h("dd", "", value));
  kids.push(facts);

  kids.push(h("p", "mm-profile__label", "Weights"));
  const pct = weightPercentages(p.weights);
  const list = h("ul", "mm-profile__weights");
  for (const k of DIMS) {
    const li = h("li", "mm-profile__weight");
    li.dataset.dim = k;
    li.dataset.weight = String(pct[k]);
    const track = h("span", "mm-profile__track");
    track.setAttribute("aria-hidden", "true");
    const fill = h("span", "mm-profile__fill");
    fill.style.width = `${pct[k]}%`;
    track.append(fill);
    li.append(h("span", "mm-profile__dim", DIM_LABELS[k]), track, h("span", "mm-profile__pct", `${pct[k]}%`));
    list.append(li);
  }
  kids.push(list);

  kids.push(h("p", "mm-profile__label", "Switches"));
  const flags = h("dl", "mm-profile__facts mm-profile__flags");
  flags.append(h("dt", "", "Has a car"), h("dd", "", flagText(p.hasCar)));
  flags.append(h("dt", "", "Wants nightlife"), h("dd", "", flagText(p.nightlife)));
  kids.push(flags);

  const retake = h("button", "mm-profile__retake", p.isDefault ? "Take the quiz" : "Retake the quiz");
  retake.type = "button";
  retake.addEventListener("click", open);
  kids.push(retake);
  return kids;
}

let seq = 0;

export function renderProfile(container, profile, { onOpenOnboarding } = {}) {
  injectCss();
  const detailsId = `mm-profile-details-${++seq}`;
  const open = (event) => {
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    if (typeof onOpenOnboarding === "function") onOpenOnboarding();
    else openOnboarding();
  };

  const root = h("div", "mm-profile");
  const bar = h("div", "mm-profile__bar");
  const toggle = h("button", "mm-profile__toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-controls", detailsId);
  const summary = h("span", "mm-profile__summary");
  const tag = h("span", "mm-profile__tag", "Example");
  const text = h("span", "mm-profile__text");
  text.append(summary, tag);
  toggle.append(text, icon("mm-profile__chevron", [["path", { d: "M6 9l6 6 6-6" }]]));

  const gear = h("button", "mm-profile__gear");
  gear.type = "button";
  gear.setAttribute("aria-label", "Edit your profile (opens the quiz)");
  gear.title = "Edit your profile (opens the quiz)";
  gear.append(icon("", [["circle", { cx: "12", cy: "12", r: "3" }], ["path", { d: GEAR_PATH }]]));
  gear.addEventListener("click", open);
  bar.append(toggle, gear);

  const details = h("div", "mm-profile__details");
  details.id = detailsId;
  root.append(bar, details);

  function setCollapsed(collapsed) {
    root.dataset.collapsed = String(collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    details.hidden = collapsed;
  }
  toggle.addEventListener("click", () => setCollapsed(root.dataset.collapsed !== "true"));

  function update(next) {
    const p = normalizeProfile(next);
    root.dataset.mode = p.mode;
    root.dataset.default = String(!!p.isDefault);
    root.dataset.converted = String(!!p.converted);
    summary.textContent = profileSummary(p);
    tag.hidden = !p.isDefault;
    details.replaceChildren(...buildDetails(p, open));
  }

  setCollapsed(true);
  update(profile);
  if (container) container.replaceChildren(root);
  return { update, el: root };
}
