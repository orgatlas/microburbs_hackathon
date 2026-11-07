globalThis.MBX = globalThis.MBX || {};

/*
 * MBX.profile: the renter/buyer profile the fit score is weighed against.
 *
 *   MBX.profile.load()  -> Promise<profile>   chrome.storage.local["mbx.profile.v1"] merged over DEFAULT
 *   MBX.profile.save(p) -> Promise<profile>   validates, stores, resolves the stored copy
 *   MBX.profile.render(container, profile, { onSave(profile) }) -> { update(profile), el, destroy() }
 *   MBX.profile.summary(profile) -> "Sarah · rent <= $250/wk · cheap, close to work, safe"
 *
 * Privacy: the profile lives only in chrome.storage.local (or in memory when chrome.storage is
 * unavailable, e.g. preview pages or a manifest without the "storage" permission). Nothing in this
 * file sends anything anywhere; other code sends work_address alone to the proxy to locate the workplace.
 * DOM is built with createElement + textContent only and lives inside the given container.
 */
(function (MBX) {
  'use strict';

  var STORAGE_KEY = 'mbx.profile.v1';
  var MAX_PRIORITIES = 3;
  var STORAGE_TIMEOUT_MS = 1500;
  var DOT = ' · ';

  var PRIORITIES = [
    { key: 'cheap', label: 'Cheap' },
    { key: 'close_to_work', label: 'Close to work' },
    { key: 'safe', label: 'Safe' },
    { key: 'lively', label: 'Lively' },
    { key: 'quiet', label: 'Quiet' }
  ];
  var LABELS = Object.create(null);
  PRIORITIES.forEach(function (p) { LABELS[p.key] = p.label; });

  var DEFAULT = {
    version: 1,
    name: 'Sarah',
    about: '19 · casual retail',
    budget: { mode: 'rent', max_rent_week: 250, max_price: null },
    income_week: 600,
    work_address: '188 Pitt Street, Sydney NSW 2000',
    priorities: ['cheap', 'close_to_work', 'safe']
  };
  deepFreeze(DEFAULT);
  deepFreeze(PRIORITIES);

  function deepFreeze(o) {
    Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') deepFreeze(o[k]); });
    return Object.freeze(o);
  }

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined; }

  /* ----- parsing + validation ----- */

  // "250", "$250", "$1,200", "900k", "1.2m", "1.2 million", "250/wk", "250 pw" -> number.
  // Empty -> null. Anything else -> NaN.
  function parseMoney(input) {
    if (input === null || input === undefined) return null;
    if (typeof input === 'number') return isFinite(input) ? input : NaN;
    if (typeof input !== 'string') return NaN;
    var s = input.toLowerCase().replace(/[\s,]/g, '').replace(/^aud/, '').replace(/^\$/, '').replace(/aud$/, '');
    s = s.replace(/(\/|per)?(week|wk|pw|p\/w|w)$/, '');
    if (s === '') return null;
    var m = /^(\d+(?:\.\d+)?|\.\d+)(k|thousand|m|mil|million)?$/.exec(s);
    if (!m) return NaN;
    var n = parseFloat(m[1]);
    if (m[2] === 'k' || m[2] === 'thousand') n *= 1e3;
    else if (m[2]) n *= 1e6;
    return n;
  }

  // Numbers must be > 0 (whole dollars) or null.
  function cleanMoney(v) {
    var n = parseMoney(v);
    if (typeof n !== 'number' || !isFinite(n) || n <= 0 || n > 1e10) return null;
    return Math.round(n);
  }

  function cleanText(v, max) {
    return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  }

  function priorityKey(v) {
    if (typeof v !== 'string') return null;
    var k = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return LABELS[k] ? k : null;
  }

  function cleanPriorities(list) {
    var out = [];
    list.forEach(function (v) {
      var k = priorityKey(v);
      if (k && out.indexOf(k) < 0 && out.length < MAX_PRIORITIES) out.push(k);
    });
    return out;
  }

  // Merge over DEFAULT and validate. Keys that are present (even null or '') win over the default,
  // so a cleared field stays cleared; only missing keys take Sarah's values.
  function normalize(raw) {
    var src = isObj(raw) ? raw : {};
    var b = isObj(src.budget) ? src.budget : {};
    var d = DEFAULT;
    var mode = b.mode === 'buy' || b.mode === 'rent' ? b.mode : d.budget.mode;
    var addr = has(src, 'work_address') ? cleanText(src.work_address, 160) : d.work_address;
    return {
      version: 1,
      name: has(src, 'name') ? cleanText(src.name, 40) : d.name,
      about: has(src, 'about') ? cleanText(src.about, 60) : d.about,
      budget: {
        mode: mode,
        max_rent_week: has(b, 'max_rent_week') ? cleanMoney(b.max_rent_week) : d.budget.max_rent_week,
        max_price: has(b, 'max_price') ? cleanMoney(b.max_price) : d.budget.max_price
      },
      income_week: has(src, 'income_week') ? cleanMoney(src.income_week) : d.income_week,
      work_address: addr || null,
      priorities: Array.isArray(src.priorities) ? cleanPriorities(src.priorities) : d.priorities.slice()
    };
  }

  /* ----- storage ----- */

  var memory = null; // last profile loaded or saved; the store when chrome.storage is unavailable

  function storageArea() {
    try {
      var c = globalThis.chrome;
      var a = c && c.storage && c.storage.local;
      return a && typeof a.get === 'function' && typeof a.set === 'function' ? a : null;
    } catch (e) {
      return null;
    }
  }

  function lastError() {
    try {
      var c = globalThis.chrome;
      return (c && c.runtime && c.runtime.lastError) || null;
    } catch (e) {
      return null;
    }
  }

  // Calls a chrome.storage method that may answer by callback (Chrome) or by promise (MV3, stubs).
  // Settles exactly once; a silent store falls back after a timeout instead of hanging the panel.
  function callStorage(method, arg, onDone) {
    var settled = false;
    var timer = null;
    function done(ok, value) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      onDone(ok, value);
    }
    var a = storageArea();
    if (!a) { done(false); return; }
    timer = setTimeout(function () { done(false); }, STORAGE_TIMEOUT_MS);
    try {
      var ret = a[method](arg, function (value) { done(!lastError(), value); });
      if (ret && typeof ret.then === 'function') {
        ret.then(function (value) { done(true, value); }, function () { done(false); });
      }
    } catch (e) {
      done(false); // e.g. "Extension context invalidated" after a reload
    }
  }

  function load() {
    return new Promise(function (resolve) {
      callStorage('get', STORAGE_KEY, function (ok, items) {
        var stored = ok && isObj(items) ? items[STORAGE_KEY] : undefined;
        var p = normalize(stored !== undefined ? stored : memory);
        memory = p;
        resolve(normalize(p));
      });
    });
  }

  function save(profile) {
    var clean = normalize(profile);
    memory = clean;
    return new Promise(function (resolve) {
      var item = {};
      item[STORAGE_KEY] = normalize(clean);
      callStorage('set', item, function (ok) {
        if (!ok && storageArea()) console.warn('[MBX] profile kept in memory only: chrome.storage.local.set failed');
        resolve(normalize(clean));
      });
    });
  }

  /* ----- text ----- */

  function trimNum(n, dp) {
    return String(Number(n.toFixed(dp)));
  }

  // $250, $1,200, $900k, $1.2m
  function money(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
    if (n >= 1e6) return '$' + trimNum(n / 1e6, 2) + 'm';
    if (n >= 1e5) return '$' + trimNum(n / 1e3, 0) + 'k';
    return '$' + Math.round(n).toLocaleString('en-AU');
  }

  // What goes back into an input: 250, 900k, 1.2m (all accepted by parseMoney).
  function plainMoney(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '';
    if (n >= 1e6 && n % 1e4 === 0) return String(n / 1e6) + 'm';
    if (n >= 1e5 && n % 1e3 === 0) return String(n / 1e3) + 'k';
    return String(n);
  }

  function shortAddress(a) {
    return String(a || '')
      .replace(/,?\s+(NSW|ACT|VIC|QLD|SA|WA|TAS|NT)\b\.?\s*(\d{4})?\s*$/i, '')
      .replace(/,?\s+\d{4}\s*$/, '')
      .trim();
  }

  function budgetShort(p) {
    if (p.budget.mode === 'buy') return p.budget.max_price ? 'buy <= ' + money(p.budget.max_price) : 'buy, no max set';
    return p.budget.max_rent_week ? 'rent <= ' + money(p.budget.max_rent_week) + '/wk' : 'rent, no max set';
  }

  function summary(profile) {
    var p = normalize(profile);
    var parts = [];
    if (p.name) parts.push(p.name);
    parts.push(budgetShort(p));
    if (p.priorities.length) {
      parts.push(p.priorities.map(function (k) { return LABELS[k].toLowerCase(); }).join(', '));
    }
    return parts.join(DOT);
  }

  function whoLine(p) {
    if (p.name && p.about) return p.name + ', ' + p.about;
    return p.name || p.about || 'Your profile';
  }

  function budgetLine(p) {
    var parts = [];
    if (p.budget.mode === 'buy') {
      parts.push('Buying');
      parts.push(p.budget.max_price ? 'max ' + money(p.budget.max_price) : 'no max price set');
    } else {
      parts.push('Renting');
      parts.push(p.budget.max_rent_week ? 'max ' + money(p.budget.max_rent_week) + '/wk' : 'no max rent set');
    }
    parts.push(p.income_week ? 'income ' + money(p.income_week) + '/wk' : 'income not set');
    return parts.join(DOT);
  }

  /* ----- DOM ----- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  var uid = 0;

  var CSS = [
    '.mbx-profile{--mbx-profile-css:1;--mbx-profile-line:color-mix(in srgb,var(--mbx-muted,#62666d) 72%,transparent);',
    '  font-family:var(--mbx-font,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif);',
    '  font-size:13px;line-height:1.45;font-variant-numeric:tabular-nums;color:var(--mbx-ink,#18191b);text-align:left}',
    '.mbx-profile *,.mbx-profile *::before,.mbx-profile *::after{box-sizing:border-box}',
    '.mbx-profile [hidden]{display:none!important}',
    '.mbx-profile p,.mbx-profile ul,.mbx-profile fieldset,.mbx-profile legend{margin:0;padding:0}',
    '.mbx-profile ul{list-style:none}',
    '.mbx-profile fieldset{border:0;min-width:0}',
    '.mbx-profile button,.mbx-profile input{font:inherit;color:inherit;letter-spacing:inherit}',
    '.mbx-profile button{-webkit-tap-highlight-color:transparent}',
    '.mbx-profile button:focus-visible{outline:2px solid var(--mbx-accent,#009485);outline-offset:2px}',

    /* summary */
    '.mbx-profile__head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
    '.mbx-profile__who{min-width:0;display:flex;flex-direction:column}',
    '.mbx-profile__kicker{font-size:11px;font-weight:600;line-height:16px;letter-spacing:.06em;text-transform:uppercase;',
    '  color:var(--mbx-muted,#62666d)}',
    '.mbx-profile__name{margin-top:2px;font-size:14px;font-weight:600;line-height:1.35;overflow-wrap:anywhere}',
    '.mbx-profile__line{margin-top:2px;font-size:12px;color:var(--mbx-muted,#62666d);overflow-wrap:anywhere}',
    '.mbx-profile__name+.mbx-profile__line{margin-top:3px}',
    '.mbx-profile__tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}',
    '.mbx-profile__tag{font-size:11px;font-weight:500;line-height:16px;padding:2px 8px;border-radius:999px;',
    '  background:var(--mbx-hairline,rgba(0,0,0,.08));color:var(--mbx-ink,#18191b);white-space:nowrap}',
    '.mbx-profile__edit{flex:none;height:28px;padding:0 12px;border:1px solid var(--mbx-profile-line);',
    '  border-radius:calc(var(--mbx-radius,10px) - 2px);background:transparent;font-size:12px;font-weight:600;cursor:pointer}',
    '.mbx-profile__edit:hover{background:var(--mbx-hairline,rgba(0,0,0,.08))}',

    /* form */
    '.mbx-profile__form{display:flex;flex-direction:column;gap:12px}',
    '.mbx-profile__row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}',
    '.mbx-profile__row--who{grid-template-columns:minmax(0,2fr) minmax(0,3fr)}',
    '.mbx-profile__field{display:flex;flex-direction:column;min-width:0}',
    '.mbx-profile__label{display:block;margin-bottom:4px;font-size:12px;font-weight:600;line-height:16px;color:var(--mbx-ink,#18191b)}',
    '.mbx-profile__opt{font-weight:400;color:var(--mbx-muted,#62666d)}',
    '.mbx-profile__box{display:flex;align-items:center;gap:3px;height:32px;padding:0 10px;',
    '  border:1px solid var(--mbx-profile-line);border-radius:calc(var(--mbx-radius,10px) - 2px);background:transparent;cursor:text}',
    '.mbx-profile__box:focus-within{border-color:var(--mbx-accent,#009485);box-shadow:0 0 0 1px var(--mbx-accent,#009485)}',
    '.mbx-profile__box[data-invalid="true"]{border-color:var(--mbx-failo,#b42318)}',
    '.mbx-profile__box[data-invalid="true"]:focus-within{box-shadow:0 0 0 1px var(--mbx-failo,#b42318)}',
    '.mbx-profile__box input{flex:1 1 auto;min-width:0;width:100%;height:100%;margin:0;padding:0;border:0;outline:none;',
    '  background:transparent;font-variant-numeric:tabular-nums}',
    '.mbx-profile__box input::placeholder{color:var(--mbx-muted,#62666d);opacity:.75}',
    '.mbx-profile__affix{flex:none;color:var(--mbx-muted,#62666d)}',
    '.mbx-profile__err{margin-top:4px;font-size:11px;line-height:1.4;color:var(--mbx-failo,#b42318)}',
    '.mbx-profile__help{margin-top:4px;font-size:11px;line-height:1.4;color:var(--mbx-muted,#62666d)}',

    /* rent / buy toggle */
    '.mbx-profile__seg{display:inline-flex;align-self:flex-start;gap:2px;padding:2px;',
    '  border:1px solid var(--mbx-profile-line);border-radius:calc(var(--mbx-radius,10px) - 2px)}',
    '.mbx-profile__seg button{height:26px;min-width:72px;padding:0 14px;border:0;border-radius:calc(var(--mbx-radius,10px) - 4px);',
    '  background:transparent;color:var(--mbx-muted,#62666d);font-size:12px;font-weight:500;cursor:pointer}',
    '.mbx-profile__seg button:hover{color:var(--mbx-ink,#18191b)}',
    '.mbx-profile__seg button[aria-pressed="true"]{background:var(--mbx-accent-tint,#ecf8f6);color:var(--mbx-ink,#18191b);',
    '  font-weight:600;box-shadow:inset 0 0 0 1px var(--mbx-accent,#009485)}',

    /* priority chips */
    '.mbx-profile__chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.mbx-profile__chip{display:inline-flex;align-items:center;height:28px;padding:0 11px;border:1px solid var(--mbx-profile-line);',
    '  border-radius:999px;background:transparent;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;',
    '  transition:background-color .12s ease,border-color .12s ease}',
    '.mbx-profile__chip:hover:not(:disabled){background:var(--mbx-hairline,rgba(0,0,0,.08))}',
    '.mbx-profile__chip[aria-pressed="true"],.mbx-profile__chip[aria-pressed="true"]:hover{background:var(--mbx-accent-tint,#ecf8f6);',
    '  border-color:var(--mbx-accent,#009485);font-weight:600}',
    '.mbx-profile__chip[aria-pressed="true"]::before{content:"";flex:none;width:8px;height:4px;margin:0 7px 3px -1px;',
    '  border-left:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg)}',
    '.mbx-profile__chip:disabled{opacity:.42;cursor:not-allowed}',
    '.mbx-profile__hint{margin-top:6px;font-size:11px;line-height:1.4;color:var(--mbx-muted,#62666d)}',
    '.mbx-profile__hint[data-full="true"]{color:var(--mbx-ink,#18191b)}',

    /* actions */
    '.mbx-profile__actions{display:flex;align-items:center;gap:6px}',
    '.mbx-profile__save{height:32px;padding:0 18px;border:1px solid var(--mbx-accent,#009485);',
    '  border-radius:calc(var(--mbx-radius,10px) - 2px);background:var(--mbx-accent-tint,#ecf8f6);font-weight:600;cursor:pointer}',
    '.mbx-profile__save:hover{background:color-mix(in srgb,var(--mbx-accent,#009485) 14%,var(--mbx-accent-tint,#ecf8f6))}',
    '.mbx-profile__save:disabled{opacity:.6;cursor:default}',
    '.mbx-profile__cancel{height:32px;padding:0 12px;border:0;border-radius:calc(var(--mbx-radius,10px) - 2px);',
    '  background:transparent;color:var(--mbx-muted,#62666d);font-weight:500;cursor:pointer}',
    '.mbx-profile__cancel:hover{color:var(--mbx-ink,#18191b);background:var(--mbx-hairline,rgba(0,0,0,.08))}',
    '.mbx-profile__privacy{margin-left:auto;font-size:11px;line-height:1.4;color:var(--mbx-muted,#62666d);text-align:right}',

    '@media (prefers-reduced-motion:reduce){.mbx-profile *{transition:none!important}}'
  ].join('\n');

  // The panel is expected to inject MBX.profile.css into its shadow root. If it has not, add it
  // inside our own root (still within the container) so the component never renders unstyled.
  function ensureCss(root) {
    try {
      if (root.isConnected && getComputedStyle(root).getPropertyValue('--mbx-profile-css').trim() === '1') return;
    } catch (e) { /* fall through */ }
    var st = document.createElement('style');
    st.className = 'mbx-profile__css';
    st.textContent = CSS;
    root.insertBefore(st, root.firstChild);
  }

  function render(container, profile, opts) {
    opts = opts || {};
    var id = 'mbx-pf-' + (++uid);
    var current = normalize(profile);
    var collapsed = true;

    // re-rendering into the same container replaces our previous block (and only that)
    Array.prototype.slice.call(container.children).forEach(function (c) {
      if (c.classList && c.classList.contains('mbx-profile')) container.removeChild(c);
    });
    var root = el('div', 'mbx-profile');
    var view = el('div', 'mbx-profile__view');
    root.appendChild(view);
    container.appendChild(root);
    ensureCss(root);

    function setCollapsed(v) {
      collapsed = v;
      root.setAttribute('data-collapsed', v ? 'true' : 'false');
    }

    function clearView() {
      while (view.firstChild) view.removeChild(view.firstChild);
    }

    /* collapsed: summary + Edit */
    function showSummary(focusEdit) {
      setCollapsed(true);
      clearView();
      var p = current;

      var head = el('div', 'mbx-profile__head');
      var who = el('div', 'mbx-profile__who');
      who.appendChild(el('span', 'mbx-profile__kicker', 'Scored for'));
      who.appendChild(el('span', 'mbx-profile__name', whoLine(p)));
      head.appendChild(who);
      var edit = el('button', 'mbx-profile__edit', 'Edit');
      edit.type = 'button';
      edit.setAttribute('aria-label', 'Edit profile');
      edit.addEventListener('click', function () { showForm(); });
      head.appendChild(edit);
      view.appendChild(head);

      view.appendChild(el('p', 'mbx-profile__line', budgetLine(p)));
      view.appendChild(el('p', 'mbx-profile__line', p.work_address ? 'Work: ' + shortAddress(p.work_address) : 'Work: not set'));

      if (p.priorities.length) {
        var tags = el('ul', 'mbx-profile__tags');
        tags.setAttribute('aria-label', 'Priorities');
        p.priorities.forEach(function (k) { tags.appendChild(el('li', 'mbx-profile__tag', LABELS[k])); });
        view.appendChild(tags);
      } else {
        view.appendChild(el('p', 'mbx-profile__line', 'No priorities picked: every dimension counts the same.'));
      }

      if (focusEdit) edit.focus();
    }

    /* expanded: the form */
    function textField(key, label, value, attrs) {
      var field = el('div', 'mbx-profile__field');
      var inputId = id + '-' + key;
      var lab = el('label', 'mbx-profile__label', label);
      lab.htmlFor = inputId;
      if (attrs.optional) {
        lab.appendChild(document.createTextNode(' '));
        lab.appendChild(el('span', 'mbx-profile__opt', '(optional)'));
      }
      var box = el('div', 'mbx-profile__box');
      var input = el('input');
      input.id = inputId;
      input.type = 'text';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.value = value || '';
      if (attrs.placeholder) input.placeholder = attrs.placeholder;
      if (attrs.maxLength) input.maxLength = attrs.maxLength;
      var prefix = null;
      var suffix = null;
      if (attrs.money) {
        input.inputMode = 'decimal';
        prefix = el('span', 'mbx-profile__affix', '$');
        prefix.setAttribute('aria-hidden', 'true');
        box.appendChild(prefix);
      }
      box.appendChild(input);
      if (attrs.money) {
        suffix = el('span', 'mbx-profile__affix', attrs.suffix || '');
        suffix.setAttribute('aria-hidden', 'true');
        suffix.hidden = !attrs.suffix;
        box.appendChild(suffix);
      }
      box.addEventListener('mousedown', function (e) { if (e.target !== input) { e.preventDefault(); input.focus(); } });
      field.appendChild(lab);
      field.appendChild(box);
      var err = el('p', 'mbx-profile__err');
      err.id = inputId + '-err';
      err.hidden = true;
      field.appendChild(err);
      if (attrs.help) {
        var help = el('p', 'mbx-profile__help', attrs.help);
        help.id = inputId + '-help';
        field.appendChild(help);
        input.setAttribute('aria-describedby', help.id);
      }
      function setError(msg) {
        err.textContent = msg || '';
        err.hidden = !msg;
        if (msg) {
          box.setAttribute('data-invalid', 'true');
          input.setAttribute('aria-invalid', 'true');
          input.setAttribute('aria-describedby', (err.id + ' ' + (attrs.help ? inputId + '-help' : '')).trim());
        } else {
          box.removeAttribute('data-invalid');
          input.removeAttribute('aria-invalid');
          if (attrs.help) input.setAttribute('aria-describedby', inputId + '-help');
          else input.removeAttribute('aria-describedby');
        }
      }
      input.addEventListener('input', function () { if (!err.hidden) setError(''); });
      return { field: field, input: input, label: lab, suffix: suffix, setError: setError };
    }

    function showForm() {
      setCollapsed(false);
      clearView();
      var p = current;
      var draft = {
        mode: p.budget.mode,
        text: { rent: plainMoney(p.budget.max_rent_week), buy: plainMoney(p.budget.max_price) },
        priorities: p.priorities.slice()
      };

      var form = el('form', 'mbx-profile__form');
      form.noValidate = true;
      form.setAttribute('aria-label', 'Edit profile');

      var head = el('div', 'mbx-profile__head');
      head.appendChild(el('span', 'mbx-profile__kicker', 'Your profile'));
      form.appendChild(head);

      var rowWho = el('div', 'mbx-profile__row mbx-profile__row--who');
      var fName = textField('name', 'Name', p.name, { optional: true, maxLength: 40 });
      var fAbout = textField('about', 'About', p.about, { optional: true, maxLength: 60, placeholder: 'e.g. 19 · casual retail' });
      rowWho.appendChild(fName.field);
      rowWho.appendChild(fAbout.field);
      form.appendChild(rowWho);

      // Rent / Buy: one toggle that swaps the one budget input
      var modeField = el('div', 'mbx-profile__field');
      var modeLabel = el('span', 'mbx-profile__label', 'Renting or buying');
      modeLabel.id = id + '-mode';
      var seg = el('div', 'mbx-profile__seg');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-labelledby', modeLabel.id);
      var segBtns = {};
      [['rent', 'Rent'], ['buy', 'Buy']].forEach(function (m) {
        var b = el('button', null, m[1]);
        b.type = 'button';
        b.setAttribute('data-mode', m[0]);
        b.addEventListener('click', function () { setMode(m[0]); });
        segBtns[m[0]] = b;
        seg.appendChild(b);
      });
      modeField.appendChild(modeLabel);
      modeField.appendChild(seg);
      form.appendChild(modeField);

      var rowMoney = el('div', 'mbx-profile__row');
      var fBudget = textField('budget', 'Max rent per week', draft.text[draft.mode], { money: true, suffix: '/wk' });
      var fIncome = textField('income', 'Weekly income', plainMoney(p.income_week), { money: true, suffix: '/wk', placeholder: '600' });
      rowMoney.appendChild(fBudget.field);
      rowMoney.appendChild(fIncome.field);
      form.appendChild(rowMoney);

      var fWork = textField('work', 'Work address', p.work_address, {
        maxLength: 160,
        placeholder: 'e.g. 188 Pitt Street, Sydney',
        help: 'Sent to our server only to locate your workplace.'
      });
      form.appendChild(fWork.field);

      function setMode(mode) {
        if (mode !== draft.mode) {
          draft.text[draft.mode] = fBudget.input.value;
          draft.mode = mode;
          fBudget.input.value = draft.text[mode] || '';
          fBudget.setError('');
        }
        fBudget.label.textContent = mode === 'buy' ? 'Max price' : 'Max rent per week';
        fBudget.input.placeholder = mode === 'buy' ? 'e.g. 900k or 1.2m' : '250';
        fBudget.suffix.textContent = mode === 'buy' ? '' : '/wk';
        fBudget.suffix.hidden = mode === 'buy';
        Object.keys(segBtns).forEach(function (k) { segBtns[k].setAttribute('aria-pressed', k === mode ? 'true' : 'false'); });
        form.setAttribute('data-mode', mode);
      }

      // Select up to three priorities from the factors used by the panel.
      var prio = el('fieldset', 'mbx-profile__field');
      var legend = el('legend', 'mbx-profile__label', 'Priorities');
      prio.appendChild(legend);
      var chipList = el('div', 'mbx-profile__chips');
      var chips = PRIORITIES.map(function (pr) {
        var b = el('button', 'mbx-profile__chip', pr.label);
        b.type = 'button';
        b.setAttribute('data-key', pr.key);
        b.addEventListener('click', function () { togglePriority(pr.key); });
        chipList.appendChild(b);
        return b;
      });
      prio.appendChild(chipList);
      var hint = el('p', 'mbx-profile__hint');
      hint.id = id + '-prio-hint';
      hint.setAttribute('aria-live', 'polite');
      prio.appendChild(hint);
      prio.setAttribute('aria-describedby', hint.id);
      form.appendChild(prio);

      function togglePriority(key) {
        var on = draft.priorities.indexOf(key) >= 0;
        if (!on && draft.priorities.length >= MAX_PRIORITIES) return;
        var next = on
          ? draft.priorities.filter(function (k) { return k !== key; })
          : draft.priorities.concat([key]);
        // keep the canonical order so the summary reads the same however they were tapped
        draft.priorities = PRIORITIES.map(function (x) { return x.key; }).filter(function (k) { return next.indexOf(k) >= 0; });
        syncChips();
      }

      function syncChips() {
        var full = draft.priorities.length >= MAX_PRIORITIES;
        chips.forEach(function (b) {
          var on = draft.priorities.indexOf(b.getAttribute('data-key')) >= 0;
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
          b.disabled = full && !on;
          if (b.disabled) b.title = 'Pick up to 3'; else b.removeAttribute('title');
        });
        hint.setAttribute('data-full', full ? 'true' : 'false');
        hint.textContent = full
          ? 'Pick up to 3. Turn one off to pick another.'
          : 'Pick up to 3. Picked ones count double in the score.';
      }

      var actions = el('div', 'mbx-profile__actions');
      var saveBtn = el('button', 'mbx-profile__save', 'Save');
      saveBtn.type = 'submit';
      var cancelBtn = el('button', 'mbx-profile__cancel', 'Cancel');
      cancelBtn.type = 'button';
      cancelBtn.addEventListener('click', function () { showSummary(true); });
      actions.appendChild(saveBtn);
      actions.appendChild(cancelBtn);
      actions.appendChild(el('span', 'mbx-profile__privacy', 'Saved in this browser only.'));
      form.appendChild(actions);

      function readMoney(f) {
        var n = parseMoney(f.input.value);
        if (n === null) return { ok: true, value: null };
        if (typeof n !== 'number' || !isFinite(n) || n <= 0 || n > 1e10) {
          f.setError('Try 250, $250, 900k or 1.2m.');
          return { ok: false };
        }
        f.setError('');
        return { ok: true, value: Math.round(n) };
      }

      var saving = false;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (saving) return;
        var budget = readMoney(fBudget);
        var income = readMoney(fIncome);
        if (!budget.ok || !income.ok) {
          (budget.ok ? fIncome : fBudget).input.focus();
          return;
        }
        draft.text[draft.mode] = fBudget.input.value;
        var other = draft.mode === 'rent' ? 'buy' : 'rent';
        var otherValue = cleanMoney(draft.text[other]);
        var next = {
          version: 1,
          name: fName.input.value,
          about: fAbout.input.value,
          budget: {
            mode: draft.mode,
            max_rent_week: draft.mode === 'rent' ? budget.value : otherValue,
            max_price: draft.mode === 'buy' ? budget.value : otherValue
          },
          income_week: income.value,
          work_address: fWork.input.value,
          priorities: draft.priorities.slice()
        };
        saving = true;
        saveBtn.disabled = true;
        save(next).then(function (stored) {
          current = stored;
          if (typeof opts.onSave === 'function') {
            try { opts.onSave(normalize(stored)); } catch (err) { console.warn('[MBX] profile onSave handler failed', err); }
          }
          if (root.isConnected || root.parentNode) showSummary(true);
        });
      });

      // Esc cancels the edit only (stops here so the panel does not also collapse)
      form.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          showSummary(true);
        }
      });

      setMode(draft.mode);
      syncChips();
      view.appendChild(form);
      fName.input.focus();
    }

    showSummary(false);

    return {
      el: root,
      update: function (profile) {
        current = normalize(profile);
        if (collapsed) showSummary(false); // never clobber an edit in progress
      },
      destroy: function () {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  MBX.profile = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT: DEFAULT,
    PRIORITIES: PRIORITIES,
    MAX_PRIORITIES: MAX_PRIORITIES,
    load: load,
    save: save,
    render: render,
    summary: summary,
    css: CSS,
    // helpers (pure), handy for score.js and tests
    normalize: normalize,
    parseMoney: parseMoney,
    formatMoney: money
  };

  if (typeof module !== 'undefined' && module && module.exports) module.exports = MBX.profile;
})(globalThis.MBX);
