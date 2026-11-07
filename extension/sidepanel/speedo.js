/*
 * MicroMatch side panel: the fit speedo and the one-line verdict.
 *
 *   renderSpeedo(container, { fit, band, coverage }) -> { update(next), el, destroy() }
 *   verdictSentence({ halos, failos, fit, band }) -> string
 *
 * Inline-SVG semicircle gauge, 0-100, three bands: Failo 0-30, Meh 31-69, Halo 70-100,
 * each named in words (band meaning is never carried by colour alone). Ticks at
 * 0 / 30 / 70 / 100. The needle sweeps up from 0 on first render, then animates from
 * the previous value on update(); no animation under prefers-reduced-motion.
 * fit null -> greyed bands, needle hidden, "Not scored".
 *
 * Root: div.mm-speedo[data-fit][data-band][role="meter"]. data-fit is the rounded fit
 * ("" when not scored); data-band is "halo" | "meh" | "failo" ("" when not scored).
 * CSS is injected once as <style id="mm-css-speedo"> in document.head and only uses
 * the panel tokens (with fallbacks). DOM is built with createElement(NS)/textContent.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const CSS_ID = 'mm-css-speedo';
const DASH = '–';

// Gauge geometry in viewBox units (drawn 1:1 at 264 x 140 css px, scales down below that).
const VB_W = 264;
const VB_H = 140;
const CX = 132;
const CY = 122;
const R = 92; // centre line of the band ring
const RING = 14; // ring thickness
const NEEDLE = 80; // hub to needle tip (stops short of the ring)
const TAIL = 10; // needle tail behind the hub
const SWEEP_MS = 900;
const EASE_OUT = 'cubic-bezier(.22,.8,.26,1)';
const MAX_VERDICT = 180;

export const SPEEDO_BANDS = Object.freeze([
  Object.freeze({ key: 'failo', word: 'Failo', from: 0, to: 30 }),
  Object.freeze({ key: 'meh', word: 'Meh', from: 31, to: 69 }),
  Object.freeze({ key: 'halo', word: 'Halo', from: 70, to: 100 }),
]);
const WORD = { failo: 'Failo', meh: 'Meh', halo: 'Halo' };
const TICKS = [0, 30, 70, 100];
// Presentation-attribute fallbacks so the gauge still reads if the stylesheet is missing.
const INK = { failo: '#b42318', meh: '#9a6a00', halo: '#00806f', ink: '#18191b', muted: '#62666d' };

const FONT = 'var(--mm-font, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif)';

const CSS = `
.mm-speedo{display:flex;flex-direction:column;align-items:center;margin:0;padding:0;
  color:var(--mm-ink,#18191b);font-family:${FONT};font-variant-numeric:tabular-nums;text-align:center}
.mm-speedo [hidden]{display:none!important}
.mm-speedo__gauge{display:block;width:100%;max-width:264px;height:auto;overflow:visible}
.mm-speedo__arc{fill:none;stroke-width:14px;stroke-linecap:butt;opacity:.22;transition:opacity .3s ease,stroke .3s ease}
.mm-speedo__arc--failo{stroke:var(--mm-failo,#b42318)}
.mm-speedo__arc--meh{stroke:var(--mm-meh,#9a6a00)}
.mm-speedo__arc--halo{stroke:var(--mm-halo,#00806f)}
.mm-speedo[data-band="failo"] .mm-speedo__arc--failo,
.mm-speedo[data-band="meh"] .mm-speedo__arc--meh,
.mm-speedo[data-band="halo"] .mm-speedo__arc--halo{opacity:1}
.mm-speedo--empty .mm-speedo__arc{stroke:var(--mm-muted,#62666d);opacity:.16}
.mm-speedo__tick{stroke:var(--mm-muted,#62666d);stroke-width:1.25px;stroke-linecap:round}
.mm-speedo__num{fill:var(--mm-muted,#62666d);font-size:9.5px}
.mm-speedo__band{fill:var(--mm-muted,#62666d);font-size:11px;font-weight:500;letter-spacing:.01em}
.mm-speedo[data-band="failo"] .mm-speedo__band--failo{fill:var(--mm-failo,#b42318);font-weight:650}
.mm-speedo[data-band="meh"] .mm-speedo__band--meh{fill:var(--mm-meh,#9a6a00);font-weight:650}
.mm-speedo[data-band="halo"] .mm-speedo__band--halo{fill:var(--mm-halo,#00806f);font-weight:650}
.mm-speedo__needle-body,.mm-speedo__hub{fill:var(--mm-ink,#18191b)}
.mm-speedo__hub-dot{fill:var(--mm-bg,#fff)}
.mm-speedo--empty .mm-speedo__hub{fill:var(--mm-muted,#62666d);opacity:.35}
.mm-speedo__readout{display:flex;flex-direction:column;align-items:center;margin-top:2px}
.mm-speedo__value{font-size:40px;line-height:1;font-weight:650;letter-spacing:-.02em;color:var(--mm-ink,#18191b)}
.mm-speedo__word{margin-top:3px;font-size:13px;line-height:1.3;font-weight:600;color:var(--mm-ink,#18191b)}
.mm-speedo[data-band="failo"] .mm-speedo__word{color:var(--mm-failo,#b42318)}
.mm-speedo[data-band="meh"] .mm-speedo__word{color:var(--mm-meh,#9a6a00)}
.mm-speedo[data-band="halo"] .mm-speedo__word{color:var(--mm-halo,#00806f)}
.mm-speedo--empty .mm-speedo__value{color:var(--mm-muted,#62666d);font-weight:500}
.mm-speedo--empty .mm-speedo__word{color:var(--mm-muted,#62666d);font-weight:500}
.mm-speedo__coverage{margin:4px 0 0;font-size:11.5px;line-height:1.35;color:var(--mm-muted,#62666d)}
@media (prefers-reduced-motion: reduce){
  .mm-speedo__needle,.mm-speedo__arc{transition:none!important}
}
`;

// ------------------------------------------------------------------ helpers

function toNumber(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x);
  return null;
}

function clamp100(v) {
  return Math.max(0, Math.min(100, v));
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Band for a rounded 0-100 fit: Failo 0-30, Meh 31-69, Halo 70-100. */
export function speedoBand(fit) {
  const n = toNumber(fit);
  if (n == null) return null;
  const r = Math.round(clamp100(n));
  return r >= 70 ? 'halo' : r >= 31 ? 'meh' : 'failo';
}

