#!/usr/bin/env node
// Dev-only end-to-end check of the extension WITHOUT touching the real sites:
// Playwright intercepts www.domain.com.au / www.realestate.com.au and serves
// small synthetic pages (invented addresses, no listing content), so the
// content scripts, the service worker messaging and the panel run for real.
//
// It loads a throwaway COPY of /extension from os.tmpdir() whose config points
// at a stub proxy on --port (default 8791, never 8787). With --stub-panel (or
// when src/panel.js does not exist yet) the copy gets a minimal stub panel.
//
//   node tools/e2e-synthetic.mjs [--headless] [--stub-panel] [--port N]
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..', 'extension');
const argv = process.argv.slice(2);
const headless = argv.includes('--headless');
const portIdx = argv.indexOf('--port');
const PORT = portIdx >= 0 ? Number(argv[portIdx + 1]) : 8791;
const forceStub = argv.includes('--stub-panel') || !fs.existsSync(path.join(EXT, 'src', 'panel.js'));

// ---------- throwaway extension copy
const tmpExt = fs.mkdtempSync(path.join(os.tmpdir(), 'mbx-ext-'));
fs.cpSync(EXT, tmpExt, { recursive: true });
fs.writeFileSync(path.join(tmpExt, 'src', 'config.js'), `export const PROXY_URL = 'http://127.0.0.1:${PORT}';\n`);
const manifest = JSON.parse(fs.readFileSync(path.join(tmpExt, 'manifest.json'), 'utf8'));
manifest.host_permissions.push(`http://127.0.0.1:${PORT}/*`);
fs.writeFileSync(path.join(tmpExt, 'manifest.json'), JSON.stringify(manifest, null, 2));
if (forceStub) {
  fs.writeFileSync(
    path.join(tmpExt, 'src', 'panel.js'),
    `globalThis.MBX = globalThis.MBX || {};
MBX.createPanel = function (h) {
  document.getElementById('mbx-root')?.remove();
  const host = document.createElement('div'); host.id = 'mbx-root';
  const root = host.attachShadow({ mode: 'open' });
  const msg = document.createElement('p'); const input = document.createElement('input'); const go = document.createElement('button');
  go.textContent = 'Check'; go.addEventListener('click', () => { const t = input.value.trim(); if (t) h.onSubmitAddress(t); });
  const close = document.createElement('button'); close.className = 'close'; close.textContent = 'x'; close.addEventListener('click', () => h.onClose());
  root.append(msg, input, go, close); document.documentElement.appendChild(host);
  return {
    setState(s) {
      host.setAttribute('data-mbx-state', s.kind === 'result' ? 'result:' + s.blob.status : s.kind);
      if (s.address) host.setAttribute('data-mbx-query', s.address); else host.removeAttribute('data-mbx-query');
      if (s.source) host.setAttribute('data-mbx-source', s.source); else host.removeAttribute('data-mbx-source');
      msg.textContent = s.kind + (s.blob && s.blob.match ? ': ' + s.blob.match.display_name : '');
    },
    destroy() { host.remove(); },
  };
};\n`
  );
}

// ---------- stub proxy (contract-shaped, invented numbers)
const seen = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/health') return res.end(JSON.stringify({ ok: true, mode: 'mock' }));
  const q = (u.searchParams.get('address') || '').trim();
  seen.push(q);
  const blob = {
    status: /nomatch/i.test(q) ? 'no_match' : 'ok', mode: 'mock', query: q, cached: false, fetched_at: new Date().toISOString(),
    match: /nomatch/i.test(q) ? null : { gnaf_id: 'GANSWTEST', display_name: q.toUpperCase(), property_type: 'unit', suburb: 'Surry Hills', suburb_label: 'Surry Hills', rank: 1, check: { verdict: 'exact', number: true, street: true, suburb: true, notes: [] } },
    candidates: [], sections: null, error: null,
  };
  res.setHeader('content-type', 'application/json');
  setTimeout(() => res.end(JSON.stringify(blob)), 150);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// ---------- synthetic pages
const page = (title, body, ld) =>
  `<!doctype html><html><head><title>${title}</title>${ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : ''}</head><body>${body}</body></html>`;
const agency = { '@type': 'RealEstateAgent', name: 'Test Agency', address: { '@type': 'PostalAddress', streetAddress: '1 Agency Lane', addressLocality: 'Paddington', addressRegion: 'NSW', postalCode: '2021' } };
const PAGES = {
  'https://www.domain.com.au/5-12-test-street-surry-hills-nsw-2010-2099000001': page('5/12 Test Street, Surry Hills NSW 2010 | Domain', '<h1>5/12 Test Street, Surry Hills NSW 2010</h1>', { '@context': 'https://schema.org', '@graph': [agency, { '@type': ['Residence'], address: { '@type': 'PostalAddress', streetAddress: '5/12 Test Street', addressLocality: 'Surry Hills', addressRegion: 'NSW', postalCode: '2010' } }] }),
  'https://www.realestate.com.au/property-apartment-nsw-pyrmont-149900001': page('3 Sample Road, Pyrmont, NSW 2009 - Apartment for Sale - realestate.com.au', '<div><h1 class="property-info-address">3 Sample Road, Pyrmont, NSW 2009</h1></div>'),
  'https://www.realestate.com.au/property-house-nsw-glebe-149900002': page('9 Example Lane, Glebe, NSW 2037 - House for Sale - realestate.com.au', '<h1>Address available on request</h1>'),
  'https://www.domain.com.au/surry-hills-nsw-2010-2099000002': page('Surry Hills, NSW 2010 | Domain', '<h1>Address available on request</h1>'),
  'https://www.domain.com.au/sale/surry-hills-nsw-2010/': page('Surry Hills real estate for sale | Domain', '<h1>Properties for sale in Surry Hills</h1>'),
};
const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'mbx-'));
const ctx = await chromium.launchPersistentContext(tmpProfile, {
  channel: 'chromium', headless, viewport: { width: 1440, height: 900 },
  args: ['--disable-extensions-except=' + tmpExt, '--load-extension=' + tmpExt],
});
await ctx.route(/^https:\/\/www\.(domain|realestate)\.com\.au\//, (route) => {
  const key = route.request().url().split('?')[0];
  if (PAGES[key]) return route.fulfill({ status: 200, contentType: 'text/html', body: PAGES[key] });
  if (route.request().resourceType() === 'document') return route.fulfill({ status: 200, contentType: 'text/html', body: page('x', '<p>x</p>') });
  return route.fulfill({ status: 204, body: '' });
});

