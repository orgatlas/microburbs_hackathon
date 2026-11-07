// adapter.js: maps what background.js stores per tab to the signal shape score.js consumes.
// The ONLY source of facts is the team proxy's README Contract 2 answer to GET /lookup
// ({ matched, facts, outsideCoverage, error? }; background marks it contract: 2). Besides that,
// background writes placeholders ({ status: "loading" | "need_address" | "empty" }) and its own
// error records ({ status: "error", code, message }). Any other shape is an error, never data.
// Pure ES module: no chrome.*, no DOM, no network. A fact we cannot read is reported as
// unavailable with a reason, never as zero.

const NOT_PROVIDED = "not provided by the backend";
const NO_MATCH_YET = "no matched home yet";

// One entry per README scoring-table row: the label and unit score.js and the panel show.
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

// ---------- helpers ----------

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

function fmtNumber(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}
function fmtDistance(m) {
  return m >= 1000 ? `${fmtNumber(m / 1000)} km` : `${Math.round(m)} m`;
}

// ---------- signals ----------

function unavailable(key, reason, source) {
  const spec = SIGNALS[DIMENSION_OF[key]][key];
  const signal = { available: false, label: spec.label, reason };
  if (source) signal.source = source;
  return signal;
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

function base(status, stored, options) {
  const fetchedAt = stored?.fetchedAt ?? stored?.fetched_at ?? (options.now ? new Date(options.now).toISOString() : null);
  return {
    status,
    query: typeof stored?.query === "string" ? stored.query : null,
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
  // An error from the proxy ({ error }) or one background derived from the HTTP status.
  const err = stored.error && typeof stored.error === "object" ? stored.error
    : stored.status === "error" ? { code: stored.code ?? null, message: stored.message ?? null } : null;
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
 * Stored record -> adapter output for score.js and the panel. README Contract 2 records from the
 * proxy are the only source of facts; options.now (Date/ms/ISO) fills fetchedAt when missing.
 */
export function adapt(stored, options = {}) {
  if (!stored || typeof stored !== "object") return base("empty", null, options);
  const status = typeof stored.status === "string" ? stored.status : null;

  // The team proxy's README Contract 2 (background marks it contract: 2; detect the bare shape too).
  if (stored.contract === 2 || (status === null && stored.facts && typeof stored.facts === "object" && ("matched" in stored || "outsideCoverage" in stored))) {
    return adaptContract2(stored, options);
  }

  // Placeholders background.js writes while it works, or when the page has no address.
  if (status === "loading" || status === "need_address" || status === "empty") return base(status, stored, options);

  // Errors background.js writes itself: offline (network failure or timeout), HTTP without JSON, ...
  if (status === "error") {
    const out = base("error", stored, options);
    out.code = typeof stored.code === "string" && stored.code ? stored.code : null;
    return out;
  }

  // Any other shape (an old backend's or a mock's answer) is never rendered as data.
  return { ...base("error", null, options), code: "unexpected", message: "Unexpected answer from the proxy" };
}

export default adapt;
