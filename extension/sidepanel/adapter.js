// adapter.js: maps what background.js stores per tab (a POST /api/match response, see
// docs/API_CONTRACT.md, or { status: "loading" | "need_address", query }) to the signal
// shape score.js consumes (README Contract 2, adapted).
// Pure ES module: no chrome.*, no DOM, no network. A fact we cannot read is reported as
// unavailable with a reason, never as zero. Backend scores are kept for display only.

const NOT_PROVIDED = "not provided by the backend";
const NO_MATCH_YET = "no matched home yet";
const WALK_M_PER_MIN = 80; // ~4.8 km/h, used only when the backend gives walk minutes
const DAILY_NEEDS_RADIUS_M = 800; // a 10 minute walk
const NEEDS = ["supermarket", "gym", "cafe"];

// One entry per README scoring-table row. kind picks the parser below.
export const SIGNALS = {
  commute: {
    transit_walk: { label: "Walk to train, light rail or bus", unit: "m", kind: "distance_m" },
    work_distance: { label: "Distance to work", unit: "km", kind: "distance_km" },
    cbd_distance: { label: "Distance to the CBD", unit: "km", kind: "distance_km" },
    parking: { label: "Parking on title", unit: "spaces", kind: "count" },
    road_noise: { label: "Busy road frontage", unit: "level", kind: "road_noise" },
  },
  safety: {
    crime_vs_benchmark: { label: "Crime vs benchmark", unit: "%", kind: "percent" },
    livability_vs_benchmark: { label: "Livability vs benchmark", unit: "level", kind: "tri" },
    hazards_on_property: { label: "Hazards on this property", unit: "level", kind: "hazard" },
    social_housing: { label: "Estimated social-housing share", unit: "level", kind: "none" },
  },
  lifestyle: {
    daily_needs: { label: "Supermarket, gym and café within 10 min walk", unit: "of 3", kind: "needs" },
    nightlife: { label: "Nightlife within 10 min", unit: "venues", kind: "venues" },
    green_space: { label: "Nearest park", unit: "m", kind: "distance_m" },
  },
  price: {
    rent_weekly: { label: "Weekly rent", unit: "AUD/week", kind: "rent" },
    avm: { label: "Estimated value", unit: "AUD", kind: "money" },
    value_vs_comps: { label: "Value vs comparable sales", unit: "%", kind: "percent" },
    running_costs: { label: "Running costs vs suburb", unit: "level", kind: "tri" },
    development_pressure: { label: "Development pressure", unit: "level", kind: "development" },
    negotiating_room: { label: "Negotiating room", unit: "level", kind: "negotiating" },
  },
};

const DIMENSION_OF = {};
for (const [dim, keys] of Object.entries(SIGNALS)) for (const key of Object.keys(keys)) DIMENSION_OF[key] = dim;

// Backend factor keys we know or expect, mapped to canonical keys.
const KEY_ALIASES = {
  transport: "transit_walk", transit: "transit_walk", train: "transit_walk", bus: "transit_walk",
  light_rail: "transit_walk", nearest_transport: "transit_walk", station: "transit_walk",
  work: "work_distance", work_commute: "work_distance", commute_work: "work_distance",
  cbd: "cbd_distance", parking_count: "parking", car_space: "parking",
  noise: "road_noise", busy_road: "road_noise", road: "road_noise",
  crime: "crime_vs_benchmark", crime_rate: "crime_vs_benchmark",
  livability: "livability_vs_benchmark", liveability: "livability_vs_benchmark",
  flood: "hazards_on_property", bushfire: "hazards_on_property", landslide: "hazards_on_property",
  risk: "hazards_on_property", risks: "hazards_on_property", hazard: "hazards_on_property",
  hazards: "hazards_on_property", contamination: "hazards_on_property", hv_line: "hazards_on_property",
  amenities: "daily_needs", supermarket: "daily_needs", gym: "daily_needs", cafe: "daily_needs",
  pubs: "nightlife", bars: "nightlife", venues: "nightlife",
  park: "green_space", parks: "green_space", green: "green_space", beach: "green_space", tree_canopy: "green_space",
  rent: "rent_weekly", rent_latest: "rent_weekly", rent_history: "rent_weekly", rent_vs_income: "rent_weekly",
  avm_vs_budget: "avm", valuation: "avm", estimated_value: "avm",
  comps: "value_vs_comps", comparables: "value_vs_comps", avm_vs_comps: "value_vs_comps",
  rates: "running_costs", council_rates: "running_costs", strata: "running_costs", levies: "running_costs",
  da: "development_pressure", das: "development_pressure", development: "development_pressure",
  construction: "development_pressure", vacancy: "negotiating_room", days_on_market: "negotiating_room",
};

// Label/key keyword rules, most specific first ("Rental vacancy" must not become rent).
const KEYWORD_RULES = [
  [/\bcomps?\b|comparable/, "value_vs_comps"],
  [/vacanc|days on market|negotiat/, "negotiating_room"],
  [/strata|council rates|\brates\b|running cost|levies/, "running_costs"],
  [/\bdas?\b|development|construction/, "development_pressure"],
  [/crime/, "crime_vs_benchmark"],
  [/liv(e)?ability/, "livability_vs_benchmark"],
  [/flood|hazard|risk|bushfire|landslide|contamina|hv line|power ?line|overlay/, "hazards_on_property"],
  [/nightlife|\bpubs?\b|\bbars?\b|venue/, "nightlife"],
  [/amenit|supermarket|grocer|\bgym\b|fitness|\bcaf(e|é)s?\b|coffee/, "daily_needs"],
  [/\bparks?\b|green|beach|tree|canopy/, "green_space"],
  [/busy road|road noise|noise|traffic/, "road_noise"],
  [/parking|car ?space|garage/, "parking"],
  [/\bcbd\b|town hall|city centre/, "cbd_distance"],
  [/\bwork\b|office|commute/, "work_distance"],
  [/transport|train|\bbus\b|light rail|metro|station|transit|tram|ferry/, "transit_walk"],
  // Market figures that mention rent or price but are not this home's weekly rent or value: unmapped.
  [/\byield\b|growth|forecast|median (sale )?price/, null],
  [/\brent|rental/, "rent_weekly"],
  [/\bavm\b|estimated value|valuation|value estimate|price estimate/, "avm"],
];

