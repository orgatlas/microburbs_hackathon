// Halos and failos: the top three facts pulling the fit score up, and the top three pulling it down.
//
//   renderHalos(container, { halos, failos, fetchedAt }) -> { update(next), el }
//
// Items come from score.js scoreListing():
//   { dimension, key, label, score, value, unit, display, source, asOf, contribution }
// Each one renders as li.mm-halo[data-signal][data-kind="halo"|"failo"] with the short label, the value
// with its unit, and a muted line "via /transport/nearby · as of Aug 2026" (the full endpoint path is
// in the title). A missing as-of says so: "as of: not provided, fetched 7 Nov 2026" (from fetchedAt).
//
// The DOM is built with createElement and textContent only: nothing from the backend is parsed as HTML.
// The stylesheet is injected once as <style id="mm-css-halos"> and uses only the panel's --mm-* tokens.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_ITEMS = 3;
const DASH = "–";
const STYLE_ID = "mm-css-halos";

const GROUPS = [
  { kind: "halo", prop: "halos", title: "Halos", hint: "Pulling the score up", empty: "No halos for your profile" },
  { kind: "failo", prop: "failos", title: "Failos", hint: "Pulling the score down", empty: "No failos for your profile" },
];

const INK = "var(--mm-ink, #18191b)";
const MUTED = "var(--mm-muted, #62666d)";
const HAIRLINE = "1px solid var(--mm-hairline, rgba(0, 0, 0, .08))";

const CSS = `
.mm-halos{font-family:var(--mm-font, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
  font-size:13px;line-height:1.45;color:${INK};font-variant-numeric:tabular-nums;text-align:left}
.mm-halos *,.mm-halos *::before,.mm-halos *::after{box-sizing:border-box}
:where(.mm-halos) :where(h3,p,ul,li){margin:0;padding:0}
:where(.mm-halos) :where(ul){list-style:none}
.mm-halos__group+.mm-halos__group{margin-top:18px}
.mm-halos__head{display:flex;align-items:baseline;gap:8px;padding-bottom:6px;border-bottom:${HAIRLINE}}
.mm-halos__title{font-size:11px;font-weight:600;line-height:16px;letter-spacing:.06em;text-transform:uppercase}
.mm-halos__group--halo .mm-halos__word{color:var(--mm-halo, #00806f)}
.mm-halos__group--failo .mm-halos__word{color:var(--mm-failo, #b42318)}
.mm-halos__count{margin-left:4px;color:${MUTED};letter-spacing:0}
.mm-halos__hint{margin-left:auto;font-size:11px;line-height:16px;color:${MUTED};text-align:right}
.mm-halo{display:grid;grid-template-columns:minmax(0,1fr) fit-content(50%);column-gap:12px;row-gap:2px;
  align-items:baseline;padding:9px 0}
.mm-halo+.mm-halo{border-top:${HAIRLINE}}
.mm-halo__label{grid-column:1;min-width:0;font-weight:500;overflow-wrap:anywhere}
.mm-halo__value{grid-column:2;min-width:0;font-weight:600;text-align:right;white-space:normal;overflow-wrap:anywhere}
.mm-halo__value--none{font-weight:400;color:${MUTED}}
.mm-halo__meta{grid-column:1/-1;min-width:0;font-size:11px;line-height:1.4;color:${MUTED};overflow-wrap:anywhere}
/* each part wraps as a unit when it fits on a line of its own, and inside itself when it does not */
.mm-halo__src,.mm-halo__when{display:inline-block;max-width:100%}
.mm-halo__via[title]{cursor:help}
.mm-halo__sep{padding:0 2px}
.mm-halos__empty{padding:9px 0;font-size:12px;line-height:1.4;color:${MUTED}}
`;

let uidCounter = 0;

function isStr(s) {
  return typeof s === "string" && s.trim() !== "";
}

function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function make(doc, tag, cls, text) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

// ---------- dates (parsed by hand, so a "2026-08-01" never shifts a month with the timezone) ----------

