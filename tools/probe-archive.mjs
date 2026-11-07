// Dev-only: when the live sites block automated browsers, check extract.js
// against REAL listing markup from public Wayback Machine snapshots.
// Opens an archived search page, follows up to --max archived listing links,
// injects extension/src/extract.js and runs MBX.extractAddress().
// Prints JSON lines; writes nothing into the repo (screenshots go to tools/shots/).
// Usage: node tools/probe-archive.mjs [--headless] [--max N] <archivedSearchUrl>...
//        node tools/probe-archive.mjs [--headless] --direct <archivedListingUrl>...
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTRACT = fs.readFileSync(path.resolve(HERE, '..', 'extension', 'src', 'extract.js'), 'utf8');
const args = process.argv.slice(2);
const headless = args.includes('--headless');
const maxIdx = args.indexOf('--max');
const max = maxIdx >= 0 ? Number(args[maxIdx + 1]) : 3;
const urls = args.filter((a, i) => !a.startsWith('--') && !(maxIdx >= 0 && i === maxIdx + 1));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbx-'));
const ctx = await chromium.launchPersistentContext(dir, { headless, viewport: { width: 1440, height: 900 } });
const page = ctx.pages()[0] || (await ctx.newPage());
const original = (u) => (u.match(/\/web\/\d+[a-z_]*\/(https?:\/\/.*)$/) || [])[1] || null;

async function check(url) {
  const out = { url, original: original(url) };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.addScriptTag({ content: EXTRACT });
    Object.assign(
      out,
      await page.evaluate(async (orig) => {
        const r = await globalThis.MBX.extractAddress({ timeoutMs: 4000 });
        const h1 = document.querySelector('h1');
        return {
          isListing: globalThis.MBX.isListingPage(orig),
          extracted: r && r.address,
          source: r && r.source,
          h1: h1 ? h1.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : null,
          h1cls: h1 ? String(h1.className).slice(0, 60) : null,
          h1parentTestid: h1 && h1.parentElement ? h1.parentElement.getAttribute('data-testid') : null,
          title: document.title.slice(0, 160),
          ldCount: document.querySelectorAll('script[type="application/ld+json"]').length,
        };
      }, out.original)
    );
    out.shot = path.join(HERE, 'shots', 'archive-' + (out.original || url).replace(/[^a-z0-9]+/gi, '-').slice(-80) + '.png');
    await page.screenshot({ path: out.shot });
  } catch (e) {
    out.err = String(e.message || e).split('\n')[0].slice(0, 200);
  }
  return out;
}

const direct = args.includes('--direct'); // treat each URL as an archived listing page
for (const s of direct ? [] : urls) {
  let links = [];
  try {
    await page.goto(s, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
    links = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
  } catch (e) {
    console.log(JSON.stringify({ search: s, err: String(e.message).split('\n')[0] }));
  }
  const listingish = (h) => {
    const o = original(h) || h;
    try {
      const u = new URL(o);
      return (/domain\.com\.au$/.test(u.hostname) && /^\/[a-z0-9-]+-\d{6,}\/?$/.test(u.pathname)) || (/realestate\.com\.au$/.test(u.hostname) && /^\/property-/.test(u.pathname));
    } catch {
      return false;
    }
  };
  // archived pages keep the original hrefs: open each through the archive
  links = [...new Set(links.filter(listingish).map((h) => h.split('#')[0]).map((h) => (original(h) ? h : 'https://web.archive.org/web/2026/' + h)))];
  console.log(JSON.stringify({ search: s, title: await page.title().catch(() => null), nlinks: links.length, sample: links.slice(0, 5) }));
  for (const l of links.slice(0, max)) console.log(JSON.stringify(await check(l)));
}
for (const l of direct ? urls : []) console.log(JSON.stringify(await check(l)));
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
