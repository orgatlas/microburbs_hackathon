// Dev-only: open a search page, collect listing links, and report where the
// address lives on each listing page (JSON-LD address fields, h1s, title).
// Prints JSON lines to stdout. Nothing is written into the repo.
// Usage: node tools/probe-listings.mjs [--headless] [--max N] <searchUrl>...
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const headless = args.includes('--headless');
const maxIdx = args.indexOf('--max');
const max = maxIdx >= 0 ? Number(args[maxIdx + 1]) : 3;
const urls = args.filter((a, i) => !a.startsWith('--') && !(maxIdx >= 0 && i === maxIdx + 1));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbx-'));
const ctx = await chromium.launchPersistentContext(dir, { headless, viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] || (await ctx.newPage());

function linkFilter(href) {
  try {
    const u = new URL(href);
    if (u.hostname === 'www.domain.com.au') return /^\/[a-z0-9-]+-\d{6,}\/?$/.test(u.pathname);
    if (u.hostname === 'www.realestate.com.au') return /^\/(property-|sold\/property-)/.test(u.pathname) || /\/property-[a-z+-]+-\d+/.test(u.pathname);
  } catch {}
  return false;
}

async function probe(url) {
  const out = { url };
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    out.http = resp ? resp.status() : null;
    await page.waitForTimeout(2500);
    Object.assign(out, await page.evaluate(() => {
      const ld = [];
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        let j; try { j = JSON.parse(s.textContent); } catch { ld.push('PARSE_ERR'); continue; }
        const found = [];
        const walk = (o, p) => {
          if (!o || typeof o !== 'object') return;
          if (Array.isArray(o)) { o.forEach((x, i) => walk(x, p + '[' + i + ']')); return; }
          if (o.streetAddress || o.addressLocality) found.push({ p, type: o['@type'], streetAddress: o.streetAddress, addressLocality: o.addressLocality, addressRegion: o.addressRegion, postalCode: o.postalCode });
          for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') walk(o[k], p + '.' + k);
        };
        walk(j, '$');
        const types = [];
        const tw = (o) => { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(tw); if (o['@type']) types.push(o['@type']); if (o['@graph']) tw(o['@graph']); };
        tw(j);
        ld.push({ types, found });
      }
      const h1s = [...document.querySelectorAll('h1')].map((h) => ({ text: h.textContent.trim().slice(0, 160), cls: h.className && String(h.className).slice(0, 80), testid: h.getAttribute('data-testid'), parentTestid: h.parentElement && h.parentElement.getAttribute('data-testid') }));
      const testids = [...document.querySelectorAll('[data-testid*="address" i]')].slice(0, 6).map((e) => ({ tag: e.tagName, testid: e.getAttribute('data-testid'), text: e.textContent.trim().slice(0, 120) }));
      return { title: document.title, ld, h1s, testids };
    }));
  } catch (e) { out.err = String(e.message || e).slice(0, 200); }
  return out;
}

for (const s of urls) {
  const res = await probe(s);
  let links = [];
  try {
    links = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
  } catch {}
  links = [...new Set(links.filter(linkFilter).map((h) => h.split('?')[0].split('#')[0]))];
  console.log(JSON.stringify({ search: s, http: res.http, title: res.title, err: res.err, nlinks: links.length, links: links.slice(0, 12) }));
  for (const l of links.slice(0, max)) console.log(JSON.stringify(await probe(l)));
}
await ctx.close();
