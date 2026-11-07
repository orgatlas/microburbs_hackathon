/*
 * extension/sidepanel/score.js: the MicroMatch fit score (README "Scoring model").
 *
 * Pure ES module: no DOM, no chrome.*, no network, no clock. Never returns NaN.
 * Input:  the adapter output (README Contract 2, adapted by adapter.js) and the profile
 *         (README Contract 1, or the backend quiz shape, which normalizeProfile converts).
 * Rules:  each signal maps to 0-100 by the thresholds below. A missing signal is skipped,
 *         never scored 0. Dimension = weighted mean of its scored signals. Fit = sum(w x dim)
 *         renormalised over the dimensions that have a score. Halos = up to three scored
 *         signals >= 70 with the biggest weighted contribution; failos = up to three <= 30.
 */

export const DIMENSIONS = Object.freeze(["commute", "safety", "lifestyle", "price"]);
export const DIMENSION_LABELS = Object.freeze({ commute: "Commute", safety: "Safety", lifestyle: "Lifestyle", price: "Price" });

/* No default persona: without a profile there is no budget, income or work address, so the signals
   that need them are skipped and the four dimensions weigh equally. The panel never shows a fit
   without the user's own profile ("Take the quiz" instead); this only keeps scoreListing() total. */
const NO_PROFILE = Object.freeze({ mode: "rent", weights: Object.freeze({ commute: 0.25, safety: 0.25, lifestyle: 0.25, price: 0.25 }) });

/* Speedo bands for the fit, consistent with the halo >= 70 / failo <= 30 signal rule. */
export const BANDS = Object.freeze({
  failo: Object.freeze({ key: "failo", label: "Failo", min: 0, max: 30 }),
  meh: Object.freeze({ key: "meh", label: "Meh", min: 31, max: 69 }),
  halo: Object.freeze({ key: "halo", label: "Halo", min: 70, max: 100 }),
});
export const HALO_MIN = 70;
export const FAILO_MAX = 30;

/*
 * Band edges as written in the README table. "lower is better" signals use
 * { full, fullInclusive, half, halfInclusive, zero }: value under `full` -> 100, up to `half` -> 50,
 * from `half` to `zero` linear 50 -> 0, at or past `zero` -> 0. `levels` maps a coded level to a score.
 */
export const THRESHOLDS = Object.freeze({
  commute: Object.freeze({
    transit_walk: Object.freeze({ unit: "m", full: 400, fullInclusive: false, half: 900, halfInclusive: true, zero: 1200 }),
    work_distance: Object.freeze({ unit: "km", full: 2, fullInclusive: false, half: 6, halfInclusive: true, zero: 10 }),
    cbd_distance: Object.freeze({ unit: "km", full: 2, fullInclusive: false, half: 5, halfInclusive: true, zero: 8, townHall: Object.freeze([-33.8731, 151.2069]) }),
    parking: Object.freeze({ unit: "spaces", min: 1, flag: "hasCar" }),
    road_noise: Object.freeze({ unit: "level", levels: Object.freeze({ 0: 100, 1: 50, 2: 0 }) }),
  }),
  safety: Object.freeze({
    crime_vs_benchmark: Object.freeze({ unit: "%", full: -20, fullInclusive: true, half: 20, halfInclusive: false, zero: 20 }),
    livability_vs_benchmark: Object.freeze({ unit: "level", levels: Object.freeze({ 1: 100, 0: 50, "-1": 0 }) }),
    hazards_on_property: Object.freeze({ unit: "level", levels: Object.freeze({ 0: 100, 1: 50, 2: 0 }) }),
    social_housing: Object.freeze({ unit: "level", levels: Object.freeze({ low: 100, mid: 50, high: 0 }) }),
  }),
  lifestyle: Object.freeze({
    daily_needs: Object.freeze({ unit: "of 3", categories: Object.freeze(["supermarket", "gym", "cafe"]), full: 3, half: 2 }),
    nightlife: Object.freeze({ unit: "venues", full: 3, half: 1, flag: "nightlife" }),
    green_space: Object.freeze({ unit: "m", full: 500, fullInclusive: false, half: 1000, halfInclusive: true, zero: 1000 }),
  }),
  price: Object.freeze({
    rent_affordability: Object.freeze({ unit: "ratio", full: 0.3, fullInclusive: true, half: 0.4, halfInclusive: true, zero: 0.4 }),
    buy_affordability: Object.freeze({ unit: "ratio", full: 1.0, fullInclusive: true, half: 1.1, halfInclusive: true, zero: 1.1 }),
    value_vs_comps: Object.freeze({ unit: "%", full: 0, fullInclusive: true, half: 5, halfInclusive: true, zero: 5 }),
    running_costs: Object.freeze({ unit: "level", levels: Object.freeze({ "-1": 100, 0: 50, 1: 0 }) }),
    development_pressure: Object.freeze({ unit: "level", levels: Object.freeze({ 0: 100, 1: 50, 2: 0 }) }),
    negotiating_room: Object.freeze({ unit: "level", levels: Object.freeze({ 2: 100, 1: 50, 0: 0 }) }),
  }),
  /* Signal weight for flag-gated signals: flag true 1, absent 0.5, false 0 (not counted). */
  flagWeights: Object.freeze({ true: 1, absent: 0.5, false: 0 }),
});