// Generic factor keys that group several kinds of fact (key "amenities", label "Park"):
// for these the label decides, and the key is only the fallback.
const BUCKET_KEYS = new Set(["amenities", "amenity", "places", "nearby", "lifestyle", "risks", "risk", "market"]);

function keywordRule(text) {
  for (const [pattern, canonical] of KEYWORD_RULES) if (pattern.test(text)) return { canonical };
  return null;
}

/** Which canonical signal a backend factor feeds, or null. */
export function classifyFactor(factor) {
  if (!factor || typeof factor !== "object") return null;
  const key = String(factor.key ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const label = String(factor.label ?? "").toLowerCase();
  if (key && DIMENSION_OF[key]) return key;
  if (key && BUCKET_KEYS.has(key) && label) {
    const byLabel = keywordRule(label);
    if (byLabel) return byLabel.canonical;
  }
  if (key && KEY_ALIASES[key]) return KEY_ALIASES[key];
  for (const text of [key.replace(/_/g, " "), label]) {
    if (!text) continue;
    const rule = keywordRule(text);
    if (rule) return rule.canonical; // null for the market figures above
  }
  return null;
}

// ---------- value parsing ----------

function clean(text) {
  return String(text ?? "")
    .replace(/[–—−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function finite(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\s*[+-]?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  return null;
}

const MONEY_RE = /(?<![\w.%]\s*)([+-])?\s*(?:A?\$|AUD\s?)\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(k|m|b|million|mil|mn|thousand)?(?![a-z])/gi;

/** All dollar amounts in a string, in AUD. "$1.24M" -> 1240000, "$985k" -> 985000. */
export function parseMoney(text) {
  const out = [];
  for (const m of clean(text).matchAll(MONEY_RE)) {
    let n = Number(m[2].replace(/,/g, ""));
    const suffix = (m[3] || "").toLowerCase();
    if (suffix === "k" || suffix === "thousand") n *= 1e3;
    else if (suffix === "m" || suffix === "million" || suffix === "mil" || suffix === "mn") n *= 1e6;
    else if (suffix === "b") n *= 1e9;
    if (m[1] === "-") n = -n;
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function parsePeriod(text) {
  const t = clean(text).toLowerCase();
  if (/(\/|\bper\s|\bp\/?|\s|^)(wk|week|weekly|w)\b|\bpw\b/.test(t)) return "week";
  if (/(\/|\bper\s|\s)(month|monthly|mth|mo)\b|\bpcm\b/.test(t)) return "month";
  if (/(\/|\bper\s|\s)(year|yearly|yr|annum)\b|\bpa\b|\bp\.a\./.test(t)) return "year";
  if (/(\/|\bper\s|\s)(quarter|qtr)\b/.test(t)) return "quarter";
  return null;
}

/** Signed percentage. "+4%" -> 4, "-19 %" -> -19, "20% below" -> -20. */
export function parsePercent(text) {
  const t = clean(text).toLowerCase();
  const m = t.match(/([+-])?\s*(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  let n = Number(m[2]);
  if (m[1] === "-") n = -n;
  else if (!m[1] && /\b(below|lower|less|under|cheaper|fewer)\b/.test(t)) n = -n;
  return n;
}

/** A distance in metres. "450 m" -> 450, "1.2 km" -> 1200, "1,200 m" -> 1200, "1,2 km" -> 1200. Null when none. */
export function parseDistanceM(text) {
  const t = clean(text).toLowerCase();
  const m = t.match(/(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?)\s*(km|kms|kilomet(?:er|re)s?|m|metres?|meters?|mtrs?)(?![a-z])/);
  if (!m) return null;
  const raw = m[1];
  // "1,200" is a thousands separator; "1,2" is a decimal comma.
  const n = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw) ? Number(raw.replace(/,/g, "")) : Number(raw.replace(",", "."));
  return /^k/.test(m[2]) ? n * 1000 : n;
}

// "none within 1 km", "No park nearby", "no station within 800 m": the backend looked and found none.
const NONE_NEARBY_RE = /^(none|nil)\b|\bnone (within|nearby|near|in)\b|\bno (nearby |public )?(parks?|green|reserves?|beach(es)?|stations?|stops?|trains?|bus(es)?|light rail|transport)\b/;

function parseMinutes(text) {
  const m = clean(text).toLowerCase().match(/(\d+(?:\.\d+)?)\s*(?:min|mins|minutes?)\b/);
  return m ? Number(m[1]) : null;
}

function parseCount(text) {
  const t = clean(text).toLowerCase();
  if (/^(none|no|nil|zero)\b/.test(t)) return 0;
  const m = t.match(/^[^\d$%-]*?(\d+)(?![\d.,])(?!\s*(?:%|m\b|kms?\b|min|metres?|meters?))/);
  return m ? Number(m[1]) : null;
}

// Forward-compatible structured numbers: factor.raw / raw_value / number (+ unit, as_of).
function structured(factor) {
  const r = factor.raw;
  if (r && typeof r === "object") {
    const n = finite(r.value ?? r.number ?? r.amount);
    if (n !== null) {
      return { number: n, unit: r.unit ?? factor.unit ?? null, low: finite(r.low), high: finite(r.high), asOf: r.as_of ?? r.asOf ?? null };
    }
  }
  for (const v of [r, factor.raw_value, factor.number, factor.numeric_value, typeof factor.value === "number" ? factor.value : undefined]) {
    const n = finite(v);
    if (n !== null) {
      return { number: n, unit: factor.unit ?? factor.raw_unit ?? null, low: finite(factor.low ?? factor.value_low), high: finite(factor.high ?? factor.value_high), asOf: null };
    }
  }
  return null;
}

function unitToMetres(n, unit) {
  const u = String(unit ?? "").toLowerCase();
  if (/^k/.test(u)) return n * 1000;
  if (/^min/.test(u)) return n * WALK_M_PER_MIN;
  return n; // "m", "metres" or unstated: canonical is metres
}

function levelFromWords(t, table) {
  for (const [pattern, level] of table) if (pattern.test(t)) return level;
  return null;
}

const TRI_WORDS = [
  [/\b(above|higher|better|more|over)\b/, 1],
  [/\b(below|lower|worse|less|under|cheaper)\b/, -1],
  [/\b(at|average|in line|similar|on par|typical|about the same|median)\b/, 0],
];
const DEV_WORDS = [
  [/\b(heavy|high|lots|major|busy|intense)\b/, 2],
  [/\b(some|moderate|medium|mid)\b/, 1],
  [/\b(low|quiet|stable|none|minimal|little|no)\b/, 0],
];
const NEGOTIATING_WORDS = [
  [/\b(high|plenty|soft|buyers?)\b/, 2],
  [/\b(mid|moderate|medium|balanced|average)\b/, 1],
  [/\b(tight|low|competitive|sellers?|hot)\b/, 0],
];

function fmtNumber(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
function fmtMoney(n) {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (Math.abs(n) >= 1e4) return `$${Math.round(n / 1e3)}k`;
  return `$${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}
function fmtDistance(m) {
  return m >= 1000 ? `${fmtNumber(m / 1000)} km` : `${Math.round(m)} m`;
}

/**
 * Reads one factor as the canonical signal `key`.
 * Returns { value, unit, display, note?, low?, high?, asOf? } or { error }.
 */
export function readFactor(key, factor) {
  const spec = SIGNALS[DIMENSION_OF[key]]?.[key];
  if (!spec) return { error: `unknown signal ${key}` };
  const s = structured(factor);
  const rawText = typeof factor.value === "string" ? clean(factor.value) : "";
  const t = rawText.toLowerCase();
  const display = rawText || null;
  const unreadable = { error: rawText ? `could not read value ${rawText}` : "backend sent no value" };
  const ok = (value, extra = {}) => ({ value, unit: spec.unit, display: display ?? extra.fallbackDisplay ?? fmtNumber(value), ...extra, fallbackDisplay: undefined });

  switch (spec.kind) {
    case "distance_m": {
      if (s) return ok(unitToMetres(s.number, s.unit), { fallbackDisplay: fmtDistance(unitToMetres(s.number, s.unit)) });
      if (NONE_NEARBY_RE.test(t) && !/\b(no data|not (available|reported|known))\b/.test(t)) {
        const radius = parseDistanceM(t);
        return ok((radius ?? 1000) + 1, {
          note: radius !== null
            ? `none within ${fmtDistance(radius)}; read as just beyond it`
            : "none nearby, radius not stated; read as none within 1 km",
        });
      }
      const d = parseDistanceM(t);
      if (d !== null) return ok(d);
      const min = parseMinutes(t);
      if (min !== null) return ok(min * WALK_M_PER_MIN, { note: `converted from a ${fmtNumber(min)} min walk at ${WALK_M_PER_MIN} m/min` });
      return unreadable;
    }
    case "distance_km": {
      if (s) {
        const km = /^k/i.test(String(s.unit ?? "km")) ? s.number : s.number / 1000;
        return ok(km, { fallbackDisplay: `${fmtNumber(km)} km` });
      }
      const d = parseDistanceM(t);
      return d !== null ? ok(d / 1000) : unreadable;
    }
    case "count": {
      if (s) return ok(s.number);
      const n = parseCount(t);
      return n !== null ? ok(n) : unreadable;
    }
    case "road_noise": {
      if (s && !/m$/i.test(String(s.unit ?? ""))) return ok(Math.max(0, Math.min(2, Math.round(s.number))));
      if (/front|on a (busy|main) road|main road/.test(t)) return ok(2);
      const d = s ? unitToMetres(s.number, s.unit) : parseDistanceM(t);
      if (d !== null) return ok(d <= 25 ? 2 : d <= 200 ? 1 : 0, { note: `level from distance ${fmtDistance(d)} (≤25 m fronting, ≤200 m nearby)` });
      if (/near|close|adjacent|away/.test(t)) return ok(1);
      if (/\b(none|quiet|no|clear)\b/.test(t)) return ok(0);
      return unreadable;
    }
    case "percent": {
      if (s) return ok(s.number, { fallbackDisplay: `${s.number > 0 ? "+" : ""}${fmtNumber(s.number)}%` });
      const p = parsePercent(t);
      return p !== null ? ok(p) : unreadable;
    }
    case "tri": {
      if (s && !/%/.test(String(s.unit ?? ""))) return ok(Math.max(-1, Math.min(1, Math.sign(s.number))));
      // "72 vs 65 regional": a score against its benchmark.
      const vs = s ? null : t.match(/(?<![\d$.,])(\d+(?:\.\d+)?)\s*(?:vs\.?|versus|against)\s*(?:the\s+)?(\d+(?:\.\d+)?)(?![\d.,%])/);
      if (vs && Number(vs[2]) > 0) {
        const diff = ((Number(vs[1]) - Number(vs[2])) / Number(vs[2])) * 100;
        return ok(diff > 5 ? 1 : diff < -5 ? -1 : 0, { note: `level from ${vs[1]} vs ${vs[2]} (within ±5% counts as at the benchmark)` });
      }
      const p = s ? s.number : parsePercent(t);
      if (p !== null) return ok(p > 5 ? 1 : p < -5 ? -1 : 0, { note: `level from ${p > 0 ? "+" : ""}${fmtNumber(p)}% (±5% counts as at the benchmark)` });
      const w = levelFromWords(t, TRI_WORDS);
      return w !== null ? ok(w) : unreadable;
    }
    case "hazard": {
      if (factor.on_property === true || factor.onProperty === true) return ok(2);
      if (s && !/m$/i.test(String(s.unit ?? ""))) return ok(Math.max(0, Math.min(2, Math.round(s.number))));
      const dist = s ? unitToMetres(s.number, s.unit) : parseDistanceM(t);
      if (/\bnot\s+on\s+(the\s+)?(property|site|title|lot)\b/.test(t)) return ok(dist !== null || /near|away|adjacent|close/.test(t) ? 1 : 0);
      if (/\bon\s+(the\s+)?(property|site|title|lot)\b|\bon-?site\b|affects (the )?property/.test(t)) return ok(2);
      if (/\b(none|nil|clear|not affected)\b|no overlay|no hazard|no risk|^no\b/.test(t)) return ok(0);
      if (dist !== null || /near|away|adjacent|close|within/.test(t)) return ok(1);
      return unreadable;
    }
    case "venues": {
      if (s && !/m$/i.test(String(s.unit ?? ""))) return ok(s.number, { counted: true });
      const n = /venue|bar|pub|place|club|\bof\b/.test(t) || /^\d+$/.test(t) ? parseCount(t) : null;
      if (n !== null) return ok(n, { counted: true });
      const d = s ? unitToMetres(s.number, s.unit) : parseDistanceM(t);
      const min = parseMinutes(t);
      if (d !== null) return ok(d <= DAILY_NEEDS_RADIUS_M ? 1 : 0, { note: "nearest venue only; count not reported" });
      if (min !== null) return ok(min <= 10 ? 1 : 0, { note: "nearest venue only; count not reported" });
      return unreadable;
    }
    case "rent": {
      const amounts = s ? [s.number] : parseMoney(t);
      if (!amounts.length) return unreadable;
      const period = parsePeriod(s ? String(s.unit ?? "") : t);
      const factorTo = { week: 1, month: 12 / 52, year: 1 / 52, quarter: 4 / 52 };
      const weekly = amounts[0] * (factorTo[period] ?? 1);
      const note = period && period !== "week" ? `converted from per ${period}` : period ? undefined : "period not stated, read as weekly";
      return ok(Math.round(weekly), { note, fallbackDisplay: `${fmtMoney(weekly)}/wk` });
    }
    case "money": {
      const amounts = s ? [s.number] : parseMoney(t);
      if (!amounts.length) return unreadable;
      let value = amounts[0];
      let low = s?.low ?? finite(factor.low ?? factor.value_low ?? factor.range_low);
      let high = s?.high ?? finite(factor.high ?? factor.value_high ?? factor.range_high);
      if (!s && amounts.length >= 2 && /\d\s*[kmb]?\s*(-|to)\s*\$/.test(t)) {
        [low, high] = [Math.min(amounts[0], amounts[1]), Math.max(amounts[0], amounts[1])];
        value = Math.round((low + high) / 2);
      }
      if (low === null || high === null) {
        const m = clean(factor.detail).match(/(\$[\d.,]+\s*[kmb]?)\s*(?:-|to)\s*(\$[\d.,]+\s*[kmb]?)/i);
        if (m) [low, high] = [parseMoney(m[1])[0] ?? null, parseMoney(m[2])[0] ?? null];
      }
      const extra = { fallbackDisplay: fmtMoney(value) };
      if (low !== null && high !== null) Object.assign(extra, { low, high });
      return ok(value, extra);
    }
    case "development": {
      if (s) return ok(Math.max(0, Math.min(2, Math.round(s.number))));
      const n = /\d/.test(t) && /\b(das?|applications?|projects?|sites?)\b/.test(t) ? parseCount(t) : null;
      if (n !== null) return ok(n === 0 ? 0 : n < 5 ? 1 : 2, { note: `level from ${n} DAs (1-4 some, 5+ heavy)` });
      const w = levelFromWords(t, DEV_WORDS);
      return w !== null ? ok(w) : unreadable;
    }
    case "negotiating": {
      const p = parsePercent(t);
      if (p !== null && /vacanc/.test(`${t} ${String(factor.label ?? "").toLowerCase()}`)) {
        return ok(p >= 3 ? 2 : p >= 1.5 ? 1 : 0, { note: `level from ${fmtNumber(p)}% vacancy (3%+ high, 1.5-3% mid)` });
      }
      const days = t.match(/(\d+)\s*days?\b/);
      if (days) {
        const d = Number(days[1]);
        return ok(d >= 60 ? 2 : d >= 30 ? 1 : 0, { note: `level from ${d} days on market (60+ high, 30-59 mid)` });
      }
      if (s) return ok(Math.max(0, Math.min(2, Math.round(s.number))));
      const w = levelFromWords(t, NEGOTIATING_WORDS);
      return w !== null ? ok(w) : unreadable;
    }
    default:
      return unreadable;
  }
}

// ---------- signals ----------

function unavailable(key, reason, source) {
  const spec = SIGNALS[DIMENSION_OF[key]][key];
  const signal = { available: false, label: spec.label, reason };
  if (source) signal.source = source;
  return signal;
}

function availableSignal(key, factor, read) {
  const spec = SIGNALS[DIMENSION_OF[key]][key];
  const signal = {
    available: true,
    value: read.value,
    unit: spec.unit,
    display: read.display,
    label: clean(factor.label) || spec.label,
    source: factor.source ? String(factor.source) : "backend",
    asOf: factor.as_of ?? factor.asOf ?? structured(factor)?.asOf ?? null,
  };
  if (typeof factor.value === "string") signal.raw = factor.value;
  if (read.note) signal.note = read.note;
  if (read.low !== undefined) signal.low = read.low;
  if (read.high !== undefined) signal.high = read.high;
  if (factor.detail) signal.detail = String(factor.detail);
  if (typeof factor.score === "number") signal.backendScore = factor.score;
  if (factor.impact) signal.impact = factor.impact;
  return signal;
}

function needCategory(factor) {
  const text = `${factor.key ?? ""} ${factor.label ?? ""}`.toLowerCase();
  if (/supermarket|grocer/.test(text)) return "supermarket";
  if (/\bgym\b|fitness/.test(text)) return "gym";
  if (/caf(e|é)|coffee/.test(text)) return "cafe";
  return null;
}

// Supermarket, gym and café can arrive as separate factors or one summary factor.
function dailyNeedsSignal(entries, extras = []) {
  const within = new Set();
  const reported = new Set();
  const parts = [];
  let explicit = null;
  let source = null;
  let asOf = null;
  let errors = [];
  // A factor we cannot use here is kept in extras (never silently dropped).
  const skip = (factor, reason) => {
    errors.push(reason);
    extras.push(extraOf(factor, `daily needs: ${reason}`));
  };
  for (const { factor } of entries) {
    source ??= factor.source ? String(factor.source) : null;
    asOf ??= factor.as_of ?? factor.asOf ?? null;
    const t = clean(factor.value).toLowerCase();
    const category = needCategory(factor);
    if (category) {
      if (/^(none|no|nil)\b|\bnone (within|nearby|near|in)\b/.test(t) && !/\b(no data|not (available|reported|known))\b/.test(t)) {
        reported.add(category); // reported, and not within reach
        parts.push(`${category === "cafe" ? "café" : category} none nearby`);
        continue;
      }
      const s = structured(factor);
      const d = s ? unitToMetres(s.number, s.unit) : parseDistanceM(t) ?? (parseMinutes(t) !== null ? parseMinutes(t) * WALK_M_PER_MIN : null);
      if (d === null) { skip(factor, t ? `could not read value ${clean(factor.value)}` : "backend sent no value"); continue; }
      reported.add(category);
      if (d <= DAILY_NEEDS_RADIUS_M) within.add(category);
      parts.push(`${category === "cafe" ? "café" : category} ${fmtDistance(d)}`);
      continue;
    }
    const ofThree = t.match(/(\d)\s*(?:of|\/)\s*3\b/);
    const listed = NEEDS.filter((c) => (c === "cafe" ? /caf(e|é)|coffee/ : new RegExp(`\\b${c}`)).test(t));
    if (ofThree) { explicit = Number(ofThree[1]); NEEDS.forEach((c) => reported.add(c)); parts.push(clean(factor.value)); }
    else if (listed.length) { listed.forEach((c) => { reported.add(c); within.add(c); }); parts.push(clean(factor.value)); }
    else if (finite(factor.value) !== null || structured(factor)) { explicit = finite(factor.value) ?? structured(factor).number; NEEDS.forEach((c) => reported.add(c)); parts.push(clean(String(factor.value ?? explicit))); }
    else skip(factor, t ? `could not read value ${clean(factor.value)}` : "backend sent no value");
  }
  if (!reported.size) return unavailable("daily_needs", errors[0] ?? NOT_PROVIDED, source);
  const value = explicit !== null ? Math.max(0, Math.min(3, explicit)) : within.size;
  const missing = NEEDS.filter((c) => !reported.has(c));
  const signal = {
    available: true,
    value,
    unit: "of 3",
    display: `${value} of 3 within ${DAILY_NEEDS_RADIUS_M} m${parts.length ? ` (${parts.join(", ")})` : ""}`,
    label: SIGNALS.lifestyle.daily_needs.label,
    source: source ?? "backend",
    asOf,
    reported: [...reported],
    within: [...within],
    missing,
  };
  if (missing.length) signal.note = `only ${[...reported].join(", ")} reported; ${missing.join(", ")} not reported by the backend`;
  return signal;
}

// Several factors can feed one signal: nearest wins for distances, worst hazard wins,
// venue counts add up, otherwise the first readable factor wins and the rest go to extras.
function mergeSignal(key, entries, extras) {
  if (key === "daily_needs") return dailyNeedsSignal(entries, extras);
  const reads = [];
  let firstError = null;
  for (const entry of entries) {
    const read = readFactor(key, entry.factor);
    if (read.error) firstError ??= { reason: read.error, source: entry.factor.source };
    else reads.push({ ...entry, read });
  }
  if (!reads.length) return unavailable(key, firstError?.reason ?? NOT_PROVIDED, firstError?.source);
  const kind = SIGNALS[DIMENSION_OF[key]][key].kind;
  let chosen = reads[0];
  if (kind === "distance_m" || kind === "distance_km") chosen = reads.reduce((a, b) => (b.read.value < a.read.value ? b : a));
  else if (kind === "hazard" || kind === "road_noise") chosen = reads.reduce((a, b) => (b.read.value > a.read.value ? b : a));
  const signal = availableSignal(key, chosen.factor, chosen.read);
  if (key === "crime_vs_benchmark" || key === "livability_vs_benchmark") {
    const text = `${chosen.factor.label ?? ""} ${chosen.factor.detail ?? ""}`.toLowerCase();
    const b = text.match(/\b(?:vs\.?|versus|compared (?:to|with)|than the)\s+(?:the\s+)?(national|state|nsw|suburb|city|regional|sydney|lga|council|block)\b/)
      || text.match(/\b(national|state|nsw|suburb|regional|sydney|city)\s+(?:median|average|benchmark|rate)\b/);
    const benchmark = b ? `vs ${b[1]} benchmark` : "benchmark not stated by the backend";
    signal.benchmark = b ? b[1] : null;
    signal.note = [benchmark, signal.note].filter(Boolean).join("; ");
  }
  if (kind === "venues" && reads.length > 1) {
    const counted = reads.filter((r) => r.read.counted);
    if (counted.length) signal.value = counted.reduce((sum, r) => sum + r.read.value, 0);
    signal.display = reads.map((r) => `${clean(r.factor.label)} ${r.read.display}`.trim()).join(", ");
    signal.label = SIGNALS.lifestyle.nightlife.label;
    return signal;
  }
  if (reads.length > 1) {
    const others = reads.filter((r) => r !== chosen);
    if (kind === "hazard") signal.note = [signal.note, `worst of ${reads.length}: ${reads.map((r) => `${clean(r.factor.label)} ${r.read.display}`).join(", ")}`].filter(Boolean).join("; ");
    for (const r of others) extras.push(extraOf(r.factor, `also mapped to ${key}; ${kind === "hazard" ? "worst hazard kept" : kind.startsWith("distance") ? "nearest kept" : "first kept"}`));
  }
  return signal;
}

function extraOf(factor, note) {
  const extra = {
    key: factor.key ?? null,
    label: factor.label ?? null,
    value: factor.value ?? null,
    source: factor.source ?? null,
  };
  if (note) extra.note = note;
  return extra;
}

/** Every canonical key present; unavailable ones carry the reason. */
export function emptyFacts(reason = NOT_PROVIDED) {
  const facts = {};
  for (const [dim, keys] of Object.entries(SIGNALS)) {
    facts[dim] = {};
    for (const key of Object.keys(keys)) facts[dim][key] = unavailable(key, reason);
  }
  facts.safety.social_housing = unavailable("social_housing", "no source wired in this build");
  return facts;
}

function factsFrom(response, extras) {
  const facts = emptyFacts(NOT_PROVIDED);
  const groups = {};
  const pillars = Array.isArray(response?.match?.pillars) ? response.match.pillars : [];
  for (const pillar of pillars) {
    const factors = Array.isArray(pillar?.factors) ? pillar.factors : [];
    for (const factor of factors) {
      if (!factor || typeof factor !== "object") continue;
      const key = classifyFactor(factor);
      if (!key || key === "social_housing") {
        extras.push(extraOf(factor, key ? "no social-housing source wired in this build" : `unmapped factor in ${pillar.key ?? "pillar"}`));
        continue;
      }
      (groups[key] ??= []).push({ factor, pillar: pillar.key ?? null });
    }
  }
  for (const [key, entries] of Object.entries(groups)) {
    if (key === "parking" && finite(response?.property?.parking_count) !== null) {
      entries.forEach((e) => extras.push(extraOf(e.factor, "parking taken from property.parking_count")));
      continue;
    }
    facts[DIMENSION_OF[key]][key] = mergeSignal(key, entries, extras);
  }
  const parking = finite(response?.property?.parking_count);
  if (parking !== null) {
    facts.commute.parking = {
      available: true,
      value: parking,
      unit: "spaces",
      display: `${parking} ${parking === 1 ? "space" : "spaces"}`,
      label: SIGNALS.commute.parking.label,
      source: "/v1/properties/{gnaf_id}/basics/all",
      asOf: null,
    };
  }
  return facts;
}

// ---------- address confidence ----------

const STREET_ABBR = {
  st: "street", str: "street", rd: "road", ave: "avenue", av: "avenue", pde: "parade", hwy: "highway",
  ln: "lane", la: "lane", pl: "place", cres: "crescent", cr: "crescent", cresc: "crescent", dr: "drive",
  drv: "drive", ct: "court", crt: "court", tce: "terrace", ter: "terrace", sq: "square", blvd: "boulevard",
  bvd: "boulevard", cct: "circuit", cl: "close", esp: "esplanade", gr: "grove", gve: "grove", wy: "way",
  pkwy: "parkway", gdns: "gardens", prom: "promenade", qy: "quay", arc: "arcade", wlk: "walk", mt: "mount",
};
const STREET_TYPES = new Set([
  "street", "road", "avenue", "parade", "highway", "lane", "place", "crescent", "drive", "court", "terrace",
  "square", "boulevard", "circuit", "close", "esplanade", "grove", "way", "walk", "parkway", "gardens", "mews",
  "row", "quay", "promenade", "rise", "plaza", "arcade", "alley", "loop", "glade", "path", "ridge", "wharf",
]);

/** { unit, number, street, suburb } from free address text, normalised; null if empty. */
export function parseAddress(text) {
  let s = clean(text).toLowerCase();
  if (!s) return null;
  s = s.replace(/\((nsw|act|vic|qld)\)/g, " ").replace(/\b(new south wales|nsw|australia)\b/g, " ");
  s = s.replace(/\s+/g, " ").replace(/[\s,]+$/, "").replace(/[\s,]*\b\d{4}$/, "").replace(/[\s,]+$/, "").trim();
  let unit = null;
  let number = null;
  let m;
  s = s.replace(/^(?:level|lvl|floor)\s*\d+[a-z]?\s*[,/]?\s*/, "");
  if ((m = s.match(/^(?:unit|apartment|apt|flat|suite|ste|villa|townhouse|shop|u)\.?\s*([a-z]?\d+[a-z]?)\s*[,/]?\s*/))) {
    unit = m[1];
    s = s.slice(m[0].length);
  } else if ((m = s.match(/^([a-z]?\d+[a-z]?)\s*\/\s*/))) {
    unit = m[1];
    s = s.slice(m[0].length);
  }
  if ((m = s.match(/^(\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?)\s*,?\s+/))) {
    number = m[1].replace(/\s+/g, "");
    s = s.slice(m[0].length);
  }
  const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  let words = (parts[0] || "").replace(/[.']/g, "").split(/\s+/).filter(Boolean).map((w) => STREET_ABBR[w] || w);
  let suburb = parts.slice(1).join(" ");
  if (parts.length <= 1) {
    const idx = words.findIndex((w, i) => i > 0 && STREET_TYPES.has(w));
    if (idx >= 0 && idx < words.length - 1) {
      suburb = words.slice(idx + 1).join(" ");
      words = words.slice(0, idx + 1);
    }
  }
  suburb = suburb.replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  return { unit, number, street: words.join(" ") || null, suburb: suburb || null };
}

function numbersAgree(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const range = (n) => {
    const [lo, hi] = n.split("-").map((x) => parseInt(x, 10));
    return [lo, Number.isFinite(hi) ? hi : lo];
  };
  const [alo, ahi] = range(a);
  const [blo, bhi] = range(b);
  return alo <= bhi && blo <= ahi && (a.includes("-") || b.includes("-"));
}

/** "exact" | "building" | "guess": does the matched address agree with the listing's? */
export function matchConfidence(query, matchedAddress) {
  const q = parseAddress(query);
  const m = parseAddress(matchedAddress);
  if (!q || !m || !q.street || !m.street) return "guess";
  const sameSuburb = !q.suburb || !m.suburb || q.suburb === m.suburb;
  if (q.street !== m.street || !sameSuburb || !numbersAgree(q.number, m.number)) return "guess";
  return q.unit === m.unit && q.number === m.number ? "exact" : "building";
}

// ---------- the adapter ----------

const DEFAULT_MESSAGES = {
  loading: null,
  need_address: "We couldn't read the address on this page. Type it below.",
  empty: "Open a listing on realestate.com.au or domain.com.au.",
  ambiguous: "Which home is this?",
  no_match: "We couldn't find that address in the City of Sydney.",
  out_of_area: "MicroMatch covers the City of Sydney only for now.",
  error: "Something went wrong reaching MicroMatch. Try again.",
};

function candidatesOf(list) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && typeof c === "object")
    .map((c) => ({
      gnaf_id: c.gnaf_id ?? c.id ?? null,
      display_name: c.address ?? c.display_name ?? null,
      property_type: c.property_type ?? null,
    }));
}

function base(status, stored, options) {
  const fetchedAt = stored?.fetchedAt ?? stored?.fetched_at ?? (options.now ? new Date(options.now).toISOString() : null);
  return {
    status,
    query: typeof stored?.query === "string" ? stored.query : null,
    mock: stored?.mock === true,
    fetchedAt,
    message: typeof stored?.message === "string" && stored.message ? stored.message : DEFAULT_MESSAGES[status] ?? null,
    matched: null,
    property: null,
    facts: emptyFacts(status === "matched" ? NOT_PROVIDED : NO_MATCH_YET),
    outsideCoverage: status === "out_of_area",
    backend: null,
    extras: [],
    candidates: [],
  };
}

// ---------- README Contract 2 (team proxy: GET /lookup) ----------
// { matched: { gnaf_id, display_name, suburb, confidence, candidates }, facts: { commute|safety|lifestyle|price:
//   { <signal>: { value, unit, label, source, asOf, available } } }, outsideCoverage, error? }
// Proxy signal name -> canonical score.js key, with the unit conversion score.js expects.
const C2_MAP = {
  commute: {
    nearestTransport: { key: "transit_walk", value: (v) => Math.round(v * 1000) }, // km -> m
    workDistance: { key: "work_distance", value: (v) => v }, // km
    cbdDistance: { key: "cbd_distance", value: (v) => v }, // km
    parking: { key: "parking", value: (v) => v }, // spaces
    roadNoise: { key: "road_noise", value: (v) => v }, // 0 none, 1 nearby, 2 fronting
  },
  safety: {
    blockCrime: { key: "crime_vs_benchmark", value: (v) => v, note: "block vs suburb median" }, // %
    livability: { key: "livability_vs_benchmark", value: (v) => (v > 5 ? 1 : v < -5 ? -1 : 0), note: "points vs regional benchmark; within ±5 points counts as at it" },
    hazards: { key: "hazards_on_property", value: (v) => v }, // 0 none, 1 nearby only, 2 on property
    socialHousing: { key: "social_housing", skip: "not scored in this build" },
  },
  lifestyle: {
    dailyAmenities: { key: "daily_needs", value: (v) => Math.max(0, Math.min(3, Math.round(v))), extra: { reportedCount: 3, missing: [] } },
    nightlife: { key: "nightlife", value: (v) => v }, // venues
    greenSpace: { key: "green_space", value: (v) => Math.round(v * 1000) }, // km -> m
  },
  price: {
    rentAffordability: { key: "rent_weekly", value: (v) => v }, // AUD/week rent; score.js divides by income
    buyAffordability: { key: "avm", value: (v) => v }, // AUD
    comparableValue: { key: "value_vs_comps", value: (v) => v }, // % vs 3 comps
    runningCosts: { key: "running_costs", skip: "suburb median levy only; no below/at/above comparison yet" },
    developmentPressure: { key: "development_pressure", skip: "no agreed cut-offs for the construction-change score yet" },
    negotiatingRoom: { key: "negotiating_room", value: (v) => (v < 1 ? 0 : v <= 3 ? 1 : 2), note: "vacancy under 1% tight, 1-3% mid, over 3% high" }, // %
  },
};

function c2Display(key, value, raw) {
  const sign = (n, d = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}`;
  const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2).replace(/\.?0+$/, "")}m` : n >= 1e4 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n).toLocaleString("en-AU")}`);
  switch (key) {
    case "transit_walk": case "green_space": return fmtDistance(value);
    case "work_distance": case "cbd_distance": return `${value.toFixed(1)} km`;
    case "parking": return `${value} ${value === 1 ? "space" : "spaces"}`;
    case "road_noise": return ["no busy road", "busy road nearby", "fronts a busy road"][value] ?? String(raw);
    case "crime_vs_benchmark": return `${sign(value)}% vs suburb median`;
    case "livability_vs_benchmark": return `${sign(raw)} pts vs region`;
    case "hazards_on_property": return ["none mapped", "nearby only", "on the property"][value] ?? String(raw);
    case "daily_needs": return `${value} of 3 within 800 m`;
    case "nightlife": return `${value} venues within 800 m`;
    case "rent_weekly": return `${money(value)}/wk`;
    case "avm": return money(value);
    case "value_vs_comps": return `${sign(value)}% vs comps`;
    case "negotiating_room": return `${raw.toFixed(2)}% vacancy`;
    default: return String(raw);
  }
}

function contract2Facts(facts) {
  const out = emptyFacts(NOT_PROVIDED);
  for (const [dim, rules] of Object.entries(C2_MAP)) {
    const group = facts && typeof facts[dim] === "object" && facts[dim] ? facts[dim] : {};
    for (const [name, rule] of Object.entries(rules)) {
      const spec = SIGNALS[dim]?.[rule.key];
      const src = group[name];
      if (!spec || !src || typeof src !== "object") continue; // stays "not provided"
      const common = { label: clean(src.label) || spec.label, source: src.source ? String(src.source) : "proxy" };
      if (rule.skip) { out[dim][rule.key] = { available: false, ...common, reason: rule.skip }; continue; }
      const raw = finite(src.value);
      if (src.available === false || raw === null) {
        out[dim][rule.key] = { available: false, ...common, reason: src.available === false ? "no data from Microburbs for this home" : `could not read value ${src.value}` };
        continue;
      }
      const value = rule.value(raw);
      out[dim][rule.key] = {
        available: true, value, unit: spec.unit, display: c2Display(rule.key, value, raw), ...common,
        asOf: src.asOf ?? src.as_of ?? null, raw: String(src.value), ...(rule.note ? { note: rule.note } : {}), ...(rule.extra || {}),
      };
    }
  }
  return out;
}

function adaptContract2(stored, options) {
  const err = stored.error && typeof stored.error === "object" ? stored.error : null;
  const m = stored.matched && typeof stored.matched === "object" ? stored.matched : null;
  const status = err ? "error" : stored.outsideCoverage === true ? "out_of_area" : !m ? "no_match" : m.gnaf_id ? "matched" : "ambiguous";
  const out = base(status, stored, options);
  if (err) { out.code = err.code ?? null; out.message = err.message || out.message; return out; }
  const candidates = (Array.isArray(m?.candidates) ? m.candidates : [])
    .filter((c) => c && typeof c === "object")
    .map((c) => ({ gnaf_id: c.gnaf_id ?? null, display_name: c.display_name ?? c.address ?? null, property_type: c.property_type ?? null }))
    .filter((c) => c.display_name);
  out.candidates = candidates;
  if (status !== "matched") {
    if (m) out.matched = { gnaf_id: null, display_name: m.display_name ?? null, suburb: m.suburb ?? null, confidence: m.confidence ?? null, candidates };
    return out;
  }
  out.message = null;
  out.matched = {
    gnaf_id: m.gnaf_id,
    display_name: m.display_name ?? null,
    suburb: m.suburb ?? null,
    confidence: ["exact", "building", "guess"].includes(m.confidence) ? m.confidence : (m.display_name ? matchConfidence(out.query, m.display_name) : "guess"),
    candidates,
  };
  out.facts = contract2Facts(stored.facts);
  return out;
}

/**
 * Backend response (or background placeholder) -> adapter output for score.js and the panel.
 * options.now (Date/ms/ISO) fills fetchedAt when background did not store one.
 */
export function adapt(stored, options = {}) {
  if (!stored || typeof stored !== "object") return base("empty", null, options);
  const status = typeof stored.status === "string" ? stored.status : null;

  // The team proxy's README Contract 2 (background marks it contract: 2; detect the bare shape too).
  if (stored.contract === 2 || (status === null && stored.facts && typeof stored.facts === "object" && ("matched" in stored || "outsideCoverage" in stored))) {
    return adaptContract2(stored, options);
  }

  if (status === "loading" || status === "need_address" || status === "empty") return base(status, stored, options);

  if (status === "out_of_area") return base("out_of_area", stored, options);

  if (status === "ambiguous" || status === "no_match") {
    const out = base(status, stored, options);
    out.candidates = candidatesOf(stored.candidates);
    out.matched = { gnaf_id: null, display_name: null, suburb: null, confidence: null, candidates: out.candidates };
    return out;
  }

  if (status === "matched") {
    const property = stored.property && typeof stored.property === "object" ? stored.property : null;
    if (!property) {
      return { ...base("error", stored, options), message: "MicroMatch did not say which home it matched." };
    }
    const out = base("matched", stored, options);
    out.message = null;
    const displayName = typeof property.address === "string" && property.address.trim() ? property.address.trim() : null;
    out.candidates = candidatesOf(stored.candidates);
    out.matched = {
      gnaf_id: property.gnaf_id ?? null,
      display_name: displayName,
      suburb: property.suburb ?? null,
      confidence: displayName ? matchConfidence(out.query, displayName) : "guess",
      candidates: out.candidates,
    };
    out.property = {
      dwelling_type: property.dwelling_type ?? null,
      bed_count: finite(property.bed_count),
      bath_count: finite(property.bath_count),
      parking_count: finite(property.parking_count),
      land_area_sqm: finite(property.land_area_sqm),
    };
    out.facts = factsFrom(stored, out.extras);
    const match = stored.match && typeof stored.match === "object" ? stored.match : {};
    out.backend = {
      overall: finite(match.overall),
      label: match.label ?? null,
      summary: match.summary ?? null,
      dealbreakers: (Array.isArray(match.dealbreakers) ? match.dealbreakers : [])
        .filter((d) => d && typeof d === "object")
        .map((d) => ({ key: d.key ?? null, message: d.message ?? "" })),
      data_gaps: (Array.isArray(stored.data_gaps) ? stored.data_gaps : []).map(String),
      pillars: (Array.isArray(match.pillars) ? match.pillars : [])
        .filter((p) => p && typeof p === "object")
        .map((p) => ({ key: p.key ?? null, label: p.label ?? null, score: finite(p.score), weight: finite(p.weight), summary: p.summary ?? null })),
    };
    return out;
  }

  // "error", HTTP error bodies, Django { detail } bodies and any status we don't know.
  const out = base("error", stored, options);
  out.code = stored.code ?? null;
  if (status && status !== "error") out.message = `Unexpected answer from MicroMatch (${status}). Try again.`;
  else if (!stored.message && typeof stored.detail === "string") out.message = stored.detail;
  return out;
}

export default adapt;
