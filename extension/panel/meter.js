globalThis.MBX = globalThis.MBX || {};

/*
 * Fit meter: a 0-100 speedometer gauge with Failo / Meh / Halo bands, plus a
 * one-sentence verdict built from the top halo and the top failo.
 *
 * MBX.meter.render(container, { total, band, coverage }) -> { update(sameShape), el, destroy() }
 * MBX.meter.verdict({ halos, failos, total, band }) -> string
 * MBX.meter.css -> CSS string scoped to .mbx-meter (the panel injects it; render()
 *                  adds its own <style> only if it cannot find it in the root)
 *
 * DOM is built with createElement / createElementNS + textContent only.
 * Test hooks: root ".mbx-meter" carries data-total ("" when not scored) and
 * data-band ("halo" | "meh" | "failo" | "").
 */
(function (MBX) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var DASH = '–';
  var CSS_MARK = '/*mbx-meter*/';

  // Gauge geometry in viewBox units (rendered 1:1 at 240 x 132 css px).
  var VB_W = 240;
  var VB_H = 132;
  var CX = 120;
  var CY = 110;
  var R = 84; // centre line of the band ring
  var RING = 12; // ring thickness
  var NEEDLE = 72; // hub to needle tip
  var GAP = 0.7; // value units of space either side of a band boundary
  var SWEEP_MS = 900;
  var MAX_VERDICT = 140;

  var BANDS = [
    { key: 'failo', word: 'Failo', from: 0, to: 40, mid: 20 },
    { key: 'meh', word: 'Meh', from: 40, to: 70, mid: 55 },
    { key: 'halo', word: 'Halo', from: 70, to: 100, mid: 85 }
  ];
  var WORD = { failo: 'Failo', meh: 'Meh', halo: 'Halo' };
  var TICKS = [0, 40, 70, 100];
  // Presentation-attribute fallbacks so the gauge still reads if the CSS is missing.
  var INK = { failo: '#b42318', meh: '#9a6a00', halo: '#00806f', ink: '#18191b', muted: '#62666d' };

  var CSS = [
    CSS_MARK,
    '.mbx-meter{display:flex;flex-direction:column;align-items:center;padding:2px 0 0;margin:0;',
    '  color:var(--mbx-ink,#18191b);font-family:var(--mbx-font,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif);',
    '  font-variant-numeric:tabular-nums;text-align:center}',
    '.mbx-meter [hidden]{display:none!important}',
    '.mbx-meter__gauge{display:block;width:240px;max-width:100%;height:auto;overflow:visible}',
    '.mbx-meter__arc{fill:none;stroke-width:12px;stroke-linecap:butt;opacity:.28;transition:opacity .3s ease}',
    '.mbx-meter__arc--failo{stroke:var(--mbx-failo,#b42318)}',
    '.mbx-meter__arc--meh{stroke:var(--mbx-meh,#9a6a00)}',
    '.mbx-meter__arc--halo{stroke:var(--mbx-halo,#00806f)}',
    '.mbx-meter[data-band="failo"] .mbx-meter__arc--failo,',
    '.mbx-meter[data-band="meh"] .mbx-meter__arc--meh,',
    '.mbx-meter[data-band="halo"] .mbx-meter__arc--halo{opacity:1}',
    '.mbx-meter__tick{stroke:var(--mbx-muted,#62666d);stroke-width:1.25px;stroke-linecap:round;opacity:.75}',
    '.mbx-meter__band{fill:var(--mbx-muted,#62666d);font-size:10.5px;font-weight:500;letter-spacing:.01em}',
    '.mbx-meter[data-band="failo"] .mbx-meter__band--failo{fill:var(--mbx-failo,#b42318);font-weight:650}',
    '.mbx-meter[data-band="meh"] .mbx-meter__band--meh{fill:var(--mbx-meh,#9a6a00);font-weight:650}',
    '.mbx-meter[data-band="halo"] .mbx-meter__band--halo{fill:var(--mbx-halo,#00806f);font-weight:650}',
    '.mbx-meter__scale{fill:var(--mbx-muted,#62666d);font-size:9.5px}',
    '.mbx-meter__needle-body,.mbx-meter__hub{fill:var(--mbx-ink,#18191b);transition:opacity .3s ease}',
    '.mbx-meter--empty .mbx-meter__needle-body,.mbx-meter--empty .mbx-meter__hub{fill:var(--mbx-muted,#62666d);opacity:.45}',
    '.mbx-meter__readout{display:flex;flex-direction:column;align-items:center;margin-top:-1px}',
    '.mbx-meter__value{font-size:34px;line-height:1;font-weight:650;letter-spacing:-.01em;color:var(--mbx-ink,#18191b)}',
    '.mbx-meter--empty .mbx-meter__value{color:var(--mbx-muted,#62666d);font-weight:500}',
    '.mbx-meter__word{margin-top:2px;font-size:13px;line-height:1.3;font-weight:600;color:var(--mbx-ink,#18191b)}',
    '.mbx-meter[data-band="failo"] .mbx-meter__word{color:var(--mbx-failo,#b42318)}',
    '.mbx-meter[data-band="meh"] .mbx-meter__word{color:var(--mbx-meh,#9a6a00)}',
    '.mbx-meter[data-band="halo"] .mbx-meter__word{color:var(--mbx-halo,#00806f)}',
    '.mbx-meter--empty .mbx-meter__word{color:var(--mbx-muted,#62666d);font-weight:500}',
    '.mbx-meter__coverage{margin-top:4px;font-size:11.5px;line-height:1.35;color:var(--mbx-muted,#62666d)}',
    '@media (prefers-reduced-motion: reduce){',
    '  .mbx-meter__needle,.mbx-meter__arc,.mbx-meter__needle-body,.mbx-meter__hub{transition:none!important}}'
  ].join('\n');

  // ------------------------------------------------------------- helpers

  function toNumber(x) {
    if (typeof x === 'number') return isFinite(x) ? x : null;
    if (typeof x === 'string' && x.trim() !== '' && isFinite(Number(x))) return Number(x);
    return null;
  }

  function clamp100(v) {
    return Math.max(0, Math.min(100, v));
  }

  function bandOf(rounded) {
    if (rounded == null) return null;
    return rounded >= 70 ? 'halo' : rounded >= 40 ? 'meh' : 'failo';
  }

  function normBand(b) {
    var k = typeof b === 'string' ? b.toLowerCase() : '';
    return WORD[k] ? k : null;
  }

  function normCoverage(c) {
    var scored = null;
    var of = 6;
    if (typeof c === 'number') scored = c;
    else if (c && typeof c === 'object') {
      scored = toNumber(c.scored);
      var o = toNumber(c.of);
      if (o != null && o > 0) of = Math.round(o);
    }
    if (scored == null || !isFinite(scored)) return null;
    return { scored: Math.max(0, Math.min(of, Math.round(scored))), of: of };
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  // Point on the dial for a value 0..100 at radius r (0 = left, 100 = right).
  function pt(v, r) {
    var a = Math.PI * (1 - v / 100);
    return [round2(CX + r * Math.cos(a)), round2(CY - r * Math.sin(a))];
  }

  function arcD(v0, v1, r) {
    var p0 = pt(v0, r);
    var p1 = pt(v1, r);
    return 'M' + p0[0] + ' ' + p0[1] + 'A' + r + ' ' + r + ' 0 0 1 ' + p1[0] + ' ' + p1[1];
  }

  function svgEl(doc, tag, attrs, parent) {
    var el = doc.createElementNS(SVG_NS, tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, String(attrs[k]));
    if (parent) parent.appendChild(el);
    return el;
  }

  function htmlEl(doc, tag, cls, parent, text) {
    var el = doc.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }

  function prefersReducedMotion() {
    try {
      return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  var raf =
    typeof globalThis.requestAnimationFrame === 'function'
      ? function (fn) { return globalThis.requestAnimationFrame(fn); }
      : function (fn) { return setTimeout(fn, 16); };
  var caf =
    typeof globalThis.cancelAnimationFrame === 'function'
      ? function (id) { globalThis.cancelAnimationFrame(id); }
      : function (id) { clearTimeout(id); };

  // Adds the meter CSS inside the meter root unless the root node already has it.
  function ensureCss(container, root, doc) {
    try {
      var scope = container.getRootNode ? container.getRootNode() : doc;
      if (!scope || typeof scope.querySelectorAll !== 'function') scope = doc;
      var styles = scope.querySelectorAll('style');
      for (var i = 0; i < styles.length; i++) {
        if ((styles[i].textContent || '').indexOf(CSS_MARK) !== -1) return;
      }
      var st = doc.createElement('style');
      st.setAttribute('data-mbx', 'meter');
      st.textContent = CSS;
      root.appendChild(st);
    } catch (e) {
      /* styling is best effort; presentation attributes keep the gauge legible */
    }
  }

  // --------------------------------------------------------------- render

  function render(container, props) {
    if (!container || typeof container.appendChild !== 'function') {
      throw new TypeError('MBX.meter.render needs a container element');
    }
    var doc = container.ownerDocument || globalThis.document;

    // One meter per container: drop a previous one rendered here.
    var kids = container.children || [];
    for (var i = kids.length - 1; i >= 0; i--) {
      if (kids[i].classList && kids[i].classList.contains('mbx-meter')) container.removeChild(kids[i]);
    }

    var root = htmlEl(doc, 'div', 'mbx-meter');
    root.setAttribute('role', 'meter');
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', '100');
    root.setAttribute('aria-label', 'Fit score');
    ensureCss(container, root, doc);

    var svg = svgEl(doc, 'svg', {
      class: 'mbx-meter__gauge',
      viewBox: '0 0 ' + VB_W + ' ' + VB_H,
      width: VB_W,
      height: VB_H,
      'aria-hidden': 'true',
      focusable: 'false'
    }, root);

    // Band arcs, with a small gap at each boundary.
    BANDS.forEach(function (b) {
      var from = b.from === 0 ? 0 : b.from + GAP;
      var to = b.to === 100 ? 100 : b.to - GAP;
      svgEl(doc, 'path', {
        class: 'mbx-meter__arc mbx-meter__arc--' + b.key,
        d: arcD(from, to, R),
        fill: 'none',
        stroke: INK[b.key],
        'stroke-width': RING
      }, svg);
    });

    // Ticks at 0 / 40 / 70 / 100, just outside the ring.
    TICKS.forEach(function (v) {
      var a = pt(v, R + RING / 2 + 2);
      var b = pt(v, R + RING / 2 + 7);
      svgEl(doc, 'line', {
        class: 'mbx-meter__tick',
        x1: a[0], y1: a[1], x2: b[0], y2: b[1],
        stroke: INK.muted,
        'stroke-width': 1.25
      }, svg);
    });

    // Band words outside their arcs: left band anchored end, right band start.
    BANDS.forEach(function (b) {
      var anchor = b.mid < 40 ? 'end' : b.mid > 60 ? 'start' : 'middle';
      var p = pt(b.mid, R + RING / 2 + (anchor === 'middle' ? 10 : 6));
      var t = svgEl(doc, 'text', {
        class: 'mbx-meter__band mbx-meter__band--' + b.key,
        x: p[0],
        y: p[1],
        'text-anchor': anchor,
        'dominant-baseline': 'central',
        'font-size': 10.5,
        fill: INK.muted
      }, svg);
      t.textContent = b.word;
    });

    // Scale ends under the ring.
    [[0, '0'], [100, '100']].forEach(function (s) {
      var p = pt(s[0], R);
      var t = svgEl(doc, 'text', {
        class: 'mbx-meter__scale',
        x: p[0],
        y: CY + 13,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-size': 9.5,
        fill: INK.muted
      }, svg);
      t.textContent = s[1];
    });

    // Needle: drawn pointing at 0 (left), rotated value * 1.8deg about the hub.
    var needle = svgEl(doc, 'g', { class: 'mbx-meter__needle' }, svg);
    svgEl(doc, 'path', {
      class: 'mbx-meter__needle-body',
      d: 'M' + (CX + 11) + ' ' + CY + 'L' + CX + ' ' + (CY - 3.2) + 'L' + (CX - NEEDLE) + ' ' + CY +
        'L' + CX + ' ' + (CY + 3.2) + 'Z',
      fill: INK.ink
    }, needle);
    svgEl(doc, 'circle', { class: 'mbx-meter__hub', cx: CX, cy: CY, r: 5.5, fill: INK.ink }, svg);
    needle.style.transformBox = 'view-box';
    needle.style.transformOrigin = CX + 'px ' + CY + 'px';
    needle.style.transform = 'rotate(0deg)';

    var readout = htmlEl(doc, 'div', 'mbx-meter__readout', root);
    var valueEl = htmlEl(doc, 'div', 'mbx-meter__value', readout);
    var wordEl = htmlEl(doc, 'div', 'mbx-meter__word', readout);
    var covEl = htmlEl(doc, 'div', 'mbx-meter__coverage', root);

    container.appendChild(root);

    var st = { deg: 0, raf: 0, started: false, destroyed: false };

    function rot(deg) {
      return 'rotate(' + round2(deg) + 'deg)';
    }

    function placeNow(deg) {
      needle.style.transition = 'none';
      needle.style.transform = rot(deg);
    }

    // First sweep: the parked pose (0) must be styled once the root is
    // attached, then the target is set so the CSS transition runs.
    function startSweep(tries) {
      st.raf = raf(function () {
        st.raf = 0;
        if (st.destroyed) return;
        if (!root.isConnected && tries < 120) return startSweep(tries + 1);
        if (prefersReducedMotion()) return placeNow(st.deg);
        try {
          globalThis.getComputedStyle(needle).transform; // flush the parked pose
        } catch (e) {
          /* ignore */
        }
        st.raf = raf(function () {
          st.raf = 0;
          if (st.destroyed) return;
          needle.style.transition = 'transform ' + SWEEP_MS + 'ms cubic-bezier(.22,.8,.26,1)';
          needle.style.transform = rot(st.deg);
        });
      });
    }

    function setNeedle(deg) {
      st.deg = deg;
      if (prefersReducedMotion()) {
        if (st.raf) caf(st.raf);
        st.raf = 0;
        st.started = true;
        return placeNow(deg);
      }
      if (!st.started) {
        st.started = true;
        return startSweep(0);
      }
      if (st.raf) return; // the pending first sweep picks up st.deg
      needle.style.transition = 'transform ' + SWEEP_MS + 'ms cubic-bezier(.22,.8,.26,1)';
      needle.style.transform = rot(deg);
    }

    function update(p) {
      if (st.destroyed) return;
      p = p || {};
      var t = toNumber(p.total);
      var shown = t == null ? null : Math.round(clamp100(t));
      var band = shown == null ? null : normBand(p.band) || bandOf(shown);
      var cov = normCoverage(p.coverage);

      root.setAttribute('data-total', shown == null ? '' : String(shown));
      root.setAttribute('data-band', band || '');
      // Not scored: no value and no needle, so an absent total never reads as a zero.
      if (shown == null) root.removeAttribute('aria-valuenow');
      else root.setAttribute('aria-valuenow', String(shown));
      root.setAttribute('aria-valuetext', shown == null ? 'Not scored' : shown + ' out of 100, ' + WORD[band]);
      if (shown == null) root.classList.add('mbx-meter--empty');
      else root.classList.remove('mbx-meter--empty');

      valueEl.textContent = shown == null ? DASH : String(shown);
      wordEl.textContent = shown == null ? 'Not scored' : WORD[band];

      if (cov && cov.scored < cov.of) {
        covEl.hidden = false;
        covEl.textContent =
          shown == null
            ? cov.scored + ' of ' + cov.of + ' dimensions ' + (cov.scored === 1 ? 'has' : 'have') + ' data'
            : 'Based on ' + cov.scored + ' of ' + cov.of + ' dimensions';
      } else {
        covEl.hidden = true;
        covEl.textContent = '';
      }

      needle.style.visibility = shown == null ? 'hidden' : '';
      setNeedle(shown == null ? 90 : clamp100(t) * 1.8);
    }

    function destroy() {
      st.destroyed = true;
      if (st.raf) caf(st.raf);
      st.raf = 0;
      if (root.parentNode) root.parentNode.removeChild(root);
    }

    update(props);
    return { update: update, el: root, destroy: destroy };
  }

  // -------------------------------------------------------------- verdict

  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/!/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[\s.;:,]+$/, '')
      .trim();
  }

  function firstItem(list) {
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it && typeof it === 'object' && (clean(it.label) || clean(it.key))) return it;
    }
    return null;
  }

  function labelOf(it) {
    return clean(it.label) || clean(it.key).replace(/[_-]+/g, ' ');
  }

  function numberOf(it) {
    var n = it.number;
    if (typeof n === 'number') return isFinite(n) ? String(n) : '';
    return clean(n);
  }

  function upFirst(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // Lower-case the first letter unless the word is an acronym ("CBD commute").
  function lowFirst(s) {
    if (!s) return s;
    if (s.length > 1 && s.charAt(1) === s.charAt(1).toUpperCase() && /[A-Z]/.test(s.charAt(1))) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  function paren(n) {
    return n ? ' (' + n + ')' : '';
  }

  function colon(n) {
    return n ? ': ' + n : '';
  }

  // Drops leading words of the number that the label already says:
  // "Busy road nearby" + "Busy road 59 m (primary)" -> "59 m (primary)"; "Higher crime" + "Crime 1.8x ..." -> "1.8x ...".
  function trimEcho(label, num) {
    if (!label || !num) return num;
    var lw = ' ' + String(label).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    var words = String(num).split(/\s+/);
    for (var n = Math.min(3, words.length - 1); n >= 1; n--) {
      var head = words.slice(0, n).join(' ').toLowerCase();
      if (!/^[a-z ]+$/.test(head)) continue;
      if (lw.indexOf(' ' + head + ' ') !== -1) return words.slice(n).join(' ');
    }
    return num;
  }

  function verdict(input) {
    var o = input || {};
    var hasTotal = Object.prototype.hasOwnProperty.call(o, 'total') && o.total !== undefined;
    if (hasTotal && toNumber(o.total) == null) return 'Not enough data to score this home yet.';
    if (!hasTotal && !Array.isArray(o.halos) && !Array.isArray(o.failos)) return 'Not enough data to score this home yet.';

    var H = firstItem(o.halos);
    var F = firstItem(o.failos);
    if (!H && !F) return 'Nothing stands out either way for this profile.';

    var hl = H ? labelOf(H) : '';
    var fl = F ? labelOf(F) : '';
    var hn = H ? trimEcho(hl, numberOf(H)) : '';
    var fn = F ? trimEcho(fl, numberOf(F)) : '';
    var options;
    if (H && F) {
      options = [
        upFirst(hl) + paren(hn) + ', but ' + lowFirst(fl) + colon(fn) + '.',
        upFirst(hl) + ', but ' + lowFirst(fl) + colon(fn) + '.',
        upFirst(hl) + ', but ' + lowFirst(fl) + '.'
      ];
    } else if (H) {
      options = ['No failos. Strongest: ' + lowFirst(hl) + paren(hn) + '.', 'No failos. Strongest: ' + lowFirst(hl) + '.'];
    } else {
      options = ['No halos. Main concern: ' + lowFirst(fl) + paren(fn) + '.', 'No halos. Main concern: ' + lowFirst(fl) + '.'];
    }
    for (var i = 0; i < options.length; i++) if (options[i].length <= MAX_VERDICT) return options[i];
    return options[options.length - 1];
  }

  MBX.meter = { render: render, verdict: verdict, css: CSS };

  // Lets Node tests require() this file for verdict(); inert in the extension.
  if (typeof module === 'object' && module && module.exports) module.exports = MBX.meter;
})(globalThis.MBX);