/* Canonical signal keys per dimension (README table rows), in display order. */
export const SIGNAL_KEYS = Object.freeze({
  commute: Object.freeze(["transit_walk", "work_distance", "cbd_distance", "parking", "road_noise"]),
  safety: Object.freeze(["crime_vs_benchmark", "livability_vs_benchmark", "hazards_on_property", "social_housing"]),
  lifestyle: Object.freeze(["daily_needs", "nightlife", "green_space"]),
  price: Object.freeze(["rent_weekly", "avm", "value_vs_comps", "running_costs", "development_pressure", "negotiating_room"]),
});

const LABELS = {
  transit_walk: "Walk to transport",
  work_distance: "Distance to work",
  cbd_distance: "Distance to the CBD",
  parking: "Parking",
  road_noise: "Road noise",
  crime_vs_benchmark: "Crime vs benchmark",
  livability_vs_benchmark: "Livability vs benchmark",
  hazards_on_property: "Hazards on the property",
  social_housing: "Social housing (estimate)",
  daily_needs: "Supermarket, gym, cafe nearby",
  nightlife: "Nightlife within 10 min",
  green_space: "Nearest park",
  rent_weekly: "Latest rent",
  avm: "Estimated value",
  rent_affordability: "Rent vs your income",
  buy_affordability: "Value vs your budget",
  value_vs_comps: "Value vs recent sales",
  running_costs: "Running costs",
  development_pressure: "Development nearby",
  negotiating_room: "Negotiating room",
};

const LEVEL_TEXT = {
  road_noise: ["No busy road", "Busy road nearby", "Fronts a busy road"],
  hazards_on_property: ["None", "Nearby only", "On the property"],
  development_pressure: ["Quiet", "Some activity", "Heavy activity"],
  negotiating_room: ["Tight", "Some room", "Plenty of room"],
  livability_vs_benchmark: ["Below benchmark", "At benchmark", "Above benchmark"],
  running_costs: ["Below suburb average", "At suburb average", "Above suburb average"],
  social_housing: ["Low (estimate)", "Mid (estimate)", "High (estimate)"],
};

/* ---------------- small null-safe helpers ---------------- */

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round1 = (x) => Math.round(x * 10) / 10;
const trimZeros = (s) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* Finite number, or a plain numeric string ("600", "$1,300,000"); anything else -> null. */
function num(v) {
  if (isNum(v)) return v;
  if (typeof v === "string") {
    const s = v.replace(/[$,\s]/g, "");
    if (/^[+-]?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  }
  return null;
}
const positive = (v) => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};
function bool(v) {
  if (v === true || v === false) return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}

/*
 * Tolerant quantity parser for strings the adapter could not turn into a number:
 * "450 m", "1.2 km", "$1.24M", "$985k", "$1,240,000", "$820/wk", "+4%", "-19 %", "120 m away".
 */
