globalThis.MBX = globalThis.MBX || {};

/*
 * Halos and Failos lists for the Listing Check panel.
 *
 * MBX.halos.render(container, { halos, failos, blank, fetched_at }) -> { update(sameShape), el }
 * MBX.halos.css: stylesheet scoped to .mbx-halos; colours, font and radius only via var(--mbx-*, fallback).
 *
 * Items come from MBX.score.scoreListing():
 *   { key, kind, label, number, score, via: string[], as_of, picked }
 * Each renders as li.mbx-halos__item[data-dim=<key>][data-kind=halo|failo] with the short label,
 * the number, and a muted line "[Your priority] via <endpoint> · as of <Mon yyyy>" (full paths in a title).
 *
 * DOM is built with createElement + textContent only: nothing from the API is parsed as HTML.
 * No global listeners, no document queries: everything lives inside the given container.
 */
(function () {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DASH = '–';
  var SEP = ' · ';
  var DIM_ORDER = ['affordability', 'commute', 'safety', 'liveliness', 'quiet', 'negotiability'];
  var DIM_LABELS = {
    affordability: 'Affordability',
    commute: 'Commute',
    safety: 'Safety',
    liveliness: 'Liveliness',
    quiet: 'Quiet',
    negotiability: 'Negotiability'
  };
  var GROUPS = [
    { kind: 'halo', prop: 'halos', title: 'Halos', empty: 'No halos for this profile' },
    { kind: 'failo', prop: 'failos', title: 'Failos', empty: 'No failos for this profile' },
    // Middle-band dimensions (40-69): they count toward the total, so their facts are shown too (only when present).
    { kind: 'meh', prop: 'meh', title: 'Meh', empty: null }
  ];
  var CSS_MARK = '/* mbx-halos */';
  var MUTED = 'var(--mbx-muted, #62666d)';
  var HAIRLINE = '1px solid var(--mbx-hairline, rgba(0,0,0,.08))';

  var CSS = [
    CSS_MARK,
    '.mbx-halos{font-family:var(--mbx-font, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);',
    '  color:var(--mbx-ink, #18191b);font-variant-numeric:tabular-nums;text-align:left}',
    '.mbx-halos *,.mbx-halos *::before,.mbx-halos *::after{box-sizing:border-box}',
    /* zero-specificity reset so the component rules below always win */
    ':where(.mbx-halos) :where(h3,p,ul,li){margin:0;padding:0}',
    ':where(.mbx-halos) :where(ul){list-style:none}',
    '.mbx-halos__group+.mbx-halos__group{margin-top:16px}',

    /* heading: band word (accent colour) + count; the word carries the meaning, not the colour */
    '.mbx-halos__head{display:flex;align-items:baseline;gap:6px;padding-bottom:6px;border-bottom:' + HAIRLINE + ';',
    '  font-size:11px;font-weight:600;line-height:16px;letter-spacing:.06em;text-transform:uppercase}',
    '.mbx-halos__group--halo .mbx-halos__word{color:var(--mbx-halo, #00806f)}',
    '.mbx-halos__group--failo .mbx-halos__word{color:var(--mbx-failo, #b42318)}',
    '.mbx-halos__group--meh .mbx-halos__word{color:var(--mbx-meh, #9a6a00)}',
    '.mbx-halos__count{color:' + MUTED + ';letter-spacing:0}',

    /* item: label left, number right, meta line underneath */
    '.mbx-halos__item{display:grid;grid-template-columns:minmax(40%,1fr) auto;column-gap:12px;row-gap:2px;',
    '  align-items:baseline;padding:8px 0}',
    '.mbx-halos__item+.mbx-halos__item{border-top:' + HAIRLINE + '}',
    '.mbx-halos__label{grid-column:1;min-width:0;font-size:13px;font-weight:600;line-height:18px;overflow-wrap:break-word}',
    '.mbx-halos__tag{display:inline-block;margin-right:3px;padding:0 5px;border-radius:calc(var(--mbx-radius, 10px) / 2.5);',
    '  font-size:11px;font-weight:500;line-height:15px;white-space:nowrap;',
    '  color:var(--mbx-ink, #18191b);background:var(--mbx-accent-tint, #ecf8f6)}',
    '.mbx-halos__num{grid-column:2;min-width:0;max-width:100%;font-size:13px;line-height:18px;text-align:right;',
    '  font-variant-numeric:tabular-nums;overflow-wrap:break-word}',
    '.mbx-halos__num--none{color:' + MUTED + '}',
    '.mbx-halos__meta{grid-column:1/-1;min-width:0;font-size:11px;line-height:15px;color:' + MUTED + ';overflow-wrap:anywhere}',

    '.mbx-halos__empty{padding:8px 0;font-size:12px;line-height:17px;color:' + MUTED + '}',
    '.mbx-halos__blank{margin-top:4px;padding-top:8px;border-top:' + HAIRLINE + ';font-size:11px;line-height:15px;color:' + MUTED + '}'
  ].join('\n');

  function isStr(s) { return typeof s === 'string' && s.trim() !== ''; }
  function isNum(n) { return typeof n === 'number' && isFinite(n); }

  function make(doc, tag, cls, text) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  // ---------- dates (parsed by hand: no timezone shifts) ----------

  // 'YYYY-MM' or 'YYYY-MM-DD', optionally followed by a time and zone. Anything else is not a date.
  var YMD_RE = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?(?:[T ](\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;

  function parseYmd(s) {
    if (!isStr(s)) return null;
    var m = YMD_RE.exec(s.trim());
    if (!m) return null;
    var y = +m[1];
    var mo = +m[2];
    var d = m[3] ? +m[3] : null;
    if (mo < 1 || mo > 12) return null;
    if (d !== null && (d < 1 || d > 31 || new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d)) return null; // e.g. 31 Feb
    return { y: y, m: mo, d: d, zoned: !!(m[4] && m[5]) };
  }

  function monthYear(p) { return MONTHS[p.m - 1] + ' ' + p.y; }

  // fetched_at -> 'd Mon yyyy'. A timestamp with a zone is shown in the viewer's local date
  // (that is the day they fetched it); a bare date is taken as written.
  function dayMonthYear(v) {
    var dt = null;
    if (v instanceof Date) dt = v;
    else if (isNum(v)) dt = new Date(v);
    else if (isStr(v)) {
      var p = parseYmd(v);
      if (p && !p.zoned) return (p.d ? p.d + ' ' : '') + monthYear(p);
      dt = new Date(v.trim());
    }
    if (!dt || isNaN(dt.getTime())) return null;
    return dt.getDate() + ' ' + MONTHS[dt.getMonth()] + ' ' + dt.getFullYear();
  }

  // as_of 'YYYY-MM-DD' -> 'as of Aug 2026'; a non-date as_of ('2020-22 model') verbatim;
  // missing -> 'fetched 7 Nov 2026' from fetched_at; nothing usable -> null.
  function whenText(asOf, fetchedAt) {
    if (asOf instanceof Date && !isNaN(asOf.getTime())) return 'as of ' + MONTHS[asOf.getMonth()] + ' ' + asOf.getFullYear();
    if (isNum(asOf)) return 'as of ' + String(asOf);
    if (isStr(asOf)) {
      var p = parseYmd(asOf);
      return 'as of ' + (p ? monthYear(p) : asOf.trim());
    }
    var f = dayMonthYear(fetchedAt);
    return f ? 'fetched ' + f : null;
  }

  // ---------- endpoints ----------

  // '/v1/suburbs/{suburb_name}/crime/by-mesh-block' -> '/crime/by-mesh-block'. Also copes with a
  // concrete id or suburb in place of the template, a full URL, or a query string.
  function shortVia(path) {
    var s = path.trim().replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '').replace(/[?#].*$/, '');
    var m = /^\/?(?:v1\/)?(?:properties|suburbs)\/[^/]+(\/.+)$/.exec(s);
    return m ? m[1] : (s || path.trim());
  }

  function vias(via) {
    var list = Array.isArray(via) ? via : (isStr(via) ? [via] : []);
    var full = [];
    var short = [];
    for (var i = 0; i < list.length; i++) {
      if (!isStr(list[i])) continue;
      var f = list[i].trim();
      var s = shortVia(f);
      if (full.indexOf(f) === -1) full.push(f);
      if (short.indexOf(s) === -1) short.push(s);
    }
    return { full: full, short: short };
  }

  // ---------- blank dimensions ----------

  function dimLabel(key) {
    if (DIM_LABELS.hasOwnProperty(key)) return DIM_LABELS[key];
    var t = key.trim().replace(/[_-]+/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function blankText(blank) {
    if (!Array.isArray(blank)) return null;
    var keys = [];
    var reasons = {};
    for (var i = 0; i < blank.length; i++) {
      var b = blank[i];
      var k = isStr(b) ? b.trim() : (b && isStr(b.key) ? b.key.trim() : null);
      if (k && keys.indexOf(k) === -1) keys.push(k);
      // {key, reason}: say why ("set a budget or income") instead of a generic "no data".
      if (k && b && isStr(b.reason) && b.reason.trim() && !reasons[k]) reasons[k] = b.reason.trim();
    }
    if (!keys.length) return null;
    keys.sort(function (a, b) {
      var ia = DIM_ORDER.indexOf(a);
      var ib = DIM_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    var lower = function (s) { return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; };
    return 'Not scored: ' + keys.map(function (k) { return dimLabel(k) + ' (' + lower(reasons[k] || 'no data') + ')'; }).join(', ');
  }

  // ---------- DOM ----------

  function buildItem(doc, item, kind, fetchedAt) {
    var key = isStr(item.key) ? item.key.trim() : '';
    var li = make(doc, 'li', 'mbx-halos__item');
    li.setAttribute('data-dim', key);
    li.setAttribute('data-kind', kind);
    if (isNum(item.score)) li.setAttribute('data-score', String(Math.round(item.score)));

    var label = make(doc, 'span', 'mbx-halos__label');
    var text = isStr(item.label) ? item.label.trim() : (key ? dimLabel(key) : DASH);
    label.appendChild(make(doc, 'span', 'mbx-halos__text', text));
    li.appendChild(label);

    var hasNum = isStr(item.number) || isNum(item.number);
    li.appendChild(make(doc, 'span', 'mbx-halos__num' + (hasNum ? '' : ' mbx-halos__num--none'),
      hasNum ? String(item.number).trim() : DASH));

    var v = vias(item.via);
    var when = whenText(item.as_of, fetchedAt);
    var picked = item.picked === true;
    if (picked || v.short.length || when) {
      var meta = make(doc, 'span', 'mbx-halos__meta');
      if (picked) {
        meta.appendChild(make(doc, 'span', 'mbx-halos__tag', 'Your priority'));
        meta.appendChild(doc.createTextNode(' '));
      }
      if (v.short.length) {
        meta.appendChild(doc.createTextNode('via '));
        var ep = make(doc, 'span', 'mbx-halos__via', v.short.join(' + '));
        ep.setAttribute('title', v.full.join('\n'));
        meta.appendChild(ep);
      }
      if (when) meta.appendChild(doc.createTextNode((v.short.length ? SEP : '') + when));
      li.appendChild(meta);
    }
    return li;
  }

  function buildGroup(doc, spec, items, fetchedAt) {
    var list = [];
    if (Array.isArray(items)) {
      for (var i = 0; i < items.length; i++) if (items[i] && typeof items[i] === 'object') list.push(items[i]);
    }
    var group = make(doc, 'section', 'mbx-halos__group mbx-halos__group--' + spec.kind);
    var head = make(doc, 'h3', 'mbx-halos__head');
    head.appendChild(make(doc, 'span', 'mbx-halos__word', spec.title));
    head.appendChild(doc.createTextNode(' ')); // read as "Halos 3"; flex gap does the spacing
    head.appendChild(make(doc, 'span', 'mbx-halos__count', String(list.length)));
    group.appendChild(head);

    if (list.length) {
      var ul = make(doc, 'ul', 'mbx-halos__list');
      ul.setAttribute('aria-label', spec.title);
      for (var j = 0; j < list.length; j++) ul.appendChild(buildItem(doc, list[j], spec.kind, fetchedAt));
      group.appendChild(ul);
    } else {
      group.appendChild(make(doc, 'p', 'mbx-halos__empty', spec.empty));
    }
    return group;
  }

  function fill(doc, body, data) {
    var d = data && typeof data === 'object' ? data : {};
    while (body.firstChild) body.removeChild(body.firstChild);
    for (var i = 0; i < GROUPS.length; i++) {
      var g = GROUPS[i];
      if (g.empty === null && !(Array.isArray(d[g.prop]) && d[g.prop].length)) continue; // optional group, nothing in it
      body.appendChild(buildGroup(doc, g, d[g.prop], d.fetched_at));
    }
    var b = blankText(d.blank);
    if (b) body.appendChild(make(doc, 'p', 'mbx-halos__blank', b));
  }

  // Adds the stylesheet once, unless the panel already put MBX.halos.css in this shadow root.
  function ensureCss(doc, container, root) {
    var scope = typeof container.getRootNode === 'function' ? container.getRootNode() : null;
    if (scope && typeof scope.querySelectorAll === 'function') {
      var styles = scope.querySelectorAll('style');
      for (var i = 0; i < styles.length; i++) {
        if ((styles[i].textContent || '').indexOf(CSS_MARK) !== -1) return;
      }
    }
    root.appendChild(make(doc, 'style', null, CSS));
  }

  function render(container, data) {
    if (!container || typeof container.appendChild !== 'function') {
      throw new TypeError('MBX.halos.render: a container element is required');
    }
    var doc = container.ownerDocument || globalThis.document;

    // One list per container: a second render replaces the first instead of stacking.
    var kids = container.children || [];
    for (var i = kids.length - 1; i >= 0; i--) {
      if (kids[i].classList && kids[i].classList.contains('mbx-halos')) container.removeChild(kids[i]);
    }

    var root = make(doc, 'div', 'mbx-halos');
    ensureCss(doc, container, root);
    var body = make(doc, 'div', 'mbx-halos__body');
    root.appendChild(body);
    container.appendChild(root);

    var handle = {
      el: root,
      update: function (next) {
        fill(doc, body, next);
        return handle;
      }
    };
    fill(doc, body, data);
    return handle;
  }

  globalThis.MBX.halos = { render: render, css: CSS };
})();
