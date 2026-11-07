#!/usr/bin/env node
// Dev-only end-to-end proof: the REAL unpacked extension + the mock proxy on
// 8787, on REAL listing markup. The live sites block automated Chromium, so
// requests for https://www.domain.com.au/... and https://www.realestate.com.au/...
// are answered (in memory only) with the raw archived HTML of that same URL
// from the Wayback Machine. The content script therefore injects on the real
// listing URL and reads the real page markup. Page scripts are blocked;
// stylesheets/images/fonts load from the archive or their CDNs.
// Nothing is written except screenshots in tools/shots/ (gitignored).
//
//   node tools/proof-replay.mjs [--headless]
// Starts and stops its own mock proxy (MOCK=1 PORT=8787). Exit 1 on any failed check.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EXT = path.join(ROOT, 'extension');
const SHOTS = path.join(HERE, 'shots');
const PROXY = 'http://127.0.0.1:8787';
const headless = process.argv.includes('--headless');
fs.mkdirSync(SHOTS, { recursive: true });

const LISTINGS = [
  { site: 'domain', suburb: 'surry-hills', ts: '2026', url: 'https://www.domain.com.au/1319-20-pelican-street-surry-hills-nsw-2010-2020516166' },
  { site: 'domain', suburb: 'glebe', ts: '2026', url: 'https://www.domain.com.au/110-11-wigram-lane-glebe-nsw-2037-2020659759' },
  { site: 'rea', suburb: 'surry-hills', ts: '20250506010259', url: 'https://www.realestate.com.au/property-apartment-nsw-surry+hills-147399572' },
  { site: 'rea', suburb: 'glebe', ts: '2025', url: 'https://www.realestate.com.au/property-house-nsw-glebe-148153244', optional: true },
  { site: 'rea', suburb: 'pyrmont', ts: '2025', url: 'https://www.realestate.com.au/property-unit-nsw-pyrmont-147881516', optional: true },
];
const SEARCH = { domain: 'https://www.domain.com.au/sale/surry-hills-nsw-2010/', rea: 'https://www.realestate.com.au/buy/in-surry+hills,+nsw+2010/list-1' };

const results = { listings: [], checks: [] };
let failures = 0;
const check = (name, ok, detail) => {
  results.checks.push({ name, ok: !!ok, detail });
  if (!ok) failures++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + JSON.stringify(detail) : ''));
};

