globalThis.MBX = globalThis.MBX || {};

/*
 * Listing Check side panel.
 * MBX.createPanel(handlers) -> { setState(state), updateScore(score, profile), destroy() }
 *   handlers: onSubmitAddress(text)            type-it box / address forms (content.js looks it up, source "typed")
 *             onPickCandidate({display_name, gnaf_id})   "Not this one?" pick (content.js looks it up, source "picked")
 *             onProfileSave(profile)            the profile block saved (content.js re-scores, or re-looks-up if work moved)
 *             onRetry(), onClose()
 *   state:    { kind: 'detecting' } | { kind: 'need_address', reason, prefill? } | { kind: 'loading', address, source }
 *             | { kind: 'error', address, source, message, detail }
 *             | { kind: 'result', address, source, blob, score?, profile? }
 *               blob = proxy /lookup body (blob.facts when status ok); score = MBX.score.scoreListing(blob.facts, profile),
 *               computed by content.js so income and budget never leave the browser.
 *   updateScore(score, profile) refreshes the fit, evidence, profile and pill in place.
 * The result:ok body is panel/panel.html's #mbx-result-template, styled by panel/panel.css plus the components' own CSS
 * (profile.js), adopted as constructable stylesheets. background.js reads both files (MBX_ASSETS).
 * Renders into an open shadow root on <div id="mbx-root">. DOM is built with createElement + textContent only;
 * the one HTML parse is of our own panel.html template: nothing from the page or the API is ever parsed as HTML.
 */