function parseQuantity(v) {
  if (isNum(v)) return { n: v, unit: null };
  if (typeof v !== "string") return null;
  const s = v.replace(/,/g, "").replace(/−/g, "-").trim();
  const m = /([+-]?)\s*\$?\s*(\d+(?:\.\d+)?)\s*(km|m(?![a-z])|k(?![a-z])|%)?/i.exec(s);
  if (!m) return null;
  let n = parseFloat(m[2]);
  if (m[1] === "-") n = -n;
  let unit = m[3] ? m[3].toLowerCase() : null;
  if (s.includes("$")) {
    if (unit === "m") n *= 1e6;
    else if (unit === "k") n *= 1e3;
    unit = /\/\s*(wk|w|week)\b|\bpw\b|per week/i.test(s) ? "AUD/week" : "AUD";
  }
  return Number.isFinite(n) ? { n, unit } : null;
}

/* The signal's number and unit: numeric value first, then a parse of value / raw / display. */
function readNumber(signal) {
  if (isNum(signal.value)) return { n: signal.value, unit: str(signal.unit) };
  for (const c of [signal.value, signal.raw, signal.display]) {
    const q = parseQuantity(c);
    if (q) return { n: q.n, unit: q.unit || str(signal.unit) };
  }
  return null;
}

const unitIs = (u, re) => typeof u === "string" && re.test(u.trim());
const toMetres = (n, unit) => (unitIs(unit, /^(km|kms|kilomet(re|er)s?)$/i) ? n * 1000 : n);
const toKm = (n, unit) => (unitIs(unit, /^(m|metres?|meters?)$/i) ? n / 1000 : n);
function toWeekly(n, unit) {
  if (unitIs(unit, /(month|mth|pcm)/i)) return (n * 12) / 52;
  if (unitIs(unit, /(year|annum|\bpa\b|yr)/i)) return n / 52;
  return n;
}

/* ---------------- formatting ---------------- */

export function formatMetres(m) {
  if (!isNum(m)) return "No data";
  if (Math.abs(m) < 1000) return `${Math.round(m)} m`;
  return `${trimZeros((m / 1000).toFixed(1))} km`;
}
export function formatKm(km) {
  if (!isNum(km)) return "No data";
  return km < 1 ? formatMetres(km * 1000) : `${trimZeros(km.toFixed(1))} km`;
}
export function formatMoney(n) {
  if (!isNum(n)) return "No data";
  const a = Math.abs(n);
  let out;
  if (a >= 999500) out = `$${trimZeros((a / 1e6).toFixed(2))}m`;
  else if (a >= 1000) out = `$${Math.round(a / 1000)}k`;
  else out = `$${Math.round(a)}`;
  return n < 0 ? `-${out}` : out;
}
const signedPct = (p) => `${p > 0 ? "+" : ""}${trimZeros(round1(p).toFixed(1))}%`;

/* "Crime vs national" / note "national median" -> "national". */
function benchmarkName(signal) {
  const text = [signal.note, signal.label, signal.raw].filter((t) => typeof t === "string").join(" ").toLowerCase();
  for (const word of ["national", "suburb", "regional", "region", "state", "city", "sydney", "nsw"]) {
    if (text.includes(word)) return word === "nsw" ? "NSW" : word === "sydney" ? "Sydney" : word;
  }
  return "benchmark";
}

/* ---------------- profile ---------------- */

const QUIZ_KEYS = ["budget_max", "buyer_type", "household", "min_bedrooms", "vibe", "commute_modes", "must_haves", "version"];

function isQuizShape(p) {
  if (p.mode === "rent" || p.mode === "buy") return false;
  if (QUIZ_KEYS.some((k) => k in p)) return true;
  return isObj(p.weights) && !("commute" in p.weights);
}

function normaliseWeights(w) {
  const raw = {};
  let sum = 0;
  for (const d of DIMENSIONS) {
    const n = isObj(w) ? num(w[d]) : null;
    raw[d] = n !== null && n > 0 ? n : 0;
    sum += raw[d];
  }
  const out = {};
  for (const d of DIMENSIONS) out[d] = sum > 0 ? raw[d] / sum : 0.25;
  return out;
}

/* Quiz weights { lifestyle, price, safety } on 0-100 -> commute 0.25 plus the rest scaled to 0.75. */
function quizWeights(w) {
  const parts = {};
  let sum = 0;
  for (const d of ["lifestyle", "price", "safety"]) {
    const n = isObj(w) ? num(w[d]) : null;
    parts[d] = n !== null && n > 0 ? n : 0;
    sum += parts[d];
  }
  const out = { commute: 0.25 };
  for (const d of ["safety", "lifestyle", "price"]) out[d] = sum > 0 ? (0.75 * parts[d]) / sum : 0.25;
  return { commute: out.commute, safety: out.safety, lifestyle: out.lifestyle, price: out.price };
}