// ---------------- proxy (mock) lifecycle
let proxy = null;
async function health() {
  try {
    const r = await fetch(PROXY + '/health', { signal: AbortSignal.timeout(1500) });
    return await r.json();
  } catch {
    return null;
  }
}
async function startProxy() {
  if (await health()) throw new Error('something is already listening on 8787');
  proxy = spawn(process.execPath, ['src/server.js'], { cwd: path.join(ROOT, 'proxy'), env: { ...process.env, MOCK: '1', PORT: '8787' }, stdio: ['ignore', 'pipe', 'pipe'] });
  proxy.stdout.on('data', (d) => process.stderr.write('[proxy] ' + d));
  proxy.stderr.on('data', (d) => process.stderr.write('[proxy] ' + d));
  for (let i = 0; i < 40; i++) {
    const h = await health();
    if (h) return h;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('proxy did not start');
}
async function stopProxy() {
  if (!proxy) return;
  const p = proxy;
  proxy = null;
  await new Promise((r) => {
    p.once('exit', r);
    p.kill('SIGTERM');
    setTimeout(() => {
      try { p.kill('SIGKILL'); } catch {}
      r();
    }, 3000);
  });
}

// ---------------- archive replay (in memory only)
const REAL = /^https:\/\/www\.(domain|realestate)\.com\.au\//;
const memo = new Map();
const tsFor = (url) => {
  const hit = LISTINGS.find((l) => url.split('#')[0].split('?')[0].replace(/\/$/, '') === l.url);
  if (hit) return hit.ts;
  return /realestate/.test(url) ? '2025' : '2026';
};
function archived(url, flag) {
  const key = flag + ' ' + url;
  if (!memo.has(key)) {
    memo.set(
      key,
      (async () => {
        const r = await fetch('https://web.archive.org/web/' + tsFor(url) + flag + '/' + url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
        return { status: r.status, type: r.headers.get('content-type') || 'application/octet-stream', body: Buffer.from(await r.arrayBuffer()) };
      })().catch((e) => {
        memo.delete(key);
        throw e;
      })
    );
  }
  return memo.get(key);
}
const SEARCH_FALLBACK = '<!doctype html><html><head><title>Search results</title></head><body><h1>Search results</h1><p>(placeholder search page)</p></body></html>';

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbx-'));
let ctx = null;
const shot = async (page, name) => {
  const p = path.join(SHOTS, name);
  await page.screenshot({ path: p });
  return p;
};
const waitState = (page, pred, timeout = 30000) =>
  page.waitForFunction(
    (src) => {
      const roots = document.querySelectorAll('#mbx-root');
      const s = roots.length === 1 ? roots[0].getAttribute('data-mbx-state') : null;
      return new Function('s', 'return (' + src + ')(s)')(s);
    },
    pred.toString(),
    { timeout, polling: 200 }
  );
const norm = (s) => String(s || '').toLowerCase().replace(/[,]/g, ' ').replace(/\s+/g, ' ').trim();

async function inspect(page) {
  return page.evaluate(() => {
    const roots = document.querySelectorAll('#mbx-root');
    const r = roots[0];
    const sr = r && r.shadowRoot;
    const q = (sel) => (sr ? sr.querySelector(sel) : null);
    const vis = (el) => {
      if (!el || el.hidden) return false;
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const panel = q('.panel');
    const pr = panel ? panel.getBoundingClientRect() : null;
    let ld = null;
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      if (/streetAddress/.test(s.textContent)) { ld = true; break; }
    }
    const h1 = document.querySelector('h1');
    return {
      roots: roots.length,
      attrs: r ? r.getAttributeNames() : [],
      state: r ? r.getAttribute('data-mbx-state') : null,
      query: r ? r.getAttribute('data-mbx-query') : null,
      source: r ? r.getAttribute('data-mbx-source') : null,
      h1: h1 ? h1.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : null,
      ldHasAddress: !!ld,
      badge: vis(q('.badge')) ? q('.badge').textContent : null,
      banner: vis(q('.banner')) ? q('.banner').textContent : null,
      labels: sr ? [...sr.querySelectorAll('h3.label')].map((e) => e.textContent) : [],
      nodata: sr ? sr.querySelectorAll('.nodata').length : 0,
      footer: vis(q('.disc')) ? q('.disc').textContent : null,
      retry: sr ? [...sr.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Retry' && vis(b)) : false,
      text: sr ? sr.textContent.replace(/\s+/g, ' ').slice(0, 900) : null,
      panelRect: pr ? { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height), vw: innerWidth, vh: innerHeight } : null,
    };
  });
}
const inViewport = (p) => p && p.x >= 0 && p.y >= 0 && p.x + p.w <= p.vw && p.y + p.h <= p.vh;

async function scrollPanelBottom(page) {
  await page.evaluate(() => {
    const sr = document.getElementById('mbx-root').shadowRoot;
    for (const el of sr.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight;
    }
  });
  await page.waitForTimeout(250);
}
async function scrollPanelTop(page) {
  await page.evaluate(() => {
    const sr = document.getElementById('mbx-root').shadowRoot;
    for (const el of sr.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0;
  });
}

try {
  const h = await startProxy();
  check('proxy /health', h && h.ok === true && h.mode === 'mock', h);

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
    try { host = new URL(url).hostname; } catch {}
    if (host === 'localhost' || host === '127.0.0.1' || !/^https?:/.test(url)) return route.continue();
    if (REAL.test(url) && type === 'document') {
      const isSearch = Object.values(SEARCH).includes(url);
      try {
        const a = await archived(url, 'id_');
        if (a.status !== 200 && isSearch) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SEARCH_FALLBACK });
        return route.fulfill({ status: a.status, contentType: 'text/html; charset=utf-8', body: a.body });
      } catch (e) {
        if (isSearch) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SEARCH_FALLBACK });
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
  const page = ctx.pages()[0] || (await ctx.newPage());

  // ---------------- 1. listings
  let first = null;
  for (const l of LISTINGS) {
    const out = { url: l.url, site: l.site, suburb: l.suburb, optional: !!l.optional };
    try {
      const resp = await page.goto(l.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      out.http = resp ? resp.status() : null;
      await waitState(page, (s) => !!s && s !== 'detecting' && s !== 'loading', 30000).catch(() => {});
      await page.waitForTimeout(400);
      Object.assign(out, await inspect(page));
      out.matched = /Matched|match/i.test(out.text || '') ? (out.text || '').slice(0, 220) : null;
      const name = 'proof-' + l.site + '-' + l.suburb + '.png';
      out.shot = await shot(page, name);
      if (out.state === 'result:ok') {
        await scrollPanelBottom(page);
        out.shotBottom = await shot(page, 'proof-' + l.site + '-' + l.suburb + '-bottom.png');
        await scrollPanelTop(page);
      }
    } catch (e) {
      out.error = String(e.message || e).split('\n')[0];
    }
    const pageAddrOk = !!out.query && !!out.h1 && norm(out.query) === norm(out.h1);
    const ok =
      out.state === 'result:ok' &&
      out.roots === 1 &&
      pageAddrOk &&
      out.source === 'json-ld' &&
      /mock/i.test(out.badge || '') &&
      !!out.banner &&
      ['Estimated value', 'Basics', 'Recent sales nearby', 'Latest rent'].every((x) => out.labels.includes(x)) &&
      out.labels.length >= 5 &&
      out.footer === 'Microburbs estimate, indicative only.' &&
      inViewport(out.panelRect) &&
      out.attrs.every((a) => ['id', 'data-mbx-state', 'data-mbx-query', 'data-mbx-source'].includes(a));
    out.pass = ok;
    if (!ok) {
      // keep tools/shots/proof-*.png for passing listings only
      for (const k of ['shot', 'shotBottom']) {
        if (!out[k] || !fs.existsSync(out[k])) continue;
        const alt = path.join(SHOTS, path.basename(out[k]).replace(/^proof-/, 'attempt-'));
        fs.renameSync(out[k], alt);
        out[k] = alt;
      }
    }
    results.listings.push(out);
    if (l.optional) console.log((ok ? 'PASS ' : 'SKIP ') + 'optional listing ' + l.url + ' ' + JSON.stringify({ state: out.state, query: out.query, h1: out.h1, error: out.error }));
    else check('listing ' + l.site + ' ' + l.suburb, ok, { state: out.state, query: out.query, h1: out.h1, source: out.source, badge: out.badge, banner: out.banner, labels: out.labels, footer: out.footer, panel: out.panelRect, error: out.error });
    if (ok && !first) first = l;
  }
  if (!first) throw new Error('no listing reached result:ok; skipping the interaction checks');

  // ---------------- 2a. proxy down -> error + Retry; proxy up -> Retry -> ok
  await stopProxy();
  check('proxy stopped', !(await health()));
  await page.goto(first.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitState(page, (s) => s === 'error', 30000).catch(() => {});
  let st = await inspect(page);
  await shot(page, 'proof-proxy-down-error.png');
  check('proxy down -> error state with Retry', st.state === 'error' && st.retry && st.query, { state: st.state, retry: st.retry, query: st.query, text: (st.text || '').slice(0, 300) });
  const h2 = await startProxy();
  check('proxy restarted', h2 && h2.ok);
  await page.locator('#mbx-root button', { hasText: 'Retry' }).click();
  await waitState(page, (s) => s === 'result:ok', 30000).catch(() => {});
  st = await inspect(page);
  await shot(page, 'proof-retry-ok.png');
  check('Retry after restart -> result:ok', st.state === 'result:ok' && st.roots === 1, { state: st.state, query: st.query });

  // ---------------- 2b. typed addresses
  await page.locator('#mbx-root button', { hasText: 'Wrong home? Enter the address' }).click();
  const typed = async (text, want, file) => {
    const input = page.locator('#mbx-root input[name="address"]');
    await input.fill(text);
    await input.press('Enter');
    await waitState(page, new Function('s', 'return s === ' + JSON.stringify(want)), 30000).catch(() => {});
    await page.waitForTimeout(300);
    const s = await inspect(page);
    await shot(page, file);
    return s;
  };
  st = await typed('zzzz', 'result:no_match', 'proof-typed-zzzz-no_match.png');
  check('typed "zzzz" -> result:no_match', st.state === 'result:no_match' && st.query === 'zzzz' && st.source === 'typed', { state: st.state, query: st.query, source: st.source });
  st = await typed('bondi', 'result:outside_coverage', 'proof-typed-bondi-outside_coverage.png');
  check('typed "bondi" -> result:outside_coverage', st.state === 'result:outside_coverage' && st.query === 'bondi', { state: st.state, query: st.query });
  st = await typed('nodata', 'result:ok', 'proof-typed-nodata.png');
  check('typed "nodata" -> every section shows No data', st.state === 'result:ok' && st.nodata >= 5, { state: st.state, nodata: st.nodata, labels: st.labels });
  await scrollPanelBottom(page);
  await shot(page, 'proof-typed-nodata-bottom.png');

  // ---------------- 2c. navigation
  await page.goto(first.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitState(page, (s) => s === 'result:ok', 30000).catch(() => {});
  const searchPath = new URL(SEARCH[first.site]).pathname;
  await page.evaluate((p) => history.pushState({}, '', p), searchPath);
  await page.waitForTimeout(1800);
  let n = await page.evaluate(() => document.querySelectorAll('#mbx-root').length);
  check('SPA pushState to search page -> panel removed', n === 0, { roots: n, url: page.url() });
  await page.evaluate(() => history.back());
  await waitState(page, (s) => s === 'result:ok', 30000).catch(() => {});
  n = await page.evaluate(() => document.querySelectorAll('#mbx-root').length);
  check('SPA back to listing -> exactly one panel', n === 1, { roots: n, url: page.url() });

  await page.goto(SEARCH[first.site], { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(2500);
  n = await page.evaluate(() => document.querySelectorAll('#mbx-root').length);
  await shot(page, 'proof-nav-search.png');
  check('navigate to search results page -> no panel', n === 0, { roots: n, url: page.url() });
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitState(page, (s) => s === 'result:ok', 30000).catch(() => {});
  await page.waitForTimeout(1200);
  n = await page.evaluate(() => document.querySelectorAll('#mbx-root').length);
  st = await inspect(page);
  await shot(page, 'proof-nav-back.png');
  check('back to listing -> exactly one panel, result:ok', n === 1 && st.state === 'result:ok', { roots: n, state: st.state, url: page.url() });
} catch (e) {
  check('run', false, String(e.message || e).split('\n')[0]);
} finally {
  if (ctx) await ctx.close().catch(() => {});
  await stopProxy();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
fs.writeFileSync(path.join(SHOTS, 'proof-results.json'), JSON.stringify(results, null, 2));
console.log('RESULT ' + (failures ? failures + ' failed' : 'all passed'));
process.exit(failures ? 1 : 0);