// "YYYY-MM" or "YYYY-MM-DD", optionally followed by a time and zone. Anything else is not a date.
const YMD_RE = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?(?:[T ](\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;

export function parseYmd(s) {
  if (!isStr(s)) return null;
  const m = YMD_RE.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = m[3] ? Number(m[3]) : null;
  if (mo < 1 || mo > 12) return null;
  if (d !== null && (d < 1 || new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d)) return null; // e.g. 31 Feb
  return { y, m: mo, d, timed: Boolean(m[4]) };
}

// fetchedAt -> "7 Nov 2026". A timestamp is shown as the viewer's local date (the day they fetched it);
// a bare "YYYY-MM-DD" is taken as written. Accepts an ISO string, a Date or epoch milliseconds.
export function fetchedText(v) {
  let dt = null;
  if (v instanceof Date) dt = v;
  else if (isNum(v)) dt = new Date(v);
  else if (isStr(v)) {
    const p = parseYmd(v);
    if (p && !p.timed) return (p.d ? `${p.d} ` : "") + `${MONTHS[p.m - 1]} ${p.y}`;
    dt = new Date(v.trim());
  }
  if (!dt || Number.isNaN(dt.getTime())) return null;
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

// asOf "2026-08-14" -> "as of Aug 2026"; a non-date asOf ("2021 Census") verbatim after "as of";
// missing -> "as of: not provided, fetched 7 Nov 2026" (or just "as of: not provided" without fetchedAt).
export function asOfText(asOf, fetchedAt) {
  if (asOf instanceof Date && !Number.isNaN(asOf.getTime())) {
    return { text: `as of ${MONTHS[asOf.getMonth()]} ${asOf.getFullYear()}`, missing: false };
  }
  if (isNum(asOf)) return { text: `as of ${asOf}`, missing: false };
  if (isStr(asOf)) {
    const t = asOf.trim();
    const p = parseYmd(t);
    if (p) return { text: `as of ${MONTHS[p.m - 1]} ${p.y}`, missing: false };
    return { text: /^as of\b/i.test(t) ? t : `as of ${t}`, missing: false };
  }
  const f = fetchedText(fetchedAt);
  return { text: f ? `as of: not provided, fetched ${f}` : "as of: not provided", missing: true };
}

// ---------- sources ----------

// "/v1/properties/{gnaf_id}/transport/nearby" -> "/transport/nearby";
// "/v1/suburbs/{suburb_name}/crime/by-mesh-block" -> "/crime/by-mesh-block". Also copes with a concrete
// gnaf_id or suburb in place of the template, a full URL, or a query string. Anything else is kept as is.
export function shortSource(path) {
  if (!isStr(path)) return null;
  const full = path.trim();
  const s = full.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "").replace(/[?#].*$/, "");
  const m = /^\/?(?:v1\/)?(?:properties|suburbs)\/[^/]+(\/.+)$/i.exec(s);
  return m ? m[1] : s || full;
}

// source can be a string, a list of strings, or one string joining several paths with " + ", "," or ";".
export function sourceParts(source) {
  const raw = Array.isArray(source) ? source : isStr(source) ? source.split(/\s+\+\s+|\s*;\s*|\s*,\s*(?=\/)/) : [];
  const full = [];
  const short = [];
  for (const entry of raw) {
    if (!isStr(entry)) continue;
    const f = entry.trim();
    const s = shortSource(f);
    if (!full.includes(f)) full.push(f);
    if (s && !short.includes(s)) short.push(s);
  }
  return { full, short };
}

// ---------- values ----------

function formatNumber(n) {
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return n.toLocaleString("en-AU", { maximumFractionDigits: digits });
}

// The value with its unit. score.js sends a ready-made `display`; this only builds one when it is missing.
export function displayText(item) {
  if (!item || typeof item !== "object") return null;
  if (isStr(item.display)) return item.display.trim();
  const v = item.value;
  let text;
  if (isNum(v)) text = formatNumber(v);
  else if (typeof v === "boolean") text = v ? "Yes" : "No";
  else if (isStr(v)) text = v.trim();
  else return null;
  const unit = isStr(item.unit) ? item.unit.trim() : "";
  if (!unit) return text;
  if (unit === "%") return text + unit;
  if (unit === "$") return `$${text}`;
  return `${text} ${unit}`;
}

function labelText(item) {
  if (isStr(item.label)) return item.label.trim();
  if (isStr(item.key)) {
    const t = item.key.trim().replace(/[_-]+/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return DASH;
}

// ---------- DOM ----------

function buildItem(doc, item, kind, fetchedAt) {
  const li = make(doc, "li", "mm-halo");
  li.setAttribute("data-signal", isStr(item.key) ? item.key.trim() : "");
  li.setAttribute("data-kind", kind);
  if (isStr(item.dimension)) li.setAttribute("data-dimension", item.dimension.trim());
  if (isNum(item.score)) li.setAttribute("data-score", String(Math.round(item.score)));

  li.appendChild(make(doc, "span", "mm-halo__label", labelText(item)));

  const shown = displayText(item);
  const value = make(doc, "span", shown ? "mm-halo__value" : "mm-halo__value mm-halo__value--none", shown || DASH);
  if (!shown) value.setAttribute("title", "Value not provided");
  li.appendChild(value);

  const meta = make(doc, "span", "mm-halo__meta");
  const src = sourceParts(item.source !== undefined ? item.source : item.via);
  const srcPart = make(doc, "span", "mm-halo__src");
  if (src.short.length) {
    srcPart.appendChild(doc.createTextNode("via "));
    const via = make(doc, "span", "mm-halo__via", src.short.join(" + "));
    via.setAttribute("title", src.full.join("\n"));
    srcPart.appendChild(via);
  } else {
    srcPart.appendChild(make(doc, "span", "mm-halo__via mm-halo__via--none", "source: not provided"));
  }
  meta.appendChild(srcPart);
  const sep = make(doc, "span", "mm-halo__sep", "·");
  sep.setAttribute("aria-hidden", "true");
  meta.appendChild(doc.createTextNode(" "));
  meta.appendChild(sep);
  meta.appendChild(doc.createTextNode(" "));
  const when = asOfText(item.asOf !== undefined ? item.asOf : item.as_of, fetchedAt);
  meta.appendChild(make(doc, "span", when.missing ? "mm-halo__when mm-halo__when--missing" : "mm-halo__when", when.text));
  li.appendChild(meta);
  return li;
}

function buildGroup(doc, spec, items, fetchedAt, uid) {
  const list = (Array.isArray(items) ? items : [])
    .filter((x) => x && typeof x === "object")
    .slice(0, MAX_ITEMS);

  const group = make(doc, "section", `mm-halos__group mm-halos__group--${spec.kind}`);
  group.setAttribute("data-kind", spec.kind);
  group.setAttribute("data-count", String(list.length));

  const head = make(doc, "div", "mm-halos__head");
  const title = make(doc, "h3", "mm-halos__title");
  title.id = `${uid}-${spec.kind}`;
  title.appendChild(make(doc, "span", "mm-halos__word", spec.title));
  title.appendChild(doc.createTextNode(" ")); // read as "Halos 3"
  title.appendChild(make(doc, "span", "mm-halos__count", String(list.length)));
  head.appendChild(title);
  head.appendChild(make(doc, "span", "mm-halos__hint", spec.hint));
  group.setAttribute("aria-labelledby", title.id);
  group.appendChild(head);

  if (list.length) {
    const ul = make(doc, "ul", "mm-halos__list");
    for (const item of list) ul.appendChild(buildItem(doc, item, spec.kind, fetchedAt));
    group.appendChild(ul);
  } else {
    group.appendChild(make(doc, "p", "mm-halos__empty", spec.empty));
  }
  return group;
}

function injectCss(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = make(doc, "style", null, CSS);
  style.id = STYLE_ID;
  (doc.head || doc.documentElement).appendChild(style);
}

function normalise(data, previous) {
  const d = data && typeof data === "object" ? data : {};
  let fetchedAt = d.fetchedAt !== undefined ? d.fetchedAt : d.fetched_at;
  // An update after re-weighting carries no fetchedAt: the facts were not re-fetched, so keep the old one.
  if (fetchedAt === undefined && previous) fetchedAt = previous.fetchedAt;
  return { halos: d.halos, failos: d.failos, fetchedAt };
}

export function renderHalos(container, data) {
  if (!container || typeof container.appendChild !== "function") {
    throw new TypeError("renderHalos: a container element is required");
  }
  const doc = container.ownerDocument || globalThis.document;
  injectCss(doc);

  // One list per container: a second render replaces the first instead of stacking.
  for (const old of Array.from(container.children || [])) {
    if (old.classList && old.classList.contains("mm-halos")) container.removeChild(old);
  }

  const uid = `mm-halos-${++uidCounter}`;
  const root = make(doc, "div", "mm-halos");
  container.appendChild(root);

  let state = normalise(data, null);
  const draw = () => {
    while (root.firstChild) root.removeChild(root.firstChild);
    for (const spec of GROUPS) root.appendChild(buildGroup(doc, spec, state[spec.prop], state.fetchedAt, uid));
  };
  draw();

  const handle = {
    el: root,
    update(next) {
      state = normalise(next, state);
      draw();
      return handle;
    },
  };
  return handle;
}