(function () {
  'use strict';

  var MBX = globalThis.MBX;
  var HOST_ID = 'mbx-root';
  var DASH = '–';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var SOURCE_LABELS = { 'json-ld': 'JSON-LD', h1: 'page heading', title: 'page title', typed: 'your input', picked: 'your pick' };
  var PLACEHOLDER = 'e.g. 26 Tudor Street, Surry Hills NSW 2010';

  var CSS = [
    ':host{all:initial}',
    '*,*::before,*::after{box-sizing:border-box}',
    '[hidden]{display:none!important}',
    '.panel,.pill{font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;',
    '  font-variant-numeric:tabular-nums;color:#18191b;-webkit-font-smoothing:antialiased;text-align:left;',
    '  position:fixed;top:88px;right:16px;z-index:2147483647;background:#fff;',
    '  border:1px solid rgba(0,0,0,.10);box-shadow:0 8px 28px rgba(0,0,0,.10)}',
    '.panel{width:360px;max-width:calc(100vw - 32px);max-height:calc(100vh - 104px);border-radius:12px;',
    '  display:flex;flex-direction:column;overflow:hidden}',
    'h2,h3,p,ul,ol{margin:0;padding:0}',
    'p,li{text-wrap:pretty}',
    'ul,ol{list-style:none}',
    'button{font:inherit;color:inherit}',
    'button:focus-visible,input:focus-visible,.body:focus-visible{outline:2px solid #009485;outline-offset:2px}',
    '.body:focus{outline:none}',

    /* header */
    '.head{flex:none;display:flex;align-items:center;gap:4px;padding:8px 8px 8px 16px;border-bottom:1px solid rgba(0,0,0,.08)}',
    '.brand{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;white-space:nowrap}',
    '.title{font-size:13px;font-weight:600;line-height:18px}',
    '.sub{font-size:11px;line-height:15px;color:#62666d;overflow:hidden;text-overflow:ellipsis}',
    '.badge{flex:none;margin-right:4px;font-size:10px;font-weight:600;line-height:14px;letter-spacing:.06em;',
    '  text-transform:uppercase;color:#8a5a00;border:1px solid #d9b25c;border-radius:4px;padding:1px 5px;white-space:nowrap}',
    '.iconbtn{flex:none;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;',
    '  padding:0;border:0;border-radius:6px;background:transparent;color:#62666d;cursor:pointer}',
    '.iconbtn:hover{background:rgba(0,0,0,.05);color:#18191b}',
    '.iconbtn svg{display:block}',

    /* body + sections */
    '.body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain}',
    '.banner{padding:7px 16px;font-size:12px;color:#8a5a00;background:#fff7e0;border-bottom:1px solid rgba(138,90,0,.10)}',
    '.sec{padding:12px 16px 14px}',
    '.sec+.sec{border-top:1px solid rgba(0,0,0,.08)}',
    '.label{margin:0 0 6px;font-size:11px;font-weight:600;line-height:16px;letter-spacing:.06em;text-transform:uppercase;color:#62666d}',
    '.muted{color:#62666d}',
    '.small{font-size:12px}',
    '.tiny{font-size:11px;line-height:1.4}',
    '.mt4{margin-top:4px}.mt8{margin-top:8px}.mt12{margin-top:12px}',
    '.lead{font-size:14px;font-weight:600;line-height:1.35;overflow-wrap:anywhere;text-wrap:balance}',
    '.err{color:#b42318}',
    '.nowrap{white-space:nowrap}',
    '.nodata{color:#62666d}',

    /* matched home */
    '.home{font-size:15px;font-weight:600;line-height:1.3;overflow-wrap:anywhere}',
    '.meta{margin-top:3px;font-size:12px;color:#62666d;overflow-wrap:anywhere}',
    '.exact{margin-top:8px;font-size:12px}',
    '.exact b{font-weight:600;color:#007a6e}',
    '.warn{margin-top:10px;padding:8px 10px;border-radius:8px;font-size:12px;color:#8a5a00;background:#fff7e0}',
    '.warn b{display:block;font-weight:600}',
    '.warn li,.cands li{position:relative;padding-left:10px;margin-top:2px}',
    '.warn li::before,.cands li::before{content:"";position:absolute;left:1px;top:.62em;width:3px;height:3px;border-radius:50%;background:currentColor}',
    '.skipped{margin-top:10px}',
    '.cands{margin-top:2px}',
    '.cands .why{display:block;color:#62666d}',
    '.cands li+li{margin-top:5px}',
    '.textbtn{display:inline;margin-top:10px;padding:0;border:0;background:none;cursor:pointer;',
    '  font-size:12px;font-weight:500;color:#007a6e;text-decoration:underline;text-decoration-color:rgba(0,122,110,.35);text-underline-offset:2px}',
    '.textbtn:hover{text-decoration-color:currentColor}',

    /* value */
    '.value{font-size:26px;font-weight:600;line-height:32px;letter-spacing:-.01em}',
    '.range{margin-top:1px}',
    '.conf{margin-top:8px;display:flex;align-items:center;gap:10px}',
    '.conf .clabel{flex:none}',
    '.bar{flex:1 1 auto;height:4px;border-radius:2px;background:#e9ecef;overflow:hidden}',
    '.bar>i{display:block;height:100%;border-radius:2px;background:#009485}',

    /* basics */
    '.facts{font-size:14px;font-weight:500}',
    '.facts .na{color:#8a8f96;font-weight:400}',

    /* rows: sales, DA heading */
    '.row{display:flex;align-items:baseline;gap:12px;min-width:0}',
    '.row .grow{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.row .end{flex:none;white-space:nowrap}',
    '.sale+.sale{margin-top:9px}',
    '.price{font-weight:600}',
    '.rentv{font-size:14px;font-weight:600}',
    '.dacat{font-weight:600}',
    '.desc{margin-top:6px;font-size:12px;color:#3d4146;overflow-wrap:anywhere}',
    '.sr{position:fixed;top:0;left:0;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}',
    '.clamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}',
    '.desc+.textbtn{margin-top:2px}',

    /* footer */
    '.foot{flex:none;padding:9px 16px 11px;border-top:1px solid rgba(0,0,0,.08)}',
    '.disc{font-size:12px;font-weight:500}',
    '.src{font-size:11px;color:#62666d}',

    /* form */
    '.addr{margin-top:12px}',
    '.addr label{display:block;margin-bottom:4px;font-size:12px;font-weight:600}',
    '.field{display:flex;gap:8px}',
    '.field input{flex:1 1 auto;min-width:0;height:32px;padding:0 10px;border:1px solid rgba(0,0,0,.18);border-radius:8px;',
    '  background:#fff;font:inherit;color:#18191b}',
    '.field input::placeholder{color:#8a8f96}',
    '.field input:focus-visible{outline-offset:0;border-color:#009485}',
    '.field input[aria-invalid="true"]{border-color:#b42318}',
    '.btn{flex:none;height:32px;padding:0 12px;border:1px solid #007a6e;border-radius:8px;background:#007a6e;',
    '  color:#fff;font-weight:600;cursor:pointer;white-space:nowrap}',
    '.btn:hover{background:#006b61;border-color:#006b61}',
    '.btn.ghost{background:#fff;color:#18191b;border-color:rgba(0,0,0,.18)}',
    '.btn.ghost:hover{background:#f4f5f6}',
    'input:disabled,.btn:disabled{opacity:.55;cursor:default}',
    '.hint{margin-top:4px;font-size:11px;color:#b42318}',

    /* skeleton */
    '.sk{display:block;height:10px;border-radius:4px;background:#eceef0;animation:mbx-pulse 1.4s ease-in-out infinite}',
    '.sk+.sk{margin-top:8px}',
    '.sk.big{height:24px;width:42%;margin-bottom:12px}',
    '@keyframes mbx-pulse{0%,100%{opacity:1}50%{opacity:.45}}',
    '@media (prefers-reduced-motion:reduce){.sk{animation:none}}',

    /* collapsed pill */
    '.pill{height:32px;padding:0 14px;border-radius:16px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}',
    '.pill:hover{background:#f7f8f9}',
    '.pill:focus-visible{outline:2px solid #009485;outline-offset:2px}',
    '.pill .pt{font-weight:600}',
    '.pill .pv{font-weight:600;color:#007a6e}',
    '.pill .badge{margin:0 0 0 2px}'
  ].join('\n');

  var sharedSheet = null;

  /* ---------- formatting (all null-safe) ---------- */

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isStr(v) { return typeof v === 'string' && v.trim() !== ''; }
  function trimZeros(s) { return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s; }

  // Compact money: $985k, $1.13m, $2m.
  function money(n) {
    if (!isNum(n)) return DASH;
    var a = Math.abs(n);
    var out;
    if (a >= 999500) out = '$' + trimZeros((a / 1e6).toFixed(2)) + 'm';
    else if (a >= 1000) out = '$' + Math.round(a / 1000) + 'k';
    else out = '$' + Math.round(a);
    return n < 0 ? '-' + out : out;
  }

  function wholeMoney(n) {
    return isNum(n) ? '$' + Math.round(n).toLocaleString('en-AU') : DASH;
  }

  // 'YYYY-MM-DD' (optionally with a time part) parsed by hand: no timezone shifts.
  function parseYmd(s) {
    if (!isStr(s)) return null;
    var m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(s.trim());
    if (!m) return null;
    var mo = +m[2];
    var d = m[3] ? +m[3] : null;
    if (mo < 1 || mo > 12 || (d !== null && (d < 1 || d > 31))) return null;
    if (d !== null && new Date(Date.UTC(+m[1], mo - 1, d)).getUTCDate() !== d) return null; // e.g. 31 Feb
    return { y: +m[1], m: mo, d: d };
  }
  function fmtDate(s) {
    var p = parseYmd(s);
    return p ? (p.d ? p.d + ' ' : '') + MONTHS[p.m - 1] + ' ' + p.y : null;
  }
  function fmtMonth(s) {
    var p = parseYmd(s);
    return p ? MONTHS[p.m - 1] + ' ' + p.y : null;
  }

  function fmtKm(km) {
    if (!isNum(km) || km < 0) return null;
    var m = Math.round(km * 1000);
    if (m < 1000) return m + ' m';
    return trimZeros((km).toFixed(1)) + ' km';
  }
  function fmtMetres(m) { return isNum(m) ? fmtKm(m / 1000) : null; }

  function capitalise(s) {
    if (!isStr(s)) return null;
    var t = s.trim().replace(/[_]+/g, ' ').toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // Drop the trailing "NSW 2010" so street + suburb fit on one line.
  function shortAddr(s) {
    if (!isStr(s)) return null;
    return s.trim().replace(/,?\s+NSW\s+\d{4}\s*$/i, '');
  }
  function suburbLabel(s) {
    return isStr(s) ? s.replace(/\s*\(NSW\)\s*$/i, '') : null;
  }
  function countText(n) {
    return isNum(n) ? String(Math.round(n * 10) / 10) : null;
  }

  /* ---------- DOM helpers (no HTML parsing, ever) ---------- */

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = String(v);
        else if (k === 'onclick') el.addEventListener('click', v);
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    if (kids !== undefined) add(el, kids);
    return el;
  }
  function add(el, kids) {
    if (!Array.isArray(kids)) kids = [kids];
    kids.forEach(function (c) {
      if (c === null || c === undefined || c === false || c === '') return;
      if (Array.isArray(c)) add(el, c);
      else if (typeof c === 'string' || typeof c === 'number') el.appendChild(document.createTextNode(String(c)));
      else el.appendChild(c);
    });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  var SVGNS = 'http://www.w3.org/2000/svg';
  function icon(d) {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.6');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }
  var ICON_COLLAPSE = 'M4 10l4-4 4 4';
  var ICON_CLOSE = 'M4.5 4.5l7 7M11.5 4.5l-7 7';

  function applyStyles(root) {
    try {
      if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in root &&
          'replaceSync' in CSSStyleSheet.prototype) {
        if (!sharedSheet) {
          sharedSheet = new CSSStyleSheet();
          sharedSheet.replaceSync(CSS);
        }
        root.adoptedStyleSheets = [sharedSheet];
        return;
      }
    } catch (e) { /* fall through to <style> */ }
    var st = document.createElement('style');
    st.textContent = CSS;
    root.appendChild(st);
  }

  function section(label, kids) {
    return h('section', { class: 'sec' }, [h('h3', { class: 'label', text: label }), kids]);
  }

  // Section<T>: { available: true, data } | { available: false, reason, message }
  function dataSection(label, sec, renderData) {
    var ok = sec && sec.available === true && sec.data !== null && sec.data !== undefined;
    if (!ok) {
      var msg = sec && isStr(sec.message) ? sec.message : null;
      return section(label, [
        h('p', { class: 'nodata', text: 'No data' }),
        msg ? h('p', { class: 'tiny muted mt4', text: msg }) : null
      ]);
    }
    return section(label, renderData(sec.data));
  }

  function skeleton(widths, big) {
    var out = [];
    if (big) out.push(h('span', { class: 'sk big', 'aria-hidden': 'true' }));
    widths.forEach(function (w) {
      var s = h('span', { class: 'sk', 'aria-hidden': 'true' });
      s.style.width = w + '%';
      out.push(s);
    });
    return out;
  }

  /* ---------- result view assets: panel/panel.html template + panel/panel.css (read by background.js) ---------- */

  var assets = null; // { tpl: Element (.mbx-body), sheets: CSSStyleSheet[] | null, cssText: string }
  var assetsP = null;
  var assetsError = null;

  function cssOf(name) {
    var c = MBX[name];
    return c && isStr(c.css) ? c.css : '';
  }
  function sheetFrom(text) {
    try {
      if (typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype) {
        var sh = new CSSStyleSheet();
        sh.replaceSync(String(text || ''));
        return sh;
      }
    } catch (e) { /* fall back to <style> */ }
    return null;
  }
  function loadAssets() {
    if (assets) return Promise.resolve(assets);
    if (assetsP) return assetsP;
    assetsP = new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: 'MBX_ASSETS' }, function (res) {
          var err = chrome.runtime.lastError;
          resolve(err ? { ok: false, message: 'Could not read the panel files.', detail: String(err.message || err) } : res);
        });
      } catch (e) {
        resolve({ ok: false, message: 'The extension was reloaded. Reload this page.', detail: String((e && e.message) || e) });
      }
    }).then(function (res) {
      assetsP = null;
      try {
        if (!res || !res.ok || !isStr(res.html)) throw new Error((res && res.message) || 'Could not read the panel files.');
        var doc = new DOMParser().parseFromString(res.html, 'text/html');
        var tpl = doc.getElementById('mbx-result-template');
        var first = tpl && tpl.content && tpl.content.firstElementChild;
        if (!first) throw new Error('The panel template is missing.');
        var parts = [String(res.css || ''), cssOf('profile')];
        var sheets = [];
        parts.forEach(function (t) { var sh = sheetFrom(t); if (sh) sheets.push(sh); });
        assets = { tpl: first, sheets: sheets.length === parts.length ? sheets : null, cssText: parts.join('\n') };
        assetsError = null;
      } catch (e) {
        assetsError = String((e && e.message) || e);
      }
      return assets;
    });
    return assetsP;
  }

  /* ---------- the panel ---------- */

  MBX.createPanel = function (handlers) {
    handlers = handlers || {};
    var existing = document.getElementById(HOST_ID);
    if (existing) existing.remove();

    var host = document.createElement('div');
    host.id = HOST_ID;
    // Closed: the listing site's own scripts (analytics, session replay) cannot read the profile figures shown in
    // the panel through host.shadowRoot. Open only when the caller asks (dev preview, e2e harness via "mbx.dev").
    var root = host.attachShadow({ mode: handlers.shadowMode === 'open' ? 'open' : 'closed' });
    applyStyles(root);

    var uid = 0;
    var destroyed = false;
    var collapsed = false;
    var current = { kind: 'detecting' };
    var afterRender = [];
    var mounts = []; // run synchronously once the body is in the shadow root (components measure and animate)
    var layoutProbes = []; // re-run on expand: a collapsed (display:none) panel measures 0
    var live = null; // mounted result view: { el, meter, halos, profile, verdict, fetchedAt }
    var resultStylesOn = false;
    var assetsFailedFor = null;

    function call(name, arg) {
      var fn = handlers[name];
      if (typeof fn === 'function') {
        try { fn(arg); } catch (e) { console.warn('[MBX] ' + name + ' handler failed', e); }
      }
    }

    var badge = h('span', { class: 'badge', text: 'Mock data', title: 'The proxy is serving sample figures', hidden: true });
    var collapseBtn = h('button', {
      type: 'button', class: 'iconbtn', 'aria-label': 'Collapse Listing Check', title: 'Collapse (Esc)', 'aria-expanded': 'true'
    }, icon(ICON_COLLAPSE));
    var closeBtn = h('button', {
      type: 'button', class: 'iconbtn', 'aria-label': 'Close Listing Check', title: 'Close'
    }, icon(ICON_CLOSE));
    var head = h('header', { class: 'head' }, [
      h('div', { class: 'brand' }, [
        h('h2', { class: 'title', text: 'Listing Check' }),
        h('span', { class: 'sub', text: 'Microburbs data' })
      ]),
      badge, collapseBtn, closeBtn
    ]);
    var body = h('div', { class: 'body', tabindex: '-1' });
    var foot = h('footer', { class: 'foot' }, [
      h('p', { class: 'disc', text: 'Microburbs estimate, indicative only.' }),
      h('p', { class: 'src', text: 'Data: Microburbs · Open G-NAF © Geoscape' })
    ]);
    var panel = h('aside', { class: 'panel', 'aria-label': 'Listing Check, Microburbs data' }, [head, body, foot]);
    var pill = h('button', { type: 'button', class: 'pill', hidden: true, 'aria-expanded': 'false' });

    // Screen-reader announcement of state changes (outside .panel so it still speaks when collapsed).
    var status = h('p', { class: 'sr', role: 'status', 'aria-live': 'polite' });

    root.appendChild(panel);
    root.appendChild(pill);
    root.appendChild(status);
    document.documentElement.appendChild(host);
    loadAssets(); // warm: the template is usually ready before the first answer comes back

    function useResultStyles() {
      if (resultStylesOn || !assets) return;
      resultStylesOn = true;
      var done = false;
      if (assets.sheets && 'adoptedStyleSheets' in root) {
        try {
          root.adoptedStyleSheets = Array.prototype.slice.call(root.adoptedStyleSheets).concat(assets.sheets);
          done = true;
        } catch (e) { /* fall back to <style> */ }
      }
      if (!done) {
        var st = document.createElement('style');
        st.textContent = assets.cssText;
        root.appendChild(st);
      }
      // Markers only: meter.js and halos.js look for these and then skip adding a second copy of their CSS.
      var mk = document.createElement('style');
      mk.setAttribute('data-mbx', 'markers');
      mk.textContent = '/*mbx-meter*/ /* mbx-halos */';
      root.appendChild(mk);
    }

    function setCollapsed(next, moveFocus) {
      collapsed = !!next;
      panel.hidden = collapsed;
      pill.hidden = !collapsed;
      collapseBtn.setAttribute('aria-expanded', String(!collapsed));
      if (moveFocus) (collapsed ? pill : collapseBtn).focus();
      if (!collapsed && layoutProbes.length) {
        var probes = layoutProbes;
        requestAnimationFrame(function () {
          if (destroyed) return;
          probes.forEach(function (fn) { try { fn(); } catch (e) { /* layout probe only */ } });
        });
      }
    }

    collapseBtn.addEventListener('click', function () { setCollapsed(true, true); });
    pill.addEventListener('click', function () { setCollapsed(false, true); });
    closeBtn.addEventListener('click', function () { call('onClose'); });

    // Keep keystrokes inside the panel (page shortcuts must not fire while typing). Esc collapses.
    function onKey(e) {
      if (e.type === 'keydown' && e.key === 'Escape' && !collapsed) {
        e.preventDefault();
        setCollapsed(true, true);
      }
      e.stopPropagation();
    }
    ['keydown', 'keyup', 'keypress'].forEach(function (t) { panel.addEventListener(t, onKey); });

    /* ----- pieces ----- */

    function addressForm(opts) {
      opts = opts || {};
      var id = 'mbx-addr-' + (++uid);
      var input = h('input', {
        type: 'text', id: id, name: 'address', autocomplete: 'off', spellcheck: 'false',
        placeholder: PLACEHOLDER
      });
      input.value = isStr(opts.value) ? opts.value.trim() : '';
      var hint = h('p', { class: 'hint', id: id + '-hint', hidden: true, text: 'Enter a street address and suburb.' });
      var btn = h('button', { type: 'submit', class: 'btn', text: opts.disabled ? 'Looking up…' : 'Look up' });
      if (opts.disabled) { input.disabled = true; btn.disabled = true; }
      var form = h('form', { class: 'addr', novalidate: true }, [
        h('label', { for: id, text: 'Address' }),
        h('div', { class: 'field' }, [input, btn]),
        hint
      ]);
      input.addEventListener('input', function () {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
        hint.hidden = true;
      });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (input.disabled) return;
        var text = input.value.trim();
        if (!text) {
          input.setAttribute('aria-invalid', 'true');
          input.setAttribute('aria-describedby', hint.id);
          hint.hidden = false;
          input.focus();
          return;
        }
        call('onSubmitAddress', text);
      });
      // Only take focus when the page itself has none (never steal it from a page field).
      if (opts.autofocus) afterRender.push(function () {
        var a = document.activeElement;
        if (!a || a === document.body || a === document.documentElement || a === host) input.focus({ preventScroll: true });
      });
      form._input = input;
      return form;
    }

    function retryButton() {
      return h('button', { type: 'button', class: 'btn ghost mt12', text: 'Retry', onclick: function () { call('onRetry'); } });
    }

    function candidateList(list) {
      if (!Array.isArray(list) || !list.length) return null;
      return h('ul', { class: 'cands tiny' }, list.map(function (c) {
        c = c || {};
        return h('li', null, [
          h('span', { text: isStr(c.display_name) ? c.display_name : DASH }),
          isStr(c.why_skipped) ? h('span', { class: 'why', text: c.why_skipped }) : null
        ]);
      }));
    }

    /* ----- result:ok view (panel/panel.html template) ----- */

    function checkInfo(m, blob) {
      var check = m.check || null;
      var notes = check && Array.isArray(check.notes) ? check.notes.filter(isStr) : [];
      var kind = null;
      var head = '';
      if (check && isStr(check.verdict)) {
        kind = check.verdict === 'exact' || check.verdict === 'partial' ? check.verdict : 'weak';
        if (kind === 'exact') {
          head = 'Exact match';
        } else if (kind === 'partial') head = 'Close match: check the unit/number';
        else head = 'Weak match: check this is the right home';
      }
      if (isNum(m.rank) && m.rank > 1) {
        var cands = Array.isArray(blob.candidates) ? blob.candidates : [];
        var idx = -1;
        for (var i = 0; i < cands.length; i++) { if (cands[i] && cands[i].gnaf_id === m.gnaf_id) { idx = i; break; } }
        var before = idx >= 0 ? cands.slice(0, idx) : [];
        var k = before.length || Math.round(m.rank) - 1;
        var outside = before.length && before.every(function (c) { return c && c.in_coverage === false; });
        notes.push('skipped ' + k + ' higher-ranked result' + (k === 1 ? '' : 's') + (outside ? ' outside the City of Sydney' : ''));
      }
      var text = kind === 'exact' ? head : [head].concat(notes.slice(0, 1)).filter(isStr).join(' · ');
      return { kind: kind, text: text };
    }

    function scoreAttrs(el, sc, profile, fit) {
      var mode = sc && isStr(sc.mode) ? sc.mode
        : (profile && profile.budget && isStr(profile.budget.mode) ? profile.budget.mode : '');
      el.setAttribute('data-total', fit && isNum(fit.total) ? String(fit.total) : '');
      el.setAttribute('data-blank', sc && Array.isArray(sc.blank) ? sc.blank.join(',') : '');
      el.setAttribute('data-mode', mode);
    }
    function warn(what, e) { console.warn('[Listing Check] ' + what + ' could not render', e); }

    function renderFit(s, blob) {
      var match = live.el.getAttribute('data-check');
      var trusted = match !== 'partial' && match !== 'weak';
      var fit = MBX.insights.summarize(s.score, blob.facts, s.profile, trusted, blob.sections);
      live.fit = fit;
      scoreAttrs(live.el, s.score, s.profile, fit);
      live.gauge.hidden = !trusted;
      live.confirm.hidden = trusted;
      if (trusted) {
        if (live.meter) live.meter.update(fit);
        else live.meter = MBX.meter.render(live.meterSlot, fit);
      }
      MBX.insights.render(live.insights, fit);
    }

    function mountScore(el, s, blob) {
      var profileSlot = el.querySelector('[data-slot="profile"]');
      live = {
        el: el, meter: null, profile: null, fit: null,
        gauge: el.querySelector('.mbx-score'), confirm: el.querySelector('[data-slot="confirm-match"]'),
        meterSlot: el.querySelector('[data-slot="meter"]'), insights: el.querySelector('[data-slot="insights"]')
      };
      try { renderFit(s, blob); } catch (e) { warn('fit summary', e); }
      try {
        if (MBX.profile && profileSlot && s.profile) {
          live.profile = MBX.profile.render(profileSlot, s.profile, { onSave: function (p) { call('onProfileSave', p); } });
        }
      } catch (e) { warn('profile', e); }
    }

    function resultView(s, blob) {
      var m = blob.match || {};
      var el = document.importNode(assets.tpl, true);
      function q(sel) { return el.querySelector(sel); }
      var listing = isStr(s.address) ? s.address.trim() : (isStr(blob.query) ? blob.query : '');
      var src = SOURCE_LABELS[s.source] || (isStr(s.source) ? s.source : null);

      var nameEl = q('[data-bind="display_name"]');
      if (nameEl) nameEl.textContent = isStr(m.display_name) ? m.display_name : DASH;
      var lineEl = q('[data-bind="listing_line"]');
      var ci = checkInfo(m, blob);
      if (lineEl && ci.kind !== 'exact') lineEl.textContent = listing ? 'Listing: ' + listing + (src ? ' · from ' + src : '') : '';
      var checkEl = q('[data-bind="check"]');
      if (checkEl) {
        checkEl.textContent = ci.text;
        if (ci.kind) checkEl.classList.add('mbx-addr__check--' + ci.kind);
      }
      el.setAttribute('data-check', ci.kind || '');

      // "Not this one?": other in-coverage candidates, then the type-it box.
      var toggle = q('[data-action="not-this-one"]');
      var picker = q('[data-slot="picker"]');
      var list = q('[data-slot="picker-list"]');
      var form = q('[data-slot="typeit"]');
      var input = form ? form.querySelector('input') : null;
      var others = (Array.isArray(blob.candidates) ? blob.candidates : []).filter(function (c) {
        return c && c.in_coverage === true && isStr(c.display_name) && c.gnaf_id !== m.gnaf_id;
      });
      if (list) {
        if (others.length) {
          others.forEach(function (c) {
            var b = h('button', { type: 'button', class: 'mbx-picker__item', 'data-gnaf': isStr(c.gnaf_id) ? c.gnaf_id : '', text: c.display_name });
            b.addEventListener('click', function () {
              call('onPickCandidate', { display_name: c.display_name, gnaf_id: isStr(c.gnaf_id) ? c.gnaf_id : null });
            });
            list.appendChild(h('li', null, b));
          });
        } else {
          list.appendChild(h('li', { class: 'mbx-picker__empty', text: 'No other matches in the City of Sydney' }));
        }
      }
      if (input) input.value = listing;
      if (toggle && picker) {
        toggle.addEventListener('click', function () {
          var open = picker.hidden;
          picker.hidden = !open;
          toggle.setAttribute('aria-expanded', String(open));
          if (open) {
            var first = picker.querySelector('.mbx-picker__item') || input;
            if (first) first.focus();
          }
        });
      }
      if (form && input) {
        input.addEventListener('input', function () { input.removeAttribute('aria-invalid'); });
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var text = input.value.trim();
          if (!text) {
            input.setAttribute('aria-invalid', 'true');
            input.focus();
            return;
          }
          call('onSubmitAddress', text);
        });
      }

      mounts.push(function () { mountScore(el, s, blob); });
      return el;
    }

    function updateScore(score, profile) {
      if (destroyed) return;
      if (current.kind !== 'result' || !current.blob || current.blob.status !== 'ok') return;
      current = Object.assign({}, current, { score: score || null, profile: profile || current.profile || null });
      if (!live) { render(); return; }
      try { renderFit(current, current.blob); } catch (e) { warn('fit summary', e); }
      try { if (live.profile && profile) live.profile.update(profile); } catch (e) { warn('profile', e); }
      renderPill();
      status.textContent = statusText(current);
    }

    /* ----- states ----- */

    function renderOk(s, blob) {
      var banner = blob.mode === 'mock' ? h('p', { class: 'banner', text: 'Sample figures from fixtures, not this property.' }) : null;
      if (assets) {
        useResultStyles();
        return [banner, resultView(s, blob)];
      }
      if (assetsFailedFor === s) {
        return [banner, h('section', { class: 'sec' }, [
          h('p', { class: 'lead err', text: 'Could not load the panel layout.' }),
          isStr(assetsError) ? h('p', { class: 'tiny muted mt4', text: assetsError }) : null,
          h('button', { type: 'button', class: 'btn ghost mt12', text: 'Retry', onclick: function () { assetsFailedFor = null; render(); } })
        ])];
      }
      loadAssets().then(function (a) {
        if (destroyed || current !== s) return;
        if (!a) assetsFailedFor = s;
        render();
      });
      return [banner, h('section', { class: 'sec', 'aria-busy': 'true' }, skeleton([30], true).concat(skeleton([64, 46])))];
    }

    function renderResult(s) {
      var blob = s.blob && typeof s.blob === 'object' ? s.blob : {};
      var query = isStr(blob.query) ? blob.query : (isStr(s.address) ? s.address : '');
      var banner = null; // the 'Sample figures' banner only makes sense next to figures (status ok); the header badge still says MOCK DATA
      switch (blob.status) {
        case 'ok':
          return renderOk(s, blob);
        case 'no_match':
          return [banner, h('section', { class: 'sec' }, [
            h('p', { class: 'lead', text: 'No address match for “' + query + '”.' }),
            h('p', { class: 'small muted mt4', text: 'Try the street number, street and suburb, as on the listing.' }),
            addressForm({ value: query })
          ])];
        case 'outside_coverage': {
          var cands = Array.isArray(blob.candidates) ? blob.candidates.slice(0, 3) : [];
          return [banner, h('section', { class: 'sec' }, [
            h('p', { class: 'lead', text: 'This home is outside the City of Sydney coverage.' }),
            h('p', { class: 'small muted mt4', text: 'Microburbs data here covers the 29 City of Sydney suburbs only.' }),
            cands.length ? h('p', { class: 'label mt12', text: 'Geocoder results' }) : null,
            candidateList(cands),
            addressForm({ value: query })
          ])];
        }
        default: {
          var err = blob.error || {};
          return [banner, h('section', { class: 'sec' }, [
            h('p', { class: 'lead err', text: isStr(err.message) ? err.message : 'The lookup failed.' }),
            isStr(err.request_id) ? h('p', { class: 'tiny muted mt4', text: 'Request ID ' + err.request_id }) : null,
            retryButton(),
            addressForm({ value: query })
          ])];
        }
      }
    }

    function renderState(s) {
      switch (s.kind) {
        case 'detecting':
          return h('section', { class: 'sec', 'aria-busy': 'true' }, [
            h('p', { class: 'muted', text: 'Reading the address on this page…' }),
            h('div', { class: 'mt12' }, skeleton([78, 52]))
          ]);
        case 'need_address':
          return h('section', { class: 'sec' }, [
            h('p', { class: 'lead', text: 'Couldn’t read an address on this page.' }),
            h('p', { class: 'small muted mt4', text: 'Type the listing address to look it up.' }),
            addressForm({ value: s.prefill, autofocus: true })
          ]);
        case 'loading':
          return [
            h('section', { class: 'sec', 'aria-busy': 'true' }, [
              h('p', { class: 'lead', text: 'Matching “' + (isStr(s.address) ? s.address.trim() : '') + '”…' }),
              s.source && SOURCE_LABELS[s.source] ? h('p', { class: 'small muted mt4', text: 'Address from ' + SOURCE_LABELS[s.source] }) : null,
              s.source === 'typed' ? addressForm({ value: s.address, disabled: true }) : null
            ]),
            h('section', { class: 'sec', 'aria-hidden': 'true' }, skeleton([30], true).concat(skeleton([64, 46]))),
            h('section', { class: 'sec', 'aria-hidden': 'true' }, skeleton([24, 88, 70, 82]))
          ];
        case 'result':
          return renderResult(s);
        case 'error':
          return h('section', { class: 'sec' }, [
            h('p', { class: 'lead err', text: isStr(s.message) ? s.message : 'Could not reach the lookup service.' }),
            isStr(s.detail) ? h('p', { class: 'tiny muted mt4', text: s.detail }) : null,
            retryButton(),
            addressForm({ value: s.address })
          ]);
        default:
          return h('section', { class: 'sec' }, h('p', { class: 'muted', text: 'Unknown state.' }));
      }
    }

    function stateKey(s) {
      if (s.kind !== 'result') return String(s.kind || 'unknown');
      var st = s.blob && isStr(s.blob.status) ? s.blob.status : 'unknown';
      return 'result:' + st;
    }

    function compactValue() {
      var fit = live && live.fit;
      if (fit && isNum(fit.total)) return String(fit.total);
      return null;
    }

    function renderPill() {
      clear(pill);
      var val = compactValue();
      var mock = current.kind === 'result' && current.blob && current.blob.mode === 'mock';
      add(pill, [
        h('span', { class: 'pt', text: 'Listing Check' }),
        val ? h('span', { class: 'muted', text: '·' }) : null,
        val ? h('span', { class: 'pv', text: val }) : null,
        mock ? h('span', { class: 'badge', text: 'Mock' }) : null
      ]);
      pill.setAttribute('aria-label', 'Expand Listing Check' + (val ? ', fit score ' + val : '') + (mock ? ', mock data' : ''));
    }

    function render() {
      var active = root.activeElement;
      var hadFocus = !!(active && body.contains(active));
      afterRender = [];
      mounts = [];
      layoutProbes = [];
      live = null;
      badge.hidden = !(current.kind === 'result' && current.blob && current.blob.mode === 'mock');
      clear(body);
      add(body, renderState(current));
      // result:ok carries its own footer ("Microburbs estimates, not advice"); the shell footer shows everywhere else.
      foot.hidden = !!body.querySelector('.mbx-body');
      var mj = mounts;
      mounts = [];
      mj.forEach(function (fn) { try { fn(); } catch (e) { warn('result view', e); } });
      body.scrollTop = 0;
      renderPill();
      var jobs = afterRender;
      var focusBody = hadFocus && !jobs.length;
      requestAnimationFrame(function () {
        if (destroyed) return;
        jobs.forEach(function (fn) { try { fn(); } catch (e) { /* layout probe only */ } });
        if (focusBody && !collapsed) body.focus({ preventScroll: true });
      });
    }

    function statusText(s) {
      var pre = 'Listing Check: ';
      switch (s.kind) {
        case 'detecting': return pre + 'reading the address on this page.';
        case 'need_address': return pre + 'no address found on this page. Type the address to look it up.';
        case 'loading': return pre + 'looking up the address.';
        case 'error': return pre + 'lookup failed. ' + (isStr(s.message) ? s.message : '');
        case 'result':
          var st = s.blob && s.blob.status;
          if (st === 'ok') { var v = compactValue(); return pre + (v ? 'fit score ' + v + '.' : 'home matched, not enough data to score it.'); }
          if (st === 'no_match') return pre + 'no address match.';
          if (st === 'outside_coverage') return pre + 'this address is outside the City of Sydney.';
          return pre + 'lookup failed.';
        default: return '';
      }
    }

    function setState(state) {
      if (destroyed) return;
      current = state && typeof state === 'object' ? state : { kind: 'detecting' };
      host.setAttribute('data-mbx-state', stateKey(current));
      var q = isStr(current.address) ? current.address.trim()
        : (current.blob && isStr(current.blob.query) ? current.blob.query : null);
      if (q) host.setAttribute('data-mbx-query', q); else host.removeAttribute('data-mbx-query');
      if (isStr(current.source)) host.setAttribute('data-mbx-source', current.source); else host.removeAttribute('data-mbx-source');
      render();
      status.textContent = statusText(current);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      host.remove();
    }

    setState(current);
    return { setState: setState, updateScore: updateScore, destroy: destroy };
  };

  // Exposed for dev previews and quick checks; not part of the content-script contract.
  MBX.panelFormat = { money: money, wholeMoney: wholeMoney, fmtDate: fmtDate, fmtMonth: fmtMonth, fmtKm: fmtKm };
})();
