#!/usr/bin/env node
// Dev-only: open listing pages in Playwright's bundled Chromium with the
// unpacked extension loaded, wait for the panel to settle, screenshot it.
//
//   node tools/try-listing.mjs [--headless] [--shots DIR] [--keep-open] [--ext DIR] [--timeout MS] <url>...
//
// Prints one JSON line per URL: { url, state, query, source, h1, title, shot }.
// h1/title are read by this tool only, to compare against the panel's query;
// nothing from the page is written anywhere except the screenshot, and
// screenshots go to tools/shots/ (gitignored). Exit code 1 if any URL failed
// (panel never settled, transport error, or no address found).
// Note: both live sites block Playwright's Chromium (domain.com.au "Access
// Denied", realestate.com.au HTTP 429), so here the panel correctly falls back
// to need_address. For an automated proof on real listing markup use
// tools/proof-replay.mjs, which serves archived copies at the real URLs.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opts = { headless: false, keepOpen: false, shots: path.join(HERE, 'shots'), ext: path.resolve(HERE, '..', 'extension'), timeout: 25000 };
const urls = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--headless') opts.headless = true;
  else if (a === '--keep-open') opts.keepOpen = true;
  else if (a === '--shots') opts.shots = path.resolve(argv[++i]);
  else if (a === '--ext') opts.ext = path.resolve(argv[++i]);
  else if (a === '--timeout') opts.timeout = Number(argv[++i]);
  else if (a === '-h' || a === '--help') {
    console.log('usage: node tools/try-listing.mjs [--headless] [--shots DIR] [--keep-open] [--ext DIR] [--timeout MS] <url>...');
    process.exit(0);
  } else if (a.startsWith('--')) {
    console.error('unknown flag ' + a);
    process.exit(2);
  } else urls.push(a);
}
if (!urls.length && !opts.keepOpen) {
  console.error('usage: node tools/try-listing.mjs [--headless] [--shots DIR] [--keep-open] <url>...');
  process.exit(2);
}
if (!fs.existsSync(path.join(opts.ext, 'manifest.json'))) {
  console.error('no manifest.json in ' + opts.ext);
  process.exit(2);
}
fs.mkdirSync(opts.shots, { recursive: true });

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbx-'));
const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium', // bundled Chromium (new headless mode keeps extensions working)
  headless: opts.headless,
  viewport: { width: 1440, height: 900 },
  args: ['--disable-extensions-except=' + opts.ext, '--load-extension=' + opts.ext],
});

let failed = 0;
const shotName = (url, i) => {
  let slug = String(i);
  try {
    const u = new URL(url);
    slug = (u.hostname.replace(/^www\./, '') + u.pathname).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 90);
  } catch {}
  return path.join(opts.shots, String(i + 1).padStart(2, '0') + '-' + slug + '.png');
};

for (const [i, url] of urls.entries()) {
  const page = ctx.pages().find((p) => p.url() === 'about:blank') || (await ctx.newPage());
  const out = { url, state: null, query: null, source: null, h1: null, title: null, shot: null };
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    out.http = resp ? resp.status() : null;
    await page
      .waitForFunction(
        () => {
          const r = document.getElementById('mbx-root');
          const s = r && r.getAttribute('data-mbx-state');
          return !!s && s !== 'detecting' && s !== 'loading';
        },
        null,
        { timeout: opts.timeout, polling: 250 }
      )
      .catch((e) => {
        out.error = 'panel did not settle: ' + String(e.message || e).split('\n')[0];
      });
    Object.assign(
      out,
      await page.evaluate(() => {
        const r = document.getElementById('mbx-root');
        const h1 = document.querySelector('h1');
        return {
          state: r ? r.getAttribute('data-mbx-state') : null,
          query: r ? r.getAttribute('data-mbx-query') : null,
          source: r ? r.getAttribute('data-mbx-source') : null,
          h1: h1 ? h1.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : null,
          title: document.title.slice(0, 160),
        };
      })
    );
    out.shot = shotName(url, i);
    await page.screenshot({ path: out.shot });
  } catch (e) {
    out.error = String(e.message || e).split('\n')[0];
  }
  // result:error = the proxy answered but upstream failed (bad key, 429, outage): a failure, not a pass.
  if (out.error || !out.state || out.state === 'error' || out.state === 'result:error' || out.state === 'need_address' || out.state === 'detecting' || out.state === 'loading') failed++;
  else if (out.state === 'result:no_match') console.error('warning: no geocoder match for ' + url);
  console.log(JSON.stringify(out));
}

if (opts.keepOpen) {
  console.error('browser left open; press Ctrl+C to close');
  await new Promise((resolve) => {
    process.once('SIGINT', resolve);
    ctx.once('close', resolve);
  });
}
await ctx.close().catch(() => {});
fs.rmSync(userDataDir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