let fails = 0;
const check = (cond, label, extra) => {
  if (!cond) fails++;
  console.log(JSON.stringify({ pass: !!cond, check: label, ...(extra || {}) }));
};
const p = ctx.pages()[0] || (await ctx.newPage());
const attrs = () => p.evaluate(() => { const r = document.getElementById('mbx-root'); return r ? { state: r.getAttribute('data-mbx-state'), query: r.getAttribute('data-mbx-query'), source: r.getAttribute('data-mbx-source'), roots: document.querySelectorAll('#mbx-root').length } : null; });
const settle = (pred, ms = 15000) => p.waitForFunction(pred, null, { timeout: ms, polling: 100 }).then(() => true, () => false);
const settled = () => settle(() => { const r = document.getElementById('mbx-root'); const s = r && r.getAttribute('data-mbx-state'); return !!s && s !== 'detecting' && s !== 'loading'; });

// 1. Domain listing: JSON-LD, agency address skipped
await p.goto('https://www.domain.com.au/5-12-test-street-surry-hills-nsw-2010-2099000001');
await settled();
let a = await attrs();
check(a && a.state === 'result:ok' && a.source === 'json-ld' && a.query === '5/12 Test Street, Surry Hills NSW 2010' && a.roots === 1, 'domain json-ld -> result:ok', a);
// 2. SPA navigation to another listing: new address picked up, old answer not shown
await p.evaluate(() => {
  history.pushState({}, '', '/7-other-avenue-surry-hills-nsw-2010-2099000003');
  document.querySelector('script[type="application/ld+json"]').remove();
  document.querySelector('h1').textContent = '7 Other Avenue, Surry Hills NSW 2010';
  document.title = '7 Other Avenue, Surry Hills NSW 2010 | Domain';
});
const spaOk = await settle(() => { const r = document.getElementById('mbx-root'); return r && r.getAttribute('data-mbx-query') === '7 Other Avenue, Surry Hills NSW 2010' && r.getAttribute('data-mbx-state') === 'result:ok'; });
a = await attrs();
check(spaOk && a.source === 'h1', 'SPA pushState -> re-extracts new listing', a);
// 3. SPA navigation to a search page: panel removed
await p.evaluate(() => history.pushState({}, '', '/sale/surry-hills-nsw-2010/'));
const goneOk = await settle(() => !document.getElementById('mbx-root'), 3000);
check(goneOk, 'SPA to search page -> panel destroyed');
// 4. REA listing: h1.property-info-address, no JSON-LD
await p.goto('https://www.realestate.com.au/property-apartment-nsw-pyrmont-149900001');
await settled();
a = await attrs();
check(a && a.state === 'result:ok' && a.source === 'h1' && a.query === '3 Sample Road, Pyrmont, NSW 2009', 'rea h1 -> result:ok', a);
// 5. REA listing with withheld h1: title fallback
await p.goto('https://www.realestate.com.au/property-house-nsw-glebe-149900002');
await settled();
a = await attrs();
check(a && a.state === 'result:ok' && a.source === 'title' && a.query === '9 Example Lane, Glebe, NSW 2037', 'rea title fallback', a);
// 6. Domain listing with no address anywhere: need_address, then typed address works
await p.goto('https://www.domain.com.au/surry-hills-nsw-2010-2099000002');
await settle(() => document.getElementById('mbx-root')?.getAttribute('data-mbx-state') === 'need_address', 15000);
a = await attrs();
check(a && a.state === 'need_address', 'no address -> need_address', a);
try {
  await p.locator('#mbx-root input').first().fill('2 Typed Street, Surry Hills NSW 2010');
  await p.locator('#mbx-root input').first().press('Enter');
  if (forceStub) await p.locator('#mbx-root button:not(.close)').first().click();
  await settled();
} catch (e) {
  console.log(JSON.stringify({ note: 'typed input step: ' + String(e.message).split('\n')[0] }));
}
a = await attrs();
check(a && a.state === 'result:ok' && a.source === 'typed' && a.query === '2 Typed Street, Surry Hills NSW 2010', 'typed address -> result:ok', a);
// 7. Search page: no panel
await p.goto('https://www.domain.com.au/sale/surry-hills-nsw-2010/');
await p.waitForTimeout(1500);
check(!(await attrs()), 'search page -> no panel');
// 8. Only the address left the page
check(seen.every((q) => q.length <= 200) && seen.length >= 4, 'proxy saw only address strings', { seen });
await p.screenshot({ path: path.join(HERE, 'shots', 'e2e-synthetic-last.png') }).catch(() => {});

await ctx.close();
server.close();
fs.rmSync(tmpProfile, { recursive: true, force: true });
fs.rmSync(tmpExt, { recursive: true, force: true });
console.log(JSON.stringify({ panel: forceStub ? 'stub' : 'real', fails }));
process.exit(fails ? 1 : 0);