/*
 * Accepts README Contract 1, the backend quiz shape (converted: true) or nothing (equal weights, no persona).
 * Idempotent: normalizeProfile(normalizeProfile(p)) deep-equals normalizeProfile(p).
 */
export function normalizeProfile(input) {
  const p = isObj(input) ? input : null;
  if (!p) return { ...NO_PROFILE, weights: { ...NO_PROFILE.weights } };
  const out = {};
  if (isQuizShape(p)) {
    if (str(p.name)) out.name = str(p.name);
    out.mode = "buy";
    const budget = positive(p.budget_max);
    if (budget !== null) out.budgetPrice = budget;
    out.weights = quizWeights(p.weights);
    out.converted = true;
  } else {
    if (str(p.name)) out.name = str(p.name);
    out.mode = p.mode === "buy" ? "buy" : "rent";
    for (const k of ["budgetWeekly", "budgetPrice", "incomeWeekly"]) {
      const n = positive(p[k]);
      if (n !== null) out[k] = n;
    }
    if (str(p.workAddress)) out.workAddress = str(p.workAddress);
    out.weights = normaliseWeights(p.weights);
    if (isObj(p.metricWeights)) out.metricWeights = p.metricWeights;
    if (p.converted === true) out.converted = true;
  }
  for (const flag of ["hasCar", "nightlife"]) {
    const b = bool(p[flag]);
    if (b !== undefined) out[flag] = b;
  }
  return out;
}

function flagWeight(flag) {
  if (flag === true) return THRESHOLDS.flagWeights.true;
  if (flag === false) return THRESHOLDS.flagWeights.false;
  return THRESHOLDS.flagWeights.absent;
}

/* ---------------- signal scoring ---------------- */

/* Lower-is-better band: < full 100, up to half 50, half..zero linear 50 -> 0, past zero 0. */
function bandLower(v, t) {
  if (t.fullInclusive ? v <= t.full : v < t.full) return 100;
  if (t.halfInclusive === false ? v < t.half : v <= t.half) return 50;
  if (v >= t.zero || t.zero <= t.half) return 0;
  return Math.round((50 * (t.zero - v)) / (t.zero - t.half));
}

/* Coded level -> index 0..2 into LEVEL_TEXT, or null. */
function levelIndex(key, v) {
  if (key === "livability_vs_benchmark" || key === "running_costs") return Math.sign(v) + 1;
  return clamp(Math.round(v), 0, 2);
}

/* Fallback for level-coded signals the adapter left as text. */
function levelFromText(key, text) {
  const t = typeof text === "string" ? text.toLowerCase() : "";
  if (!t) return null;
  if (key === "hazards_on_property") {
    if (/on (the )?property/.test(t)) return 2;
    if (/\bnone\b|no overlay|not affected|^no\b/.test(t)) return 0;
    if (/away|nearby|near\b/.test(t)) return 1;
  }
  if (key === "social_housing") {
    if (/\blow\b/.test(t)) return 0;
    if (/\bmid|medium|moderate/.test(t)) return 1;
    if (/\bhigh\b/.test(t)) return 2;
  }
  if (key === "road_noise") {
    if (/front/.test(t)) return 2;
    if (/near/.test(t)) return 1;
    if (/\bnone\b|quiet|^no\b/.test(t)) return 0;
  }
  return null;
}

const LEVEL_SCORE = {
  road_noise: [100, 50, 0],
  hazards_on_property: [100, 50, 0],
  development_pressure: [100, 50, 0],
  social_housing: [100, 50, 0],
  livability_vs_benchmark: [0, 50, 100], // index = level + 1
  running_costs: [100, 50, 0], // index = level + 1 (-1 below average is best)
  negotiating_room: [0, 50, 100], // index = level (2 high is best)
};

