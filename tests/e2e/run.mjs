#!/usr/bin/env node
// End-to-end harness: the REAL unpacked extension in Playwright's bundled Chromium (headed by
// default) on 3 rental + 3 sale City of Sydney listings (tests/e2e/listings.json), against our
// own proxy on 127.0.0.1:8787. Writes tests/findings.md and screenshots to tools/shots/
// (gitignored). Exit 1 on FAIL.
//
//   node tests/e2e/run.mjs [--headless] [--limit N] [--only rent|sale] [--live-first]
//
// Proxy: live if proxy/.env (or the repo-root .env) sets MICROBURBS_API_KEY, else MOCK=1. The key
// is never read into this process, printed or logged: the proxy loads its own .env.
// Listing pages: realestate.com.au (Kasada) and domain.com.au (Akamai) block automated Chromium
// and we do not try to get round that. By default each listing's REAL archived markup (Wayback
// Machine, raw "id_" snapshot) is served at the real listing URL via page.route, in memory only,
// so the content script injects on the real URL and reads real markup. Page scripts are blocked.
// --live-first tries the live page once per listing (no bypass) and falls back to the archive.
// The page h1 is read here as the "page address" for the mismatch check: dev tooling only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const EXT = path.join(ROOT, 'extension');
const SHOTS = path.join(ROOT, 'tools', 'shots');
const FINDINGS = path.join(ROOT, 'tests', 'findings.md');
const PORT = 8787;
const PROXY = 'http://127.0.0.1:' + PORT;
const { chromium } = createRequire(path.join(ROOT, 'tools', 'package.json'))('playwright');

// ---------------- args
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const headless = flag('--headless');
const liveFirst = flag('--live-first');
const only = opt('--only');
const limit = opt('--limit') ? Math.max(1, Number(opt('--limit')) || 1) : Infinity;
if (only && only !== 'rent' && only !== 'sale') {
  console.error('--only takes rent or sale');
  process.exit(2);
}

// ---------------- profiles (contract: chrome.storage.local "mbx.profile.v1")
const PROFILE_KEY = 'mbx.profile.v1';
const SARAH = {
  version: 1,
  name: 'Sarah',
  about: '19 · casual retail',
  budget: { mode: 'rent', max_rent_week: 250, max_price: null },
  income_week: 600,
  work_address: '188 Pitt Street, Sydney NSW 2000',
  priorities: ['cheap', 'close_to_work', 'safe'],
};
const BUYER = {
  ...SARAH,
  about: 'buyer test profile',
  budget: { mode: 'buy', max_rent_week: null, max_price: 1200000 },
  income_week: 2500,
};
const profileFor = (kind) => (kind === 'sale' ? BUYER : SARAH);
const DIMS = ['affordability', 'commute', 'safety', 'liveliness', 'quiet', 'negotiability'];
const FOOTER = 'Microburbs estimates, not advice';

// ---------------- listings
const ALL = JSON.parse(fs.readFileSync(path.join(HERE, 'listings.json'), 'utf8'));
const LISTINGS = ALL.filter((l) => !only || l.kind === only).slice(0, limit);
const count = { rent: 0, sale: 0 };
for (const l of LISTINGS) l.n = ++count[l.kind];