function normBand(b) {
  const k = typeof b === 'string' ? b.trim().toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(WORD, k) ? k : null;
}

// { scored, total } (score.js) or the older { scored, of }; null when unusable.
function normCoverage(c) {
  if (!c || typeof c !== 'object') return null;
  const scored = toNumber(c.scored);
  const total = toNumber(c.total != null ? c.total : c.of);
  if (scored == null || total == null || total <= 0) return null;
  const t = Math.round(total);
  return { scored: Math.max(0, Math.min(t, Math.round(scored))), total: t };
}

// Point on the dial for a value 0..100 at radius r (0 = left, 100 = right).
function pt(v, r) {
  const a = Math.PI * (1 - v / 100);
  return [round2(CX + r * Math.cos(a)), round2(CY - r * Math.sin(a))];
}

function arcD(v0, v1, r) {
  const p0 = pt(v0, r);
  const p1 = pt(v1, r);
  return `M${p0[0]} ${p0[1]}A${r} ${r} 0 0 1 ${p1[0]} ${p1[1]}`;
}

function svgEl(doc, tag, attrs, parent) {
  const el = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (parent) parent.appendChild(el);
  return el;
}

function htmlEl(doc, tag, cls, parent, text) {
  const el = doc.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}

function prefersReducedMotion() {
  try {
    return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

const hasRaf = typeof globalThis.requestAnimationFrame === 'function';
const raf = (fn) => (hasRaf ? globalThis.requestAnimationFrame(fn) : setTimeout(fn, 16));
const caf = (id) => (hasRaf ? globalThis.cancelAnimationFrame(id) : clearTimeout(id));

function ensureCss(doc) {
  try {
    if (doc.getElementById(CSS_ID)) return;
    const st = doc.createElement('style');
    st.id = CSS_ID;
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  } catch {
    /* best effort: presentation attributes keep the gauge legible without it */
  }
}

// ------------------------------------------------------------------- render

export function renderSpeedo(container, props = {}) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new TypeError('renderSpeedo needs a container element');
  }
  const doc = container.ownerDocument || globalThis.document;
  ensureCss(doc);

  // One speedo per container: drop one rendered here before.
  for (const kid of Array.from(container.children || [])) {
    if (kid.classList && kid.classList.contains('mm-speedo')) kid.remove();
  }

  const root = htmlEl(doc, 'div', 'mm-speedo');
  root.setAttribute('role', 'meter');
  root.setAttribute('aria-label', 'Fit score');
  root.setAttribute('aria-valuemin', '0');
  root.setAttribute('aria-valuemax', '100');

  const svg = svgEl(doc, 'svg', {
    class: 'mm-speedo__gauge',
    viewBox: `0 0 ${VB_W} ${VB_H}`,
    width: VB_W,
    height: VB_H,
    'aria-hidden': 'true',
    focusable: 'false',
  }, root);

  // Band arcs. Edges are whole numbers (30 | 31, 69 | 70), which leaves a hairline gap.
  for (const b of SPEEDO_BANDS) {
    svgEl(doc, 'path', {
      class: `mm-speedo__arc mm-speedo__arc--${b.key}`,
      d: arcD(b.from, b.to, R),
      fill: 'none',
      stroke: INK[b.key],
      'stroke-width': RING,
    }, svg);
  }

  // Ticks just outside the ring. Their numbers sit outside too (30, 70) or under the
  // ring ends (0, 100), so the needle never covers them.
  for (const v of TICKS) {
    const a = pt(v, R + RING / 2 + 2);
    const z = pt(v, R + RING / 2 + 7);
    svgEl(doc, 'line', {
      class: 'mm-speedo__tick',
      x1: a[0], y1: a[1], x2: z[0], y2: z[1],
      stroke: INK.muted,
      'stroke-width': 1.25,
    }, svg);
    const end = v === 0 || v === 100;
    const n = end ? [pt(v, R)[0], CY + 12] : pt(v, R + RING / 2 + 14);
    const t = svgEl(doc, 'text', {
      class: 'mm-speedo__num',
      x: n[0],
      y: n[1],
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': 9.5,
      fill: INK.muted,
    }, svg);
    t.textContent = String(v);
  }

  // Band words outside their arcs: Failo anchored end, Meh centred on top, Halo anchored start.
  for (const b of SPEEDO_BANDS) {
    const mid = (b.from + b.to) / 2;
    const anchor = mid < 40 ? 'end' : mid > 60 ? 'start' : 'middle';
    const p = pt(mid, R + RING / 2 + (anchor === 'middle' ? 11 : 9));
    const t = svgEl(doc, 'text', {
      class: `mm-speedo__band mm-speedo__band--${b.key}`,
      x: p[0],
      y: p[1],
      'text-anchor': anchor,
      'dominant-baseline': 'central',
      'font-size': 11,
      fill: INK.muted,
    }, svg);
    t.textContent = b.word;
  }

  // Needle: the outer group moves the origin to the hub; the inner group is drawn
  // pointing at 0 (left) and rotated value x 1.8deg by a CSS transform.
  const hub = svgEl(doc, 'g', { transform: `translate(${CX} ${CY})` }, svg);
  const needle = svgEl(doc, 'g', { class: 'mm-speedo__needle' }, hub);
  svgEl(doc, 'path', {
    class: 'mm-speedo__needle-body',
    d: `M${TAIL} 0L0 -3.2L${-NEEDLE} 0L0 3.2Z`,
    fill: INK.ink,
  }, needle);
  svgEl(doc, 'circle', { class: 'mm-speedo__hub', cx: 0, cy: 0, r: 6, fill: INK.ink }, hub);
  svgEl(doc, 'circle', { class: 'mm-speedo__hub-dot', cx: 0, cy: 0, r: 2, fill: '#fff' }, hub);
  needle.style.transformBox = 'view-box';
  needle.style.transformOrigin = '0 0';
  needle.style.transition = 'none';
  needle.style.transform = 'rotate(0deg)';

  const readout = htmlEl(doc, 'div', 'mm-speedo__readout', root);
  const valueEl = htmlEl(doc, 'div', 'mm-speedo__value', readout);
  const wordEl = htmlEl(doc, 'div', 'mm-speedo__word', readout);
  const covEl = htmlEl(doc, 'p', 'mm-speedo__coverage', root);

  container.appendChild(root);

  const st = { props: {}, deg: 0, raf: 0, shown: false, destroyed: false, ro: null };
  const rot = (deg) => `rotate(${round2(deg)}deg)`;

  function stopWaiting() {
    if (st.ro) st.ro.disconnect();
    st.ro = null;
  }

  // Rendered into a hidden section: hold the sweep until the speedo gets a layout box,
  // so the first sweep is seen rather than spent while display:none.
  function sweepWhenVisible() {
    if (typeof globalThis.ResizeObserver !== 'function') return false;
    stopWaiting();
    st.ro = new globalThis.ResizeObserver(() => {
      if (st.destroyed || root.getClientRects().length === 0) return;
      stopWaiting();
      if (!st.shown) return;
      placeNow(0);
      sweepFromZero(0);
    });
    st.ro.observe(root);
    return true;
  }

  function placeNow(deg) {
    if (st.raf) caf(st.raf);
    st.raf = 0;
    needle.style.transition = 'none';
    needle.style.transform = rot(deg);
  }

  // Park at 0, let the parked pose be styled once the root is attached, then set the
  // target so the CSS transition sweeps up from 0.
  function sweepFromZero(tries) {
    st.raf = raf(() => {
      st.raf = 0;
      if (st.destroyed) return;
      if (!root.isConnected && tries < 120) return sweepFromZero(tries + 1);
      if (prefersReducedMotion()) return placeNow(st.deg);
      if (root.isConnected && root.getClientRects().length === 0 && sweepWhenVisible()) return;
      try {
        void globalThis.getComputedStyle(needle).transform; // flush the parked pose
      } catch {
        /* ignore */
      }
      st.raf = raf(() => {
        st.raf = 0;
        if (st.destroyed) return;
        needle.style.transition = `transform ${SWEEP_MS}ms ${EASE_OUT}`;
        needle.style.transform = rot(st.deg);
      });
    });
  }

  function setNeedle(deg, fromZero) {
    st.deg = deg;
    if (prefersReducedMotion()) return placeNow(deg);
    if (fromZero) {
      placeNow(0);
      return sweepFromZero(0);
    }
    if (st.raf) return; // the pending sweep picks up st.deg
    needle.style.transition = `transform ${SWEEP_MS}ms ${EASE_OUT}`;
    needle.style.transform = rot(deg);
  }

  function update(next) {
    if (st.destroyed) return handle;
    const n = next && typeof next === 'object' ? next : {};
    const p = { ...st.props, ...n };
    // A new fit without a band: derive the band rather than keep a stale one.
    if (Object.prototype.hasOwnProperty.call(n, 'fit') && !Object.prototype.hasOwnProperty.call(n, 'band')) {
      p.band = undefined;
    }
    st.props = p;

    const raw = toNumber(p.fit);
    const fit = raw == null ? null : Math.round(clamp100(raw));
    const band = fit == null ? null : normBand(p.band) || speedoBand(fit);
    const cov = normCoverage(p.coverage);

    root.setAttribute('data-fit', fit == null ? '' : String(fit));
    root.setAttribute('data-band', band || '');
    root.classList.toggle('mm-speedo--empty', fit == null);
    // Not scored: no value and no needle, so a missing fit never reads as a zero.
    if (fit == null) root.removeAttribute('aria-valuenow');
    else root.setAttribute('aria-valuenow', String(fit));
    root.setAttribute('aria-valuetext', fit == null ? 'Not scored' : `${fit} out of 100, ${WORD[band]}`);

    valueEl.textContent = fit == null ? DASH : String(fit);
    wordEl.textContent = fit == null ? 'Not scored' : WORD[band];

    if (cov) {
      covEl.hidden = false;
      const noun = cov.total === 1 ? 'signal' : 'signals';
      covEl.textContent = fit == null
        ? `${cov.scored} of ${cov.total} ${noun} ${cov.scored === 1 ? 'has' : 'have'} data`
        : `Based on ${cov.scored} of ${cov.total} ${noun}`;
    } else {
      covEl.hidden = true;
      covEl.textContent = '';
    }

    if (fit == null) {
      needle.style.visibility = 'hidden';
      st.shown = false;
      stopWaiting();
      placeNow(0);
    } else {
      const fromZero = !st.shown; // first value, or the first after "Not scored"
      st.shown = true;
      needle.style.visibility = '';
      setNeedle(fit * 1.8, fromZero);
    }
    return handle;
  }

  function destroy() {
    st.destroyed = true;
    stopWaiting();
    if (st.raf) caf(st.raf);
    st.raf = 0;
    root.remove();
  }

  const handle = { update, el: root, destroy };
  update(props);
  return handle;
}