/* Daily needs: which of supermarket / gym / cafe were reported; never treat unreported as absent. */
function dailyNeeds(signal, value) {
  const cats = THRESHOLDS.lifestyle.daily_needs.categories;
  const total = positive(signal.total) || cats.length;
  const matches = (list) => cats.filter((c) => list.some((x) => typeof x === "string" && x.toLowerCase().includes(c.slice(0, 4))));
  let found = value;
  let reported = null;
  const source = signal.categories ?? signal.reportedCategories ?? signal.reported ?? null;
  if (isObj(source)) {
    let f = 0;
    let r = 0;
    for (const c of cats) {
      const key = Object.keys(source).find((k) => k.toLowerCase().includes(c.slice(0, 4)));
      const v = key === undefined ? undefined : source[key];
      if (v === true || (isNum(v) && v > 0) || (isObj(v) && v.present === true)) { f += 1; r += 1; }
      else if (v === false || v === 0 || (isObj(v) && v.present === false)) r += 1;
    }
    found = f;
    reported = r;
  } else if (Array.isArray(source)) {
    reported = matches(source).length;
  }
  const present = signal.within ?? signal.present ?? signal.found;
  if (Array.isArray(present) && !isNum(value)) found = matches(present).length;
  /* adapter.js names the unreported categories `missing`. */
  const unreported = signal.unreported ?? signal.notReported ?? signal.missing;
  if (Array.isArray(unreported)) reported = total - matches(unreported).length;
  if (isNum(signal.reportedCount)) reported = signal.reportedCount;
  if (reported === null) reported = total;
  found = clamp(Math.round(found), 0, total);
  reported = clamp(Math.max(Math.round(reported), found), 0, total);
  const unknown = total - reported;
  const band = (n) => (n >= 3 ? 100 : n >= 2 ? 50 : 0);
  const score = band(found) === band(found + unknown) ? band(found) : null;
  const display = unknown > 0 ? `${found} of ${total}, ${unknown} not reported` : `${found} of ${total}`;
  return { score, value: found, display, unknown, total };
}

function baseItem(dimension, key, signal, signalWeight) {
  const s = isObj(signal) ? signal : null;
  return {
    dimension,
    key,
    label: (s && str(s.label)) || LABELS[key] || key,
    score: null,
    available: false,
    value: null,
    unit: (THRESHOLDS[dimension]?.[key]?.unit) || (s && str(s.unit)) || null,
    display: "No data",
    source: (s && str(s.source)) || null,
    asOf: (s && (str(s.asOf) || str(s.as_of))) || null,
    signalWeight,
  };
}

function unavailable(item, signal, fallback) {
  const reason = (isObj(signal) && str(signal.reason)) || fallback;
  return { ...item, available: false, score: null, reason };
}

/* Affordability: rent / weekly income (rent mode) or AVM / budget (buy mode). */
function affordability(dimension, key, signal, profile) {
  const buy = key === "buy_affordability";
  const item = baseItem(dimension, key, signal, 1);
  item.label = LABELS[key];
  item.unit = buy ? "% of budget" : "% of income";
  if (!isObj(signal) || signal.available === false) {
    return unavailable(item, signal, buy ? "no estimated value from the backend" : "no rent figure from the backend");
  }
  const q = readNumber(signal);
  if (!q || !(q.n > 0)) return unavailable({ ...item, available: true }, null, `could not read value ${signal.raw ?? signal.value ?? ""}`.trim());
  item.available = true;
  if (buy) {
    const budget = positive(profile.budgetPrice);
    const price = q.n;
    item.inputs = { avm: price, budgetPrice: budget };
    if (budget === null) return { ...item, display: formatMoney(price), reason: "add a purchase budget to your profile" };
    const ratio = price / budget;
    return {
      ...item,
      score: bandLower(ratio, THRESHOLDS.price.buy_affordability),
      value: Math.round(ratio * 100),
      display: `${formatMoney(price)}, ${Math.round(ratio * 100)}% of budget`,
    };
  }
  const income = positive(profile.incomeWeekly);
  const rent = toWeekly(q.n, q.unit);
  item.inputs = { rentWeekly: Math.round(rent), incomeWeekly: income };
  if (income === null) return { ...item, display: `$${Math.round(rent)}/wk`, reason: "add your weekly income to your profile" };
  const ratio = rent / income;
  return {
    ...item,
    score: bandLower(ratio, THRESHOLDS.price.rent_affordability),
    value: Math.round(ratio * 100),
    display: `${Math.round(ratio * 100)}% of income`,
  };
}