// ---------------- proxy lifecycle (port 8787)
function keyConfigured() {
  // Only tests whether a non-placeholder key line exists. The value is never kept or printed.
  for (const f of [path.join(ROOT, 'proxy', '.env'), path.join(ROOT, '.env')]) {
    let text = '';
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const ok = text.split(/\r?\n/).some((line) => {
      const m = /^\s*(?:export\s+)?MICROBURBS_API_KEY\s*=\s*["']?([^"'\s#]*)/.exec(line);
      return !!(m && m[1] && m[1] !== 'paste-your-team-key-here');
    });
    text = '';
    if (ok) return true;
  }
  return false;
}
let proxy = null;
const proxyLog = [];
async function health() {
  try {
    const r = await fetch(PROXY + '/health', { signal: AbortSignal.timeout(1500) });
    return await r.json();
  } catch {
    return null;
  }
}
async function startProxy(wantLive) {
  if (await health()) throw new Error('something is already listening on ' + PORT + '; stop it first');
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' };
  if (wantLive) delete env.MOCK;
  else env.MOCK = '1';
  proxy = spawn(process.execPath, ['src/server.js'], { cwd: path.join(ROOT, 'proxy'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  const keep = (d) => {
    const s = String(d).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
    proxyLog.push(s);
    if (proxyLog.length > 200) proxyLog.shift();
    process.stderr.write('[proxy] ' + s);
  };
  proxy.stdout.on('data', keep);
  proxy.stderr.on('data', keep);
  for (let i = 0; i < 80; i++) {
    const h = await health();
    if (h) return h;
    if (proxy.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('proxy did not start on ' + PORT);
}
async function stopProxy() {
  if (!proxy) return;
  const p = proxy;
  proxy = null;
  if (p.exitCode !== null) return;
  await new Promise((r) => {
    const t = setTimeout(() => {
      try {
        p.kill('SIGKILL');
      } catch {}
      r();
    }, 3000);
    p.once('exit', () => {
      clearTimeout(t);
      r();
    });
    p.kill('SIGTERM');
  });
}

// ---------------- archive replay (in memory only, never written to disk)
const REAL = /^https:\/\/www\.(domain|realestate)\.com\.au\//;
const bare = (u) => u.split('#')[0].split('?')[0].replace(/\/$/, '');
const memo = new Map();
let liveFor = null; // bare URL of the listing currently being tried live (--live-first)
const tsFor = (url) => {
  const hit = LISTINGS.find((l) => bare(url) === bare(l.url));
  return hit ? hit.wayback : /realestate/.test(url) ? '2025' : '2026';
};
// Archived listing documents are also cached in os.tmpdir() (never the repo) so re-runs do not
// depend on the Wayback Machine answering again (it rate-limits bursts with connection errors).
const CACHE = path.join(os.tmpdir(), 'mbx-e2e-archive');
const cacheFile = (url, mode) => path.join(CACHE, (tsFor(url) + mode + '_' + url).replace(/[^a-z0-9]+/gi, '_').slice(0, 200) + '.html');
function archived(url, mode) {
  const key = mode + ' ' + url;
  if (!memo.has(key)) {
    const p = (async () => {
      const doc = mode === 'id_';
      if (doc) {
        try {
          const body = fs.readFileSync(cacheFile(url, mode));
          if (body.length > 20000) return { status: 200, type: 'text/html; charset=utf-8', body, cached: true };
        } catch {}
      }
      let last = null;
      const tries = doc ? 5 : 2;
      for (let i = 0; i < tries; i++) {
        try {
          const r = await fetch('https://web.archive.org/web/' + tsFor(url) + mode + '/' + url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
          if (r.status === 429 || r.status >= 500) throw new Error('archive HTTP ' + r.status);
          const out = { status: r.status, type: r.headers.get('content-type') || 'application/octet-stream', body: Buffer.from(await r.arrayBuffer()) };
          if (doc && out.status === 200 && out.body.length > 20000) {
            try {
              fs.mkdirSync(CACHE, { recursive: true });
              fs.writeFileSync(cacheFile(url, mode), out.body);
            } catch {}
          }
          return out;
        } catch (e) {
          last = e;
          if (i < tries - 1) await new Promise((r) => setTimeout(r, 2000 * 2 ** i));
        }
      }
      throw new Error('archive unavailable after ' + tries + ' tries: ' + String((last && last.message) || last));
    })();
    p.catch(() => memo.delete(key));
    memo.set(key, p);
  }
  return memo.get(key);
}

// ---------------- address normalising (independent of the proxy's matcher)
const TYPES = {
  street: 'st', st: 'st', road: 'rd', rd: 'rd', avenue: 'ave', ave: 'ave', av: 'ave', lane: 'ln', ln: 'ln',
  place: 'pl', pl: 'pl', terrace: 'tce', tce: 'tce', crescent: 'cres', cres: 'cres', drive: 'dr', dr: 'dr',
  parade: 'pde', pde: 'pde', highway: 'hwy', hwy: 'hwy', boulevard: 'bvd', boulevarde: 'bvd', bvd: 'bvd',
  close: 'cl', cl: 'cl', court: 'ct', ct: 'ct', square: 'sq', sq: 'sq', circuit: 'cct', cct: 'cct',
  grove: 'gr', gr: 'gr', esplanade: 'esp', esp: 'esp', way: 'way', row: 'row', walk: 'walk', mews: 'mews',
};
const UNIT_WORD = /^(unit|apartment|apt|flat|suite|lot|u|shop|villa|townhouse)\s*/;
function parseAddr(s) {
  const raw = String(s || '')
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
  let unit = null;
  if (parts.length > 1 && /^(unit|apartment|apt|flat|suite|lot|u|shop|level)\s*[a-z0-9.-]+$/.test(parts[0])) unit = parts.shift().replace(UNIT_WORD, '');
  let first = (parts.shift() || '').replace(UNIT_WORD, '');
  let number = null;
  let m = /^([a-z]?[0-9][0-9a-z.]*)\s*\/\s*([0-9]+[a-z]?(?:\s*-\s*[0-9]+[a-z]?)?)\s+(.+)$/.exec(first);
  if (m) {
    unit = m[1];
    number = m[2].replace(/\s+/g, '');
    first = m[3];
  } else if ((m = /^([0-9]+[a-z]?(?:\s*-\s*[0-9]+[a-z]?)?)\s+(.+)$/.exec(first))) {
    number = m[1].replace(/\s+/g, '');
    first = m[2];
  }
  let words = first.replace(/[.]/g, '').split(' ').filter(Boolean);
  let rest = parts.join(' ');
  if (!parts.length) {
    // no commas ("110/11 WIGRAM LANE GLEBE NSW 2037"): split after the first street-type word
    const at = words.findIndex((w, i) => i > 0 && TYPES[w]);
    if (at > 0 && at < words.length - 1) {
      rest = words.slice(at + 1).join(' ');
      words = words.slice(0, at + 1);
    }
  }
  if (words.length > 1 && TYPES[words[words.length - 1]]) words[words.length - 1] = TYPES[words[words.length - 1]];
  // suburb: drop state, postcode and country wherever the site put them
  rest = rest.replace(/\b(nsw|new south wales|australia)\b/g, ' ').replace(/\b[0-9]{4}\b/g, ' ').replace(/\s+/g, ' ').trim();
  return { unit: unit ? unit.replace(/^0+(?=\d)/, '') : null, number, street: words.join(' ') || null, suburb: rest || null };
}
function compareAddr(pageAddr, matched) {
  const a = parseAddr(pageAddr);
  const b = parseAddr(matched);
  const diffs = [];
  if (a.unit && !b.unit) diffs.push('unit ' + a.unit + ' on the page, none in the match');
  else if (!a.unit && b.unit) diffs.push('match has unit ' + b.unit + ', page shows none');
  else if (a.unit && b.unit && a.unit !== b.unit) diffs.push('unit ' + a.unit + ' vs ' + b.unit);
  const notes = [];
  if (a.number !== b.number) {
    // "349-355" on the page vs "349" in G-NAF is the same building: a note, not a mismatch
    const n = (x) => parseInt(String(x), 10);
    const [lo, hi] = String(a.number || '').split('-');
    const inRange = !!(a.number && b.number && hi && n(b.number) >= n(lo) && n(b.number) <= n(hi));
    if (inRange) notes.push('number range ' + a.number + ' matched as ' + b.number);
    else diffs.push('number ' + (a.number || '(none)') + ' vs ' + (b.number || '(none)'));
  }
  if (a.street !== b.street) diffs.push('street "' + (a.street || '') + '" vs "' + (b.street || '') + '"');
  if (a.suburb && b.suburb && a.suburb !== b.suburb) diffs.push('suburb ' + a.suburb + ' vs ' + b.suburb);
  else if (a.suburb && !b.suburb) diffs.push('no suburb in the matched name');
  return { page: a, matched: b, diffs, notes };
}

// ---------------- panel reading (open shadow root of #mbx-root)
async function readPanel(page) {
  return page.evaluate(() => {
    const NI = 'n/a (not integrated)';
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
    const roots = document.querySelectorAll('#mbx-root');
    const host = roots[0] || null;
    const sr = host && host.shadowRoot;
    const q = (sel) => (sr ? sr.querySelector(sel) : null);
    const body = q('.mbx-body');
    const meter = q('.mbx-meter');
    const nameEl = q('[data-bind="display_name"]');
    const oldName = nameEl ? null : q('.home'); // old panel's matched-home line
    const checkEl = q('[data-bind="check"]');
    const attr = (el, a) => (el && el.hasAttribute(a) ? el.getAttribute(a) : null);
    const items = sr
      ? [...sr.querySelectorAll('li.mbx-halos__item')].map((li) => ({ dim: li.getAttribute('data-dim'), kind: li.getAttribute('data-kind'), text: txt(li).slice(0, 160) }))
      : [];
    const blankEls = sr ? [...sr.querySelectorAll('[data-kind="blank"], .mbx-halos__blank li, li[data-blank]')] : [];
    const h1 = document.querySelector('h1');
    const prof = q('.mbx-profile');
    // Layout: anything drawn outside the panel's box, or text cut short inside it.
    const panelEl = q('.panel');
    const scroller = q('.body');
    const pr = panelEl ? panelEl.getBoundingClientRect() : null;
    const outside = [];
    const truncated = [];
    if (sr && pr) {
      for (const el of sr.querySelectorAll('*')) {
        if (el.closest('[hidden]')) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || (r.width <= 1 && r.height <= 1)) continue; // skip empty and 1px screen-reader-only nodes
        const name = el.tagName.toLowerCase() + (el.getAttribute('class') ? '.' + el.getAttribute('class').trim().split(/\s+/)[0] : '');
        if (r.right > pr.right + 0.5 || r.left < pr.left - 0.5) outside.push(name + ' x ' + Math.round(r.left) + '-' + Math.round(r.right) + ' (panel ' + Math.round(pr.left) + '-' + Math.round(pr.right) + ')');
        else if (el !== scroller && !(el instanceof SVGElement) && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') truncated.push(name + ' "' + txt(el).slice(0, 40) + '"');
      }
    }
    const shellFoot = q('.foot');
    return {
      roots: roots.length,
      state: attr(host, 'data-mbx-state'),
      query: attr(host, 'data-mbx-query'),
      source: attr(host, 'data-mbx-source'),
      newPanel: !!body,
      matched: nameEl ? txt(nameEl) : oldName ? txt(oldName) : null,
      matchedFrom: nameEl ? 'panel' : oldName ? 'old panel .home' : null,
      check: checkEl ? txt(checkEl) : NI,
      checkClass: checkEl ? ([...checkEl.classList].find((c) => /^mbx-addr__check--/.test(c)) || '').replace('mbx-addr__check--', '') || null : null,
      bodyTotal: body ? attr(body, 'data-total') : NI,
      bodyBand: body ? attr(body, 'data-band') : NI,
      bodyBlank: body ? attr(body, 'data-blank') : NI,
      bodyCheck: body ? attr(body, 'data-check') : NI,
      meterTotal: meter ? attr(meter, 'data-total') : NI,
      meterBand: meter ? attr(meter, 'data-band') : NI,
      verdict: q('[data-slot="verdict"]') ? txt(q('[data-slot="verdict"]')) : NI,
      items: body ? items : NI,
      blankItems: blankEls.map((el) => ({ dim: el.getAttribute('data-dim') || el.getAttribute('data-blank'), text: txt(el).slice(0, 200) })),
      profileCollapsed: prof ? attr(prof, 'data-collapsed') : NI,
      profileText: prof ? (prof.innerText || prof.textContent).replace(/\s*\n+\s*/g, ' | ').replace(/\s+/g, ' ').trim().slice(0, 240) : NI,
      heads: sr ? [...sr.querySelectorAll('.mbx-halos__head')].map((e) => txt(e)) : [],
      blankNote: q('.mbx-halos__blank') ? txt(q('.mbx-halos__blank')).slice(0, 300) : null,
      footer: q('.mbx-foot__main') ? txt(q('.mbx-foot__main')) : null,
      footerSmall: q('.mbx-foot__small') ? txt(q('.mbx-foot__small')) : null,
      shellFootShown: shellFoot ? !shellFoot.hidden : null,
      badge: q('.badge') && !q('.badge').closest('[hidden]') ? txt(q('.badge')) : null,
      scrollH: scroller ? scroller.scrollHeight : null,
      clientH: scroller ? scroller.clientHeight : null,
      outside,
      truncated,
      oldLabels: sr ? [...sr.querySelectorAll('h3.label')].map((e) => txt(e)) : [],
      h1: h1 ? txt(h1).slice(0, 200) : null,
      title: document.title.slice(0, 200),
    };
  });
}
const SETTLED = (s) => !!s && s !== 'detecting' && s !== 'loading';
async function waitSettled(page, ms) {
  await page
    .waitForFunction(
      () => {
        const r = document.querySelectorAll('#mbx-root');
        const s = r.length === 1 ? r[0].getAttribute('data-mbx-state') : null;
        return !!s && s !== 'detecting' && s !== 'loading';
      },
      null,
      { timeout: ms, polling: 200 }
    )
    .catch(() => {});
  // The new panel may fill the score after the state flips: give it time to set data-total.
  await page
    .waitForFunction(
      () => {
        const sr = document.getElementById('mbx-root') && document.getElementById('mbx-root').shadowRoot;
        const b = sr && sr.querySelector('.mbx-body');
        if (!b) return true; // old panel: nothing more to wait for
        const m = sr.querySelector('.mbx-meter');
        return b.hasAttribute('data-total') || (m && m.hasAttribute('data-total'));
      },
      null,
      { timeout: 15000, polling: 250 }
    )
    .catch(() => {});
  await page.waitForTimeout(1600); // needle animation
}
// The panel is fixed (max-height 100vh - 104px) and its body scrolls, so the 1440x900 shot stops
// part-way down. Two extra shots per listing: the panel scrolled to its bottom at 1440x900 (what a
// user sees after scrolling), and the whole panel unscrolled on a viewport just tall enough to fit it.
async function panelShots(page, l) {
  const out = { bottom: null, full: null, footerReachable: null, note: null };
  const geo = await page.evaluate(() => {
    const sr = document.getElementById('mbx-root') && document.getElementById('mbx-root').shadowRoot;
    const panel = sr && sr.querySelector('.panel');
    const body = sr && sr.querySelector('.body');
    if (!panel || !body || panel.hidden || !panel.getBoundingClientRect().height) return null;
    const head = sr.querySelector('.head');
    const foot = sr.querySelector('.foot');
    return { scrollH: body.scrollHeight, clientH: body.clientHeight, chrome: (head ? head.offsetHeight : 0) + (foot && !foot.hidden ? foot.offsetHeight : 0) + 2 };
  });
  if (!geo) {
    out.note = 'no open panel to capture';
    return out;
  }
  const base = path.join(SHOTS, 'e2e-' + l.kind + '-' + l.n);
  const scrollTo = (where) =>
    page.evaluate((w) => {
      const sr = document.getElementById('mbx-root').shadowRoot;
      const body = sr.querySelector('.body');
      window.scrollTo(0, 0);
      body.scrollTop = w === 'bottom' ? body.scrollHeight : 0;
      const f = sr.querySelector('.mbx-foot') || sr.querySelector('.foot:not([hidden])');
      if (!f) return null;
      const a = f.getBoundingClientRect();
      const b = body.contains(f) ? body.getBoundingClientRect() : sr.querySelector('.panel').getBoundingClientRect();
      return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
    }, where);
  try {
    out.footerReachable = await scrollTo('bottom');
    await page.waitForTimeout(250);
    out.bottom = base + '-bottom.png';
    await page.screenshot({ path: out.bottom });
  } finally {
    await scrollTo('top').catch(() => {});
  }
  const vp = page.viewportSize();
  const need = Math.ceil(geo.scrollH + geo.chrome + 104 + 8);
  try {
    if (need > vp.height) await page.setViewportSize({ width: vp.width, height: need });
    await page.waitForTimeout(300);
    await scrollTo('top').catch(() => {});
    out.tall = base + '-tall.png'; // the whole panel beside the listing
    await page.screenshot({ path: out.tall });
    const box = await page.evaluate(() => {
      const r = document.getElementById('mbx-root').shadowRoot.querySelector('.panel').getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    const pad = 12;
    out.full = base + '-panel.png';
    await page.screenshot({ path: out.full, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad } });
  } finally {
    if (need > vp.height) await page.setViewportSize(vp);
    await page.waitForTimeout(150);
  }
  return out;
}
function blocked(resp, title, html) {
  const st = resp ? resp.status() : 0;
  if (!resp) return 'no response';
  if (st >= 400) return 'HTTP ' + st + (/access denied/i.test(title) ? ' Access Denied' : '');
  if (/access denied|pardon our interruption|are you a robot|verify you are human/i.test(title)) return 'challenge page: ' + title.slice(0, 60);
  if (/KPSDK|_Incapsula_|akamai-bot|bm-verify|sec-if-cpt|_sec\/cp_challenge/i.test(html || '')) return 'bot challenge markup';
  return null;
}

// ---------------- service worker: set the profile
async function extensionWorker(ctx) {
  const isExt = (w) => /^chrome-extension:\/\//.test(w.url());
  let sw = ctx.serviceWorkers().find(isExt);
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { predicate: isExt, timeout: 15000 }).catch(() => null);
  return sw;
}
async function setProfile(ctx, profile) {
  const run = (p) => {
    // runs inside the extension: service worker or an extension page
    if (!globalThis.chrome || !chrome.storage || !chrome.storage.local) return { ok: false, why: 'chrome.storage.local is unavailable (manifest has no "storage" permission?)' };
    return chrome.storage.local
      // "mbx.dev": the panel's shadow root is closed for real users; the harness needs it open to read the DOM.
      .set({ [p.key]: p.value, 'mbx.dev': true })
      .then(() => chrome.storage.local.get(p.key))
      .then((got) => {
        // chrome.storage hands objects back with their keys sorted, so compare key-order-free.
        const canon = (v) => (Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
          : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
          : JSON.stringify(v));
        return canon(got[p.key]) === canon(p.value) ? { ok: true } : { ok: false, why: 'read-back differs' };
      })
      .catch((e) => ({ ok: false, why: String(e && e.message) }));
  };
  const arg = { key: PROFILE_KEY, value: profile };
  let sw = await extensionWorker(ctx);
  if (sw) {
    try {
      return { via: 'service worker', ...(await sw.evaluate(run, arg)) };
    } catch (e) {
      // worker was stopped: wake the extension by opening one of its own pages and use that instead
      const id = (/^chrome-extension:\/\/([^/]+)/.exec(sw.url()) || [])[1];
      if (id) {
        const p = await ctx.newPage();
        try {
          await p.goto('chrome-extension://' + id + '/manifest.json', { timeout: 10000 });
          return { via: 'extension page', ...(await p.evaluate(run, arg)) };
        } catch (e2) {
          return { ok: false, via: 'none', why: String(e2.message || e2).split('\n')[0] };
        } finally {
          await p.close().catch(() => {});
        }
      }
      return { ok: false, via: 'service worker', why: String(e.message || e).split('\n')[0] };
    }
  }
  return { ok: false, via: 'none', why: 'no extension service worker found' };
}

// ---------------- main
fs.mkdirSync(SHOTS, { recursive: true });
const started = new Date();
const wantLive = keyConfigured();
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbx-e2e-'));
let ctx = null;
let mode = wantLive ? 'live' : 'mock';
let healthInfo = null;
const rows = [];
let fatal = null;
const cleanup = async () => {
  if (ctx) await ctx.close().catch(() => {});
  ctx = null;
  await stopProxy();
  fs.rmSync(userDataDir, { recursive: true, force: true });
};
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => cleanup().finally(() => process.exit(130)));

try {
  // warm the archive cache while the proxy and browser start
  const warm = (async () => {
    for (const l of LISTINGS) await archived(l.url, 'id_').catch(() => {}); // one at a time: Wayback dislikes bursts
  })();
  healthInfo = await startProxy(wantLive);
  mode = healthInfo && healthInfo.mode ? healthInfo.mode : mode;
  console.log('proxy up: mode=' + mode);

  ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT],
  });
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    const type = req.resourceType();
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {}
    if (host === 'localhost' || host === '127.0.0.1' || !/^https?:/.test(url)) return route.continue();
    if (liveFor) return route.continue(); // --live-first attempt: the real site, untouched
    if (REAL.test(url) && type === 'document') {
      try {
        const a = await archived(url, 'id_');
        return route.fulfill({ status: a.status, contentType: 'text/html; charset=utf-8', body: a.body });
      } catch (e) {
        return route.fulfill({ status: 502, contentType: 'text/plain', body: 'archive fetch failed: ' + e.message });
      }
    }
    if (type === 'stylesheet' || type === 'font' || type === 'image') {
      if (REAL.test(url)) {
        try {
          const a = await archived(url, type === 'stylesheet' ? 'cs_' : 'im_');
          return route.fulfill({ status: a.status, contentType: a.type, body: a.body });
        } catch {
          return route.abort();
        }
      }
      return route.continue();
    }
    return route.abort(); // page scripts, XHR, trackers: not needed to show the markup
  });
  await warm;
  const page = ctx.pages()[0] || (await ctx.newPage());

  for (const l of LISTINGS) {
    const row = { ...l, sourceUsed: null, liveNote: null, error: null, shot: null };
    const t0 = Date.now();
    try {
      row.profile = await setProfile(ctx, profileFor(l.kind));
      let usedLive = false;
      if (liveFirst) {
        liveFor = bare(l.url);
        try {
          const resp = await page.goto(l.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
          const title = await page.title().catch(() => '');
          const html = await page.content().catch(() => '');
          const why = blocked(resp, title, html.slice(0, 20000));
          if (why) row.liveNote = 'live blocked: ' + why;
          else {
            await waitSettled(page, mode === 'live' ? 45000 : 30000);
            const p = await readPanel(page);
            if (p.state && p.state.startsWith('result:')) {
              usedLive = true;
              row.sourceUsed = 'live';
              row.panel = p;
            } else row.liveNote = 'live page gave no listing (HTTP ' + (resp ? resp.status() : '?') + ', panel ' + (p.state || 'absent') + ', title "' + (title || '').slice(0, 50) + '")';
          }
        } catch (e) {
          row.liveNote = 'live failed: ' + String(e.message || e).split('\n')[0].slice(0, 120);
        } finally {
          liveFor = null;
        }
        if (row.liveNote) console.log('  ' + row.liveNote + ' -> archived replay');
      }
      if (!usedLive) {
        await page.goto('about:blank');
        const resp = await page.goto(l.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        row.http = resp ? resp.status() : null;
        row.sourceUsed = 'archived:' + l.wayback;
        if (row.http === 502) {
          const why = await page.evaluate(() => document.body.innerText.slice(0, 160)).catch(() => '');
          row.error = 'archive replay failed (test infrastructure, not the extension): ' + why;
        }
        await waitSettled(page, mode === 'live' ? 45000 : 30000);
        row.panel = await readPanel(page);
      }
      row.shot = path.join(SHOTS, 'e2e-' + l.kind + '-' + l.n + '.png');
      // The window is headed, so a stray wheel/trackpad gesture over it can scroll the page or the
      // panel mid-run. Record any offset (so a scroll the extension caused would still show up in
      // findings.md), then shoot the page as first loaded: page at the top, panel body at the top.
      row.scrollReset = await page
        .evaluate(() => {
          const sr = document.getElementById('mbx-root') && document.getElementById('mbx-root').shadowRoot;
          const body = sr && sr.querySelector('.body');
          const was = { page: Math.round(window.scrollY), panel: body ? Math.round(body.scrollTop) : 0 };
          window.scrollTo(0, 0);
          if (body) body.scrollTop = 0;
          return was;
        })
        .catch(() => null);
      await page.waitForTimeout(150);
      await page.screenshot({ path: row.shot });
      try {
        row.extra = await panelShots(page, l);
      } catch (e) {
        row.extra = { note: 'panel shots failed: ' + String(e.message || e).split('\n')[0].slice(0, 120) };
      }
      // cross-check: what the proxy itself matched for the panel's query (same /lookup the extension uses)
      if (row.panel && row.panel.query) {
        try {
          const r = await fetch(PROXY + '/lookup?address=' + encodeURIComponent(row.panel.query), { signal: AbortSignal.timeout(30000) });
          const b = await r.json();
          row.proxy = { status: b.status, display_name: b.match ? b.match.display_name : null, verdict: b.match && b.match.check ? b.match.check.verdict : null, notes: b.match && b.match.check ? b.match.check.notes || [] : [] };
        } catch (e) {
          row.proxy = { error: String(e.message || e).split('\n')[0] };
        }
      }
    } catch (e) {
      row.error = String(e.message || e).split('\n')[0].slice(0, 200);
    }
    row.ms = Date.now() - t0;
    const p = row.panel || {};
    console.log(
      [l.kind + '-' + l.n, l.site, l.suburb, row.sourceUsed, 'state=' + p.state, 'query=' + JSON.stringify(p.query), 'matched=' + JSON.stringify(p.matched), 'total=' + p.meterTotal, row.error ? 'ERROR ' + row.error : ''].join(' | ')
    );
    rows.push(row);
  }
} catch (e) {
  fatal = String(e.message || e).split('\n')[0];
  console.error('FATAL ' + fatal);
} finally {
  await cleanup();
}

// ---------------- verdicts
const isNI = (v) => v === 'n/a (not integrated)';
const totalOf = (p) => {
  if (!p) return null;
  const v = !isNI(p.meterTotal) && p.meterTotal != null ? p.meterTotal : !isNI(p.bodyTotal) && p.bodyTotal != null ? p.bodyTotal : null;
  return v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
};
const bandOf = (p) => (p ? (!isNI(p.meterBand) && p.meterBand ? p.meterBand : !isNI(p.bodyBand) && p.bodyBand ? p.bodyBand : null) : null);
function blankList(p) {
  if (!p || isNI(p.bodyBlank)) return null; // not integrated
  if (p.bodyBlank == null || p.bodyBlank === '') return [];
  try {
    const v = JSON.parse(p.bodyBlank);
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : x && (x.dim || x.key) ? x.dim || x.key : JSON.stringify(x)));
  } catch {}
  return p.bodyBlank.split(/[\s,]+/).filter(Boolean);
}
for (const r of rows) {
  const p = r.panel || {};
  r.total = totalOf(p);
  r.band = bandOf(p);
  r.blank = blankList(p);
  r.cmp = p.h1 && p.matched ? compareAddr(p.h1, p.matched) : null;
  r.plumbing = !r.error && p.roots === 1 && !!p.state && !!p.query && !!r.shot && fs.existsSync(r.shot);
  r.ok = p.state === 'result:ok' && r.total != null;
}
const mismatches = rows.filter((r) => r.cmp && r.cmp.diffs.length);
const failReasons = [];
if (fatal) failReasons.push('run aborted: ' + fatal);
if (!rows.length && !fatal) failReasons.push('no listings selected');
for (const r of rows) {
  const p = r.panel || {};
  if (r.error) failReasons.push(r.kind + '-' + r.n + ': ' + r.error);
  else if (p.state !== 'result:ok') failReasons.push(r.kind + '-' + r.n + ': state ' + p.state + ' (want result:ok)');
  else if (r.total == null) failReasons.push(r.kind + '-' + r.n + ': no meter total' + (p.newPanel ? '' : ' (new panel not integrated)'));
  if (!r.error && p.state === 'result:ok' && p.newPanel) {
    if (p.footer !== FOOTER) failReasons.push(r.kind + '-' + r.n + ': footer ' + (p.footer ? '"' + p.footer + '"' : 'missing') + ' (want "' + FOOTER + '")');
    if (p.profileCollapsed !== 'true') failReasons.push(r.kind + '-' + r.n + ': profile not collapsed on first render (data-collapsed=' + p.profileCollapsed + ')');
    if (r.extra && r.extra.footerReachable === false) failReasons.push(r.kind + '-' + r.n + ': the footer cannot be scrolled into view');
  }
}
if (mode === 'live') for (const r of mismatches) failReasons.push(r.kind + '-' + r.n + ': address mismatch (' + r.cmp.diffs.join('; ') + ')');
const pass = failReasons.length === 0;

// ---------------- findings.md
const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const rel = (p) => (p ? path.relative(ROOT, p) : '');
const aedt = (d) => d.toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour12: false });
const ended = new Date();
const integrated = rows.some((r) => r.panel && r.panel.newPanel);
const L = [];
L.push('# E2E findings');
L.push('');
L.push('Written by `node tests/e2e/run.mjs' + (argv.length ? ' ' + argv.join(' ') : '') + '`. Re-running overwrites this file.');
L.push('');
L.push('- Run: ' + aedt(started) + ' (Australia/Sydney), ' + Math.round((ended - started) / 1000) + ' s, Chromium ' + (headless ? 'headless' : 'headed') + ', fresh temp profile, unpacked `extension/`');
L.push('- Proxy mode: **' + mode + '**' + (mode === 'mock' ? ' (no MICROBURBS_API_KEY in proxy/.env, so MOCK=1; every lookup returns the 26 Tudor Street, Surry Hills fixture)' : ' (proxy/.env key; the key is never read or printed by the harness)') + ', 127.0.0.1:' + PORT);
L.push('- Panel build: ' + (integrated ? 'new panel (`.mbx-body` present)' : 'old panel: the fit-score panel is not integrated yet, so its fields read "n/a (not integrated)"'));
L.push('- Pages: ' + (liveFirst ? 'live page tried once per listing, archived markup on block' : 'archived markup served at the real listing URL') + '. Both sites block automated Chromium (domain: Akamai "Access Denied", realestate: Kasada 429); the harness does not try to get past that.');
L.push('');
L.push('## Profiles used');
L.push('');
L.push('Set through the extension service worker (`chrome.storage.local["' + PROFILE_KEY + '"]`) before each listing.');
L.push('');
L.push('- Rentals: Sarah (the DEFAULT): `' + JSON.stringify(SARAH) + '`');
L.push('- Sales: Sarah\'s priorities, budget buy up to $1,200,000, income $2,500/wk: `' + JSON.stringify(BUYER) + '`');
const profIssues = rows.filter((r) => r.profile && !r.profile.ok);
L.push('- Applied: ' + (rows.length && !profIssues.length ? 'ok for every listing (' + [...new Set(rows.map((r) => r.profile && r.profile.via))].join(', ') + ')' : profIssues.length ? 'FAILED for ' + profIssues.length + '/' + rows.length + ': ' + [...new Set(profIssues.map((r) => r.profile.why))].join('; ') : 'n/a'));
L.push('');
L.push('## Listings');
L.push('');
L.push('| # | kind | site | suburb | source | page address (h1) | panel query | matched address | check verdict | total / band | blank dimensions | screenshot |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const p = r.panel || {};
  const checkCell = isNI(p.check)
    ? 'n/a (not integrated)' + (r.proxy && r.proxy.verdict ? '; proxy: ' + r.proxy.verdict : '')
    : (p.checkClass || (!isNI(p.bodyCheck) && p.bodyCheck) ? (p.checkClass || p.bodyCheck) + ': ' : '') + (p.check || '');
  const matchedCell = p.matched ? p.matched + (p.matchedFrom && p.matchedFrom !== 'panel' ? ' (' + p.matchedFrom + ')' : '') : '(none)';
  const totalCell = r.total != null ? r.total + ' / ' + (r.band || '?') : isNI(p.meterTotal) && isNI(p.bodyTotal) ? 'n/a (not integrated)' : '(none)';
  const blankCell = r.blank == null ? 'n/a (not integrated)' : r.blank.length ? r.blank.join(', ') : 'none';
  L.push(
    '| ' + [r.kind + '-' + r.n, r.kind, r.site, r.suburb, (r.sourceUsed || '(failed)') + (r.liveNote ? ' (' + r.liveNote + ')' : ''), p.h1, p.query, matchedCell, checkCell, totalCell, blankCell, rel(r.shot)].map(esc).join(' | ') + ' |'
  );
}
L.push('');
L.push('Listing URLs: ' + rows.map((r) => '[' + r.kind + '-' + r.n + '](' + r.url + ')').join(', ') + '.');
L.push('');
L.push('## Address mismatches');
L.push('');
L.push('Page address (h1) vs the panel\'s matched name, both normalised (case, punctuation, street type, state, postcode) and compared as unit / number / street / suburb.');
if (mode === 'mock') L.push('Mock mode: the mock geocoder always answers 26 Tudor Street, Surry Hills, so every listing is expected to mismatch here. This only proves the comparison runs; it says nothing about the matcher.');
L.push('');
for (const r of rows) {
  const p = r.panel || {};
  const head = '- ' + r.kind + '-' + r.n + ' (' + r.site + ', ' + r.suburb + '): ';
  if (!r.cmp) L.push(head + 'not compared (' + (!p.h1 ? 'no h1 on the page' : 'no matched name in the panel') + ')');
  else if (!r.cmp.diffs.length) L.push(head + 'match: "' + p.h1 + '" = "' + p.matched + '"' + (r.cmp.notes.length ? ' (' + r.cmp.notes.join('; ') + ')' : ''));
  else L.push(head + '"' + p.h1 + '" vs "' + p.matched + '": ' + r.cmp.diffs.concat(r.cmp.notes).join('; '));
  if (r.proxy && r.proxy.display_name != null && p.matched && r.proxy.display_name !== p.matched) L.push('  - panel shows "' + p.matched + '" but the proxy matched "' + r.proxy.display_name + '"');
  if (r.proxy && r.proxy.notes && r.proxy.notes.length) L.push('  - proxy check (' + r.proxy.verdict + '): ' + r.proxy.notes.join('; '));
}
L.push('');
L.push('## Blank dimensions');
L.push('');
L.push('Dimensions: ' + DIMS.join(', ') + '. Read from `.mbx-body[data-blank]`; reasons from any blank rows the panel renders.');
L.push('');
for (const r of rows) {
  const p = r.panel || {};
  const head = '- ' + r.kind + '-' + r.n + ' (' + r.site + ', ' + r.suburb + '): ';
  if (r.blank == null) L.push(head + 'n/a (not integrated)');
  else if (!r.blank.length) L.push(head + 'none blank');
  else {
    const reasons = (p.blankItems || []).filter((b) => b.text).map((b) => (b.dim ? b.dim + ': ' : '') + b.text);
    if (p.blankNote) reasons.push('panel says: "' + p.blankNote + '"');
    L.push(head + r.blank.join(', ') + (reasons.length ? ' (' + reasons.join('; ') + ')' : ' (the panel exposes no reason)'));
  }
  if (Array.isArray(p.items)) {
    const by = (k) => p.items.filter((i) => i.kind === k).map((i) => i.dim).join(', ') || 'none';
    L.push('  - halos: ' + by('halo') + ' · failos: ' + by('failo') + (p.verdict && !isNI(p.verdict) ? ' · verdict: "' + p.verdict + '"' : ''));
    // A dimension that scored in the middle band is neither a halo nor a failo, and is not blank either:
    // it counts toward the total but the panel shows no row (and no number) for it.
    const shown = new Set(p.items.map((i) => i.dim));
    const hidden = DIMS.filter((d) => !shown.has(d) && !(r.blank || []).includes(d));
    L.push('  - scored but not shown (neither halo nor failo, not blank): ' + (hidden.length ? hidden.join(', ') : 'none'));
  }
}
L.push('');
L.push('## Panel checks');
L.push('');
L.push('Read from the panel\'s shadow root on first render. Four screenshots per listing: `e2e-<kind>-<n>.png` is the listing at 1440x900 with the panel as first shown; `-bottom` is the same view with the panel body scrolled to its end; `-tall` is the listing on a 1440-wide viewport just tall enough for the whole panel; `-panel` is that panel cropped.');
L.push('');
for (const r of rows) {
  const p = r.panel || {};
  const x = r.extra || {};
  const head = '- ' + r.kind + '-' + r.n + ' (' + r.site + ', ' + r.suburb + '): ';
  if (!p.newPanel) {
    L.push(head + 'n/a (new panel not shown)');
    continue;
  }
  L.push(
    head +
      [
        'footer ' + (p.footer ? '"' + p.footer + '"' : 'MISSING') + (p.footerSmall ? ' + "' + p.footerSmall + '"' : ''),
        'shell footer ' + (p.shellFootShown ? 'also shown' : 'hidden'),
        'badge ' + (p.badge ? '"' + p.badge + '"' : 'none'),
        'lists: ' + (p.heads && p.heads.length ? p.heads.join(' / ') : 'none'),
        'profile ' + (p.profileCollapsed === 'true' ? 'collapsed' : p.profileCollapsed === 'false' ? 'EXPANDED' : 'absent') + (p.profileText && !isNI(p.profileText) ? ': "' + p.profileText + '"' : ''),
        'panel body shows ' + p.clientH + ' of ' + p.scrollH + ' px' + (x.footerReachable === true ? ', footer reachable by scrolling' : x.footerReachable === false ? ', FOOTER NOT REACHABLE by scrolling' : ''),
        'drawn outside the panel: ' + (p.outside && p.outside.length ? p.outside.slice(0, 5).join('; ') : 'nothing'),
        'text cut short: ' + (p.truncated && p.truncated.length ? p.truncated.slice(0, 5).join('; ') : 'nothing'),
        'scroll before the first shot: ' + (r.scrollReset && (r.scrollReset.page || r.scrollReset.panel) ? 'page ' + r.scrollReset.page + ' px, panel ' + r.scrollReset.panel + ' px (reset to 0 for the shots)' : 'none'),
      ].join(' · ')
  );
  L.push('  - screenshots: ' + [r.shot, x.bottom, x.tall, x.full].filter(Boolean).map(rel).join(', ') + (x.note ? ' (' + x.note + ')' : ''));
}
L.push('');
L.push('## Result: ' + (pass ? 'PASS' : 'FAIL'));
L.push('');
L.push('PASS = every listing reaches `result:ok` with a meter total, the new panel\'s footer reads "' + FOOTER + '" and can be scrolled into view, and the profile starts collapsed' + (mode === 'live' ? ', and no address mismatch (live mode).' : '. (Address mismatches only fail the run in live mode.)'));
L.push('');
for (const f of failReasons) L.push('- ' + f);
if (profIssues.length) L.push('- Warning (does not fail the run): the profile was not applied for ' + profIssues.length + '/' + rows.length + ' listings, so the score used whatever profile the panel fell back to. ' + profIssues[0].profile.why);
const plumbingOk = rows.filter((r) => r.plumbing).length;
L.push('- Plumbing (one panel, a state, a query, a screenshot): ' + plumbingOk + '/' + rows.length + ' listings' + (rows.length ? '; states: ' + rows.map((r) => (r.panel && r.panel.state) || 'none').join(', ') : ''));
if (!integrated && rows.length) L.push('- Old panel sections seen (dry run): ' + [...new Set(rows.flatMap((r) => (r.panel && r.panel.oldLabels) || []))].join(', '));
L.push('');
// A hand-written "## Visual review" section (appended after a run) survives re-runs, flagged as
// possibly stale, so re-running the harness never silently deletes it.
try {
  const old = fs.readFileSync(FINDINGS, 'utf8');
  const at = old.indexOf('\n## Visual review');
  if (at >= 0) {
    const lines = old.slice(at + 1).replace(/^> Carried over by the harness[^\n]*\n\n?/m, '').replace(/\s+$/, '').split('\n');
    L.push(lines[0], '', '> Carried over by the harness from the previous findings.md. The screenshots and tables above were regenerated at ' + aedt(started) + ': re-check this review against them before relying on it.', ...lines.slice(1), '');
  }
} catch {}
fs.writeFileSync(FINDINGS, L.join('\n'));
console.log('wrote ' + rel(FINDINGS));
console.log('RESULT ' + (pass ? 'PASS' : 'FAIL (' + failReasons.length + ')'));
process.exit(pass ? 0 : 1);