// ------------------------------------------------------------------ verdict

const NOT_ENOUGH = 'Not enough data to score this home yet.';
const NEITHER = 'No halos or failos: nothing stands out either way for this profile.';

function clean(s) {
  return String(s == null ? '' : s)
    .replace(/!/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.;:,]+$/, '')
    .trim();
}

function firstItem(list) {
  if (!Array.isArray(list)) return null;
  for (const it of list) {
    if (it && typeof it === 'object' && (clean(it.label) || clean(it.key))) return it;
  }
  return null;
}

function labelOf(it) {
  return clean(it.label) || clean(it.key).replace(/[_.-]+/g, ' ');
}

function fmtNum(v) {
  if (Number.isInteger(v)) return v.toLocaleString('en-AU');
  return (Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString('en-AU');
}

// The item's display string; falls back to value + unit when display is missing.
function displayOf(it) {
  const d = clean(it.display);
  if (d) return d;
  const unit = clean(it.unit);
  const v = it.value;
  let s = '';
  if (typeof v === 'number' && Number.isFinite(v)) s = fmtNum(v);
  else if (typeof v === 'string') s = clean(v);
  if (!s) return '';
  if (!unit) return s;
  return unit === '%' ? `${s}%` : `${s} ${unit}`;
}

function upFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Lower-case the first letter unless the word is an acronym ("CBD distance").
function lowFirst(s) {
  if (!s) return s;
  if (s.length > 1 && /[A-Z]/.test(s.charAt(1))) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function paren(d) {
  return d ? ` (${d})` : '';
}

// Drops leading words of the display that the label already says:
// "Road noise" + "Road noise: fronting" -> "fronting".
function trimEcho(label, display) {
  if (!label || !display) return display;
  const lw = ` ${String(label).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const words = String(display).split(/\s+/);
  for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
    const head = words.slice(0, n).join(' ').toLowerCase().replace(/:$/, '');
    if (!/^[a-z ]+$/.test(head)) continue;
    if (lw.includes(` ${head} `)) return words.slice(n).join(' ');
  }
  return display;
}

/**
 * One plain sentence from the top halo and the top failo, with their display values.
 * Deterministic: the same input always gives the same sentence.
 */
export function verdictSentence(input) {
  const o = input && typeof input === 'object' ? input : {};
  const hasFit = Object.prototype.hasOwnProperty.call(o, 'fit') && o.fit !== undefined;
  if (hasFit && toNumber(o.fit) == null) return NOT_ENOUGH;

  const H = firstItem(o.halos);
  const F = firstItem(o.failos);
  if (!H && !F) {
    if (!hasFit && !Array.isArray(o.halos) && !Array.isArray(o.failos)) return NOT_ENOUGH;
    return NEITHER;
  }

  const hl = H ? labelOf(H) : '';
  const fl = F ? labelOf(F) : '';
  const hd = H ? trimEcho(hl, displayOf(H)) : '';
  const fd = F ? trimEcho(fl, displayOf(F)) : '';

  let options;
  if (H && F) {
    options = [
      `${upFirst(hl)}${paren(hd)} lifts the fit most; ${lowFirst(fl)}${paren(fd)} pulls it down most.`,
      `${upFirst(hl)} lifts the fit most; ${lowFirst(fl)}${paren(fd)} pulls it down most.`,
      `${upFirst(hl)} lifts the fit most; ${lowFirst(fl)} pulls it down most.`,
    ];
  } else if (H) {
    options = [
      `${upFirst(hl)}${paren(hd)} lifts the fit most, and nothing scores as a failo.`,
      `${upFirst(hl)} lifts the fit most, and nothing scores as a failo.`,
    ];
  } else {
    options = [
      `${upFirst(fl)}${paren(fd)} pulls the fit down most, and nothing scores as a halo.`,
      `${upFirst(fl)} pulls the fit down most, and nothing scores as a halo.`,
    ];
  }
  for (const s of options) if (s.length <= MAX_VERDICT) return s;
  return options[options.length - 1];
}