/*
 * Score one signal. Returns the dimensions[].signals entry:
 * { dimension, key, label, score, available, value, unit, display, source, asOf, reason?, signalWeight }.
 * score is null when the signal is missing, unreadable or not counted (signalWeight 0).
 * In the price dimension "rent_weekly" scores as rent_affordability in rent mode and "avm" as
 * buy_affordability in buy mode; the other one is returned unscored, for reference.
 */
export function scoreSignal(dimension, key, signal, profileIn) {
  return scoreOne(dimension, key, signal, normalizeProfile(profileIn));
}

function scoreOne(dimension, key, signal, profile) {
  const mode = profile.mode === "buy" ? "buy" : "rent";
  if (dimension === "price") {
    if (key === "rent_affordability" || (key === "rent_weekly" && mode === "rent")) return affordability(dimension, "rent_affordability", signal, profile);
    if (key === "buy_affordability" || (key === "avm" && mode === "buy")) return affordability(dimension, "buy_affordability", signal, profile);
  }

  let signalWeight = 1;
  if (key === "parking") signalWeight = flagWeight(profile.hasCar);
  if (key === "nightlife") signalWeight = flagWeight(profile.nightlife);
  /* The other mode's raw price fact (avm when renting, rent when buying) is never counted. */
  if (dimension === "price" && (key === "rent_weekly" || key === "avm")) signalWeight = 0;
  const item = baseItem(dimension, key, signal, signalWeight);

  if (signal === undefined || signal === null) return unavailable(item, null, "not provided by the backend");
  if (!isObj(signal) || signal.available === false) return unavailable(item, signal, "no data from Microburbs");

  /* Raw facts shown for reference in the other mode: never scored. */
  if (dimension === "price" && (key === "rent_weekly" || key === "avm")) {
    const q = readNumber(signal);
    if (!q) return unavailable({ ...item, available: true }, null, `could not read value ${signal.raw ?? signal.value ?? ""}`.trim());
    const value = key === "rent_weekly" ? Math.round(toWeekly(q.n, q.unit)) : q.n;
    return {
      ...item,
      available: true,
      value,
      unit: key === "rent_weekly" ? "AUD/week" : "AUD",
      display: key === "rent_weekly" ? `$${value}/wk` : formatMoney(value),
      signalWeight: 0,
      reason: mode === "rent" ? "shown for reference, not scored when renting" : "shown for reference, not scored when buying",
    };
  }

  const t = THRESHOLDS[dimension]?.[key];
  if (!t) return unavailable(item, null, "no scoring rule for this signal");

  /* Levels and counts only take a real number or a plain numeric string ("120 m away" is not a level). */
  let q = null;
  if (t.levels || key === "parking" || key === "nightlife" || key === "daily_needs") {
    const n = num(signal.value);
    if (n !== null) q = { n, unit: str(signal.unit) };
    else if (t.levels) {
      for (const c of [signal.value, signal.raw, signal.display]) {
        const lvl = levelFromText(key, c);
        if (lvl !== null) { q = { n: lvl, unit: "level" }; break; }
      }
    }
  } else {
    q = readNumber(signal);
  }
  if (!q) {
    const raw = signal.raw ?? signal.value ?? signal.display ?? "";
    return unavailable({ ...item, available: true }, null, `could not read value ${String(raw)}`.trim());
  }
  const ready = { ...item, available: true };
  const off = signalWeight === 0;
  const offReason = key === "parking" ? "not counted: your profile says no car" : "not counted: nightlife is off in your profile";
  let out;

  switch (key) {
    case "transit_walk":
    case "green_space": {
      const m = toMetres(q.n, q.unit);
      out = { ...ready, value: Math.round(m), unit: "m", display: formatMetres(m), score: bandLower(m, t) };
      break;
    }
    case "work_distance":
    case "cbd_distance": {
      const km = toKm(q.n, q.unit);
      out = { ...ready, value: round1(km), unit: "km", display: formatKm(km), score: bandLower(km, t) };
      break;
    }
    case "parking": {
      const n = Math.max(0, Math.round(q.n));
      out = { ...ready, value: n, unit: "spaces", display: n === 0 ? "No parking" : plural(n, "space"), score: n >= t.min ? 100 : 0 };
      break;
    }
    case "nightlife": {
      const n = Math.max(0, Math.round(q.n));
      out = { ...ready, value: n, unit: "venues", display: plural(n, "venue"), score: n >= t.full ? 100 : n >= t.half ? 50 : 0 };
      break;
    }
    case "daily_needs": {
      const d = dailyNeeds(signal, q.n);
      out = { ...ready, value: d.value, unit: `of ${d.total}`, display: d.display, score: d.score };
      if (d.score === null) out.reason = `${d.unknown} of ${d.total} categories not reported, so the band is unclear`;
      break;
    }
    case "crime_vs_benchmark":
    case "value_vs_comps": {
      const p = q.n;
      const vs = key === "crime_vs_benchmark" ? `vs ${benchmarkName(signal)}` : "vs recent sales";
      out = { ...ready, value: round1(p), unit: "%", display: `${signedPct(p)} ${vs}`, score: bandLower(p, t) };
      break;
    }
    default: {
      /* level-coded: road_noise, livability, hazards, social_housing, running_costs, dev pressure, negotiating room */
      const idx = levelIndex(key, q.n);
      const level = key === "livability_vs_benchmark" || key === "running_costs" ? idx - 1 : idx;
      let display = LEVEL_TEXT[key][idx];
      if (key === "hazards_on_property" && idx === 1 && typeof signal.raw === "string" && /\d/.test(signal.raw)) display = signal.raw.trim();
      else if (key === "hazards_on_property" && idx === 1 && typeof signal.display === "string" && /\d/.test(signal.display)) display = signal.display.trim();
      out = { ...ready, value: level, unit: "level", display, score: LEVEL_SCORE[key][idx] };
      break;
    }
  }
  if (off) return { ...out, score: null, reason: offReason };
  return out;
}

