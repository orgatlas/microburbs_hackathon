// MicroMatch side panel: the four dimension rows (Commute, Safety, Lifestyle, Price).
//
//   renderSliders(container, { dimensions }) -> { update(next), el }
//
// `dimensions` is scoreListing(...).dimensions from score.js:
//   [{ key, label, score: number|null, weight: 0..1, signals: [{ score, ... }] }]
// Rows are read-only meters (not inputs): a track with a thumb at the score,
// coloured by band, with the band word always shown as text (never colour alone).
// A dimension with no scored signal shows "Not scored", never 0.
// DOM is built with createElement/textContent only. No chrome.*, no network.

const ORDER = [
  { key: "commute", label: "Commute" },
  { key: "safety", label: "Safety" },
  { key: "lifestyle", label: "Lifestyle" },
  { key: "price", label: "Price" },
];

const BAND_WORD = { halo: "Halo", meh: "Meh", failo: "Failo" };

// Same edges as the speedo: Failo 0-30, Meh 31-69, Halo 70-100.
function bandOf(score) {
  if (score === null) return null;
  if (score >= 70) return "halo";
  if (score <= 30) return "failo";
  return "meh";
}

function toScore(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

// Profile weights are 0..1 (normalised by score.js). Accept 0..100 too, defensively.
function toWeight(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 1 ? n / 100 : n;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function coverageOf(dim) {
  const signals = Array.isArray(dim?.signals) ? dim.signals : [];
  const total = signals.length;
  const scored = signals.filter((s) => toScore(s?.score) !== null).length;
  return { total, scored, missing: total - scored };
}

function describe(meta, dim) {
  const score = toScore(dim?.score);
  const band = (dim && BAND_WORD[dim.band] && score !== null) ? dim.band : bandOf(score);
  const weight = toWeight(dim?.weight);
  const pct = weight === null ? null : Math.round(weight * 100);
  const cov = coverageOf(dim);
  const label = (typeof dim?.label === "string" && dim.label.trim()) ? dim.label.trim() : meta.label;

  let note = "";
  if (score === null) {
    note = cov.total > 0 ? `No data for ${plural(cov.total, "signal")}` : "No signals available";
  } else if (cov.total > 0 && cov.scored < cov.total) {
    note = `Based on ${cov.scored} of ${plural(cov.total, "signal")}`;
  }

  const weightText = pct === null ? "" : `weight ${pct}%`;
  const parts = [];
  parts.push(score === null ? "Not scored" : `${score} out of 100, ${BAND_WORD[band]}`);
  if (note) parts.push(note);
  if (weightText) parts.push(`Weight ${pct}%`);

  return {
    key: meta.key,
    label,
    score,
    band,
    weight,
    weightText,
    note,
    valueText: parts.join(". ") + ".",
  };
}

const CSS = `
.mm-sliders { font-family: var(--mm-font, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif); color: var(--mm-ink, #18191b); font-size: 13px; line-height: 1.45; }
.mm-sliders__title { margin: 0 0 10px; font-size: 12px; font-weight: 600; color: var(--mm-muted, #62666d); letter-spacing: 0; }
.mm-sliders__list { display: flex; flex-direction: column; gap: 14px; margin: 0; padding: 0; }
.mm-slider { display: block; margin: 0; padding: 0; cursor: default; }
.mm-slider__head { display: flex; align-items: baseline; gap: 8px; min-height: 22px; }
.mm-slider__label { font-weight: 600; font-size: 13px; color: var(--mm-ink, #18191b); }
.mm-slider__weight { font-size: 12px; color: var(--mm-muted, #62666d); font-variant-numeric: tabular-nums; }
.mm-slider__value { margin-left: auto; display: inline-flex; align-items: baseline; gap: 6px; }
.mm-slider__score { font-size: 15px; font-weight: 650; font-variant-numeric: tabular-nums; color: var(--mm-ink, #18191b); min-width: 2ch; text-align: right; }
.mm-slider__tag { font-size: 11px; font-weight: 600; line-height: 16px; padding: 0 6px; border-radius: 4px; }
.mm-slider[data-band="halo"] .mm-slider__tag { color: var(--mm-halo, #00806f); background: var(--mm-halo-tint, #e6f4f1); }
.mm-slider[data-band="meh"] .mm-slider__tag { color: var(--mm-meh, #9a6a00); background: var(--mm-meh-tint, #fff5db); }
.mm-slider[data-band="failo"] .mm-slider__tag { color: var(--mm-failo, #b42318); background: var(--mm-failo-tint, #fdecea); }
.mm-slider[data-band="none"] .mm-slider__score { font-size: 12px; font-weight: 500; color: var(--mm-muted, #62666d); }
.mm-slider[data-band="none"] .mm-slider__tag { display: none; }

.mm-slider__track { --mm-p: 0; --mm-thumb: 14px; position: relative; height: 6px; margin: 6px 0 0; border-radius: 3px; background: var(--mm-hairline, rgba(0,0,0,.08)); }
.mm-slider__fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; width: calc(var(--mm-thumb) / 2 + var(--mm-p) * (100% - var(--mm-thumb))); background: var(--mm-muted, #62666d); transition: width .5s cubic-bezier(.2,.7,.2,1); }
.mm-slider__tick { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--mm-bg, #fff); }
.mm-slider__tick--30 { left: calc(var(--mm-thumb) / 2 + 0.3 * (100% - var(--mm-thumb))); }
.mm-slider__tick--70 { left: calc(var(--mm-thumb) / 2 + 0.7 * (100% - var(--mm-thumb))); }
.mm-slider__thumb { position: absolute; top: 50%; left: calc(var(--mm-p) * (100% - var(--mm-thumb))); width: var(--mm-thumb); height: var(--mm-thumb); margin-top: calc(var(--mm-thumb) / -2); box-sizing: border-box; border-radius: 50%; background: var(--mm-bg, #fff); border: 3px solid var(--mm-muted, #62666d); transition: left .5s cubic-bezier(.2,.7,.2,1); }
.mm-slider[data-band="halo"] .mm-slider__fill { background: var(--mm-halo, #00806f); }
.mm-slider[data-band="halo"] .mm-slider__thumb { border-color: var(--mm-halo, #00806f); }
.mm-slider[data-band="meh"] .mm-slider__fill { background: var(--mm-meh, #9a6a00); }
.mm-slider[data-band="meh"] .mm-slider__thumb { border-color: var(--mm-meh, #9a6a00); }
.mm-slider[data-band="failo"] .mm-slider__fill { background: var(--mm-failo, #b42318); }
.mm-slider[data-band="failo"] .mm-slider__thumb { border-color: var(--mm-failo, #b42318); }
.mm-slider[data-band="none"] .mm-slider__fill,
.mm-slider[data-band="none"] .mm-slider__thumb { display: none; }
.mm-slider[data-band="none"] .mm-slider__track { opacity: .6; }

.mm-slider__note { margin: 5px 0 0; font-size: 12px; color: var(--mm-muted, #62666d); font-variant-numeric: tabular-nums; }
.mm-slider__note:empty { display: none; }
.mm-slider[data-off="true"] .mm-slider__label { color: var(--mm-muted, #62666d); }
.mm-sliders__legend { margin: 12px 0 0; font-size: 11px; color: var(--mm-muted, #62666d); font-variant-numeric: tabular-nums; }

@media (prefers-reduced-motion: reduce) {
  .mm-slider__fill, .mm-slider__thumb { transition: none; }
}
`;

function injectCss(doc) {
  if (!doc || !doc.head || doc.getElementById("mm-css-sliders")) return;
  const style = doc.createElement("style");
  style.id = "mm-css-sliders";
  style.textContent = CSS;
  doc.head.appendChild(style);
}

function make(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildRow(doc, meta) {
  const row = make(doc, "div", "mm-slider");
  row.dataset.dim = meta.key;
  row.setAttribute("aria-valuemin", "0");
  row.setAttribute("aria-valuemax", "100");

  const head = make(doc, "div", "mm-slider__head");
  const label = make(doc, "span", "mm-slider__label", meta.label);
  const weight = make(doc, "span", "mm-slider__weight");
  const value = make(doc, "span", "mm-slider__value");
  const score = make(doc, "span", "mm-slider__score");
  const tag = make(doc, "span", "mm-slider__tag");
  value.append(score, tag);
  head.append(label, weight, value);

  const track = make(doc, "div", "mm-slider__track");
  track.setAttribute("aria-hidden", "true");
  track.append(
    make(doc, "span", "mm-slider__fill"),
    make(doc, "span", "mm-slider__tick mm-slider__tick--30"),
    make(doc, "span", "mm-slider__tick mm-slider__tick--70"),
    make(doc, "span", "mm-slider__thumb"),
  );

  const note = make(doc, "p", "mm-slider__note");
  row.append(head, track, note);
  return { row, label, weight, score, tag, track, note };
}

function paintRow(parts, d, animateFromZero) {
  const { row, label, weight, score, tag, track, note } = parts;
  label.textContent = d.label;
  weight.textContent = d.weightText;
  note.textContent = d.note;

  row.dataset.score = d.score === null ? "null" : String(d.score);
  row.dataset.weight = d.weight === null ? "" : String(Math.round(d.weight * 1000) / 1000);
  row.dataset.band = d.band || "none";
  row.dataset.off = d.weight === 0 ? "true" : "false";
  row.setAttribute("aria-label", d.label);
  row.setAttribute("aria-valuetext", d.valueText);

  if (d.score === null) {
    // A meter needs a current value; an unscored dimension has none, so it is
    // exposed as a labelled group instead of a misleading meter at 0.
    row.setAttribute("role", "group");
    row.removeAttribute("aria-valuenow");
    row.setAttribute("aria-label", `${d.label}: ${d.valueText}`);
    score.textContent = "Not scored";
    tag.textContent = "";
    track.style.setProperty("--mm-p", "0");
    return;
  }

  row.setAttribute("role", "meter");
  row.setAttribute("aria-valuenow", String(d.score));
  score.textContent = String(d.score);
  tag.textContent = BAND_WORD[d.band];

  const target = String(d.score / 100);
  if (animateFromZero) {
    track.style.setProperty("--mm-p", "0");
    const raf = (row.ownerDocument?.defaultView || globalThis).requestAnimationFrame;
    if (typeof raf === "function") {
      raf(() => raf(() => track.style.setProperty("--mm-p", target)));
      return;
    }
  }
  track.style.setProperty("--mm-p", target);
}

function normaliseInput(input) {
  if (Array.isArray(input)) return input;
  if (input && Array.isArray(input.dimensions)) return input.dimensions;
  return [];
}

export function renderSliders(container, { dimensions } = {}) {
  const doc = container?.ownerDocument || globalThis.document;
  injectCss(doc);

  const root = make(doc, "div", "mm-sliders");
  const title = make(doc, "h3", "mm-sliders__title", "Score by dimension");
  const list = make(doc, "div", "mm-sliders__list");
  const legend = make(doc, "p", "mm-sliders__legend", "Failo 0–30 · Meh 31–69 · Halo 70–100. Weights come from your profile.");
  root.append(title, list, legend);

  const rows = ORDER.map((meta) => {
    const parts = buildRow(doc, meta);
    list.append(parts.row);
    return { meta, parts };
  });

  let first = true;
  function update(next) {
    const dims = normaliseInput(next);
    for (const { meta, parts } of rows) {
      const dim = dims.find((x) => x && x.key === meta.key) || null;
      paintRow(parts, describe(meta, dim), first);
    }
    first = false;
  }

  update(dimensions || []);
  if (container) container.replaceChildren(root);
  return { update, el: root };
}