/* ---------------- bands ---------------- */

export function bandFor(score) {
  if (!isNum(score)) return null;
  if (score >= HALO_MIN) return "halo";
  if (score <= FAILO_MAX) return "failo";
  return "meh";
}

/* ---------------- listing ---------------- */

function factsFor(adapted, dimension) {
  const f = isObj(adapted) && isObj(adapted.facts) ? adapted.facts[dimension] : null;
  return isObj(f) ? f : {};
}

/* Signals for one dimension, in canonical order (price: affordability first, other-mode raw fact last). */
function dimensionSignals(adapted, dimension, profile) {
  const facts = factsFor(adapted, dimension);
  const mode = profile.mode === "buy" ? "buy" : "rent";
  let keys = SIGNAL_KEYS[dimension];
  if (dimension === "price") {
    const lead = mode === "buy" ? "avm" : "rent_weekly";
    const tail = mode === "buy" ? "rent_weekly" : "avm";
    keys = [lead, ...keys.filter((k) => k !== lead && k !== tail), tail];
  }
  return keys.map((key) => {
    let signal = facts[key];
    if (dimension === "commute" && key === "parking" && !(isObj(signal) && signal.available !== false)) {
      const n = isObj(adapted) && isObj(adapted.property) ? num(adapted.property.parking_count) : null;
      if (n !== null) {
        signal = { available: true, value: n, unit: "spaces", label: LABELS.parking, source: "/v1/properties/{gnaf_id}/basics/all", asOf: null };
      }
    }
    const item = scoreOne(dimension, key, signal, profile);
    return { ...item, signalWeight: item.signalWeight * metricMultiplier(item.key, profile) };
  });
}

/*
 * The quiz stores 11 metric weights in Django. Each one multiplies its signals inside a dimension,
 * relative to an average metric (1/11), so a metric that matters more pulls its dimension harder.
 * Signals with no quiz metric keep a multiplier of 1.
 */
const METRIC_COUNT = 11;
const SIGNAL_METRICS = Object.freeze({
  work_distance: "dist",
  cbd_distance: "dist",
  transit_walk: "pt",
  parking: "park",
  road_noise: "peak",
  livability_vs_benchmark: "live",
  daily_needs: "amen",
  green_space: "amen",
  value_vs_comps: "val",
  development_pressure: "dev",
  running_costs: "rates",
  rent_affordability: "afford",
  buy_affordability: "afford",
});

function metricMultiplier(key, profile) {
  const weight = isObj(profile.metricWeights) ? num(profile.metricWeights[SIGNAL_METRICS[key]]) : null;
  return weight !== null && weight > 0 ? weight * METRIC_COUNT : 1;
}

function weightedMean(signals) {
  let sum = 0;
  let wsum = 0;
  for (const s of signals) {
    if (isNum(s.score) && s.signalWeight > 0) {
      sum += s.score * s.signalWeight;
      wsum += s.signalWeight;
    }
  }
  return wsum > 0 ? Math.round(sum / wsum) : null;
}

function toItem(sig, contribution) {
  return {
    dimension: sig.dimension,
    key: sig.key,
    label: sig.label,
    score: sig.score,
    value: sig.value,
    unit: sig.unit,
    display: sig.display,
    source: sig.source,
    asOf: sig.asOf,
    contribution: round1(contribution),
  };
}

/*
 * scoreListing(adapted, profile, opts) -> { fit, band, mode, dimensions[4], halos, failos, missing, coverage }.
 * opts: { weights?: partial weight override (e.g. from the sliders), mode?: "rent"|"buy", limit?: 3 }.
 */
export function scoreListing(adapted, profileIn, opts = {}) {
  const o = isObj(opts) ? opts : {};
  const base = normalizeProfile(profileIn);
  const profile = { ...base };
  if (o.mode === "rent" || o.mode === "buy") profile.mode = o.mode;
  if (isObj(o.weights)) profile.weights = normaliseWeights({ ...base.weights, ...o.weights });
  const limit = isNum(o.limit) && o.limit >= 0 ? Math.floor(o.limit) : 3;
  const mode = profile.mode === "buy" ? "buy" : "rent";
  const weights = profile.weights;

  const dimensions = DIMENSIONS.map((key) => {
    const signals = dimensionSignals(adapted, key, profile);
    return { key, label: DIMENSION_LABELS[key], score: weightedMean(signals), weight: weights[key], signals };
  });

  const scored = dimensions.filter((d) => isNum(d.score));
  const wsum = scored.reduce((a, d) => a + d.weight, 0);
  const fit = scored.length && wsum > 0 ? Math.round(scored.reduce((a, d) => a + d.weight * d.score, 0) / wsum) : null;

  /* share = this signal's slice of the fit: (w_d / sum of scored w) x (signal weight / sum of signal weights). */
  const ranked = [];
  for (const d of dimensions) {
    if (!isNum(d.score) || !(wsum > 0)) continue;
    const swSum = d.signals.reduce((a, s) => a + (isNum(s.score) && s.signalWeight > 0 ? s.signalWeight : 0), 0);
    if (!(swSum > 0)) continue;
    for (const s of d.signals) {
      if (!isNum(s.score) || !(s.signalWeight > 0)) continue;
      ranked.push({ s, share: (d.weight / wsum) * (s.signalWeight / swSum) });
    }
  }
  const order = (a, b) => b.c - a.c;
  const halos = ranked
    .filter((r) => r.s.score >= HALO_MIN)
    .map((r) => ({ s: r.s, c: r.s.score * r.share }))
    .filter((r) => r.c > 0)
    .sort((a, b) => order(a, b) || b.s.score - a.s.score)
    .slice(0, limit)
    .map((r) => toItem(r.s, r.c));
  const failos = ranked
    .filter((r) => r.s.score <= FAILO_MAX)
    .map((r) => ({ s: r.s, c: (100 - r.s.score) * r.share }))
    .filter((r) => r.c > 0)
    .sort((a, b) => order(a, b) || a.s.score - b.s.score)
    .slice(0, limit)
    .map((r) => toItem(r.s, r.c));

  const missing = [];
  let total = 0;
  let scoredCount = 0;
  for (const d of dimensions) {
    for (const s of d.signals) {
      if (!(s.signalWeight > 0)) continue;
      total += 1;
      if (isNum(s.score)) scoredCount += 1;
      else missing.push({ dimension: d.key, key: s.key, label: s.label, reason: s.reason || "no data" });
    }
  }

  return {
    fit,
    band: bandFor(fit),
    mode,
    dimensions,
    halos,
    failos,
    missing,
    coverage: { scored: scoredCount, total },
  };
}
