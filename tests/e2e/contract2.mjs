import { chromium } from '../../tools/node_modules/playwright/index.mjs';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, loadConfig } from '../../proxy/server.js';

const extension = fileURLToPath(new URL('../../extension/', import.meta.url));
const listings = JSON.parse(await readFile(new URL('./listings.json', import.meta.url), 'utf8'));
const findings = new URL('../findings.md', import.meta.url);
const port = 8787; // The unpacked extension at the tested revision targets this port.
const proxy = `http://127.0.0.1:${port}`;
const browserProxy = `http://localhost:${port}`;
const work = 'Broadway, Ultimo NSW';
const env = loadConfig();
if (!env.MICROBURBS_API_KEY?.trim() || env.MICROBURBS_API_KEY === 'paste-your-team-key-here') {
  throw new Error('The listing check requires the live key in proxy/.env.');
}
if (listings.filter((x) => x.kind === 'rent').length !== 3 || listings.filter((x) => x.kind === 'sale').length !== 3) {
  throw new Error('Expected exactly three rental and three sale listings.');
}
const browserEnv = { ...process.env };
for (const name of Object.keys(browserEnv)) if (name.toUpperCase() === 'MICROBURBS_API_KEY') delete browserEnv[name];

function key(address) {
  return String(address ?? '').toLowerCase().replace(/\(\s*nsw\s*\)/g, ' nsw ')
    .replace(/\b(?:nsw|australia|new south wales)\b(?:\s*\d{4})?/g, ' ')
    .replace(/[–—]/g, '-').replace(/\s*([-\/])\s*/g, '$1')
    .replace(/^(?:unit|apt|apartment)\s+(\w+),?\s+(?=\d)/, '$1/')
    .replace(/^(?:unit|apt|apartment)\s+(?=\w+\/)/, '')
    .replace(/\b(street|road|avenue|lane)\b/g, (word) => ({ street: 'st', road: 'rd', avenue: 'ave', lane: 'ln' })[word])
    .replace(/[,\.]/g, ' ').replace(/\s+\d{4}\s*$/, '').replace(/\s+/g, ' ').trim();
}

function compact(result) {
  const entries = Object.entries(result?.facts ?? {}).flatMap(([dimension, signals]) =>
    Object.entries(signals).map(([name, value]) => [`${dimension}.${name}`, value]));
  return { total: entries.length, available: entries.filter(([, signal]) => signal?.available === true).length,
    missing: entries.filter(([, signal]) => signal?.available !== true).map(([name]) => name) };
}

function listingUrl(input) {
  const url = new URL(input);
  url.search = url.hash = '';
  return url.href.replace(/\/$/, '');
}

const tempRoot = await realpath(tmpdir());
const tempProfile = await mkdtemp(join(tempRoot, 'fit-contract2-'));
const results = [];
const app = createApp({ env });
let activeListing;
const server = createServer((request, response) => {
  const { pathname, searchParams } = new URL(request.url, proxy);
  if (pathname === '/lookup') {
    const addresses = searchParams.getAll('address');
    const workplaces = searchParams.getAll('work');
    const expectedInput = activeListing && request.method === 'GET'
      && [...searchParams.keys()].every((name) => name === 'address' || name === 'work')
      && addresses.length === 1 && key(addresses[0]) === key(activeListing.page_address)
      && workplaces.length <= 1 && (workplaces.length === 0 || workplaces[0] === work);
    if (!expectedInput) {
      if (activeListing) activeListing.blockedLookup = true;
      response.writeHead(400, { 'Content-Type': 'text/plain' });
      return response.end('Unexpected listing lookup input');
    }
  }
  return app(request, response);
});
let context;
let fatal;
try {
  await once(server.listen(port, '127.0.0.1'), 'listening');
  context = await chromium.launchPersistentContext(tempProfile, {
    headless: false,
    env: browserEnv,
    executablePath: process.env.FIT_CHROMIUM_PATH || undefined,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const isExtensionWorker = (worker) => worker?.url().startsWith('chrome-extension://');
  const worker = context.serviceWorkers().find(isExtensionWorker)
    || await context.waitForEvent('serviceworker', { predicate: isExtensionWorker, timeout: 15000 });
  await worker.evaluate((workAddress) => chrome.storage.local.set({
    'mbx.dev': true,
    'mbx.profile.v1': { work_address: workAddress },
  }), work);

  for (const listing of listings) {
    const row = { ...listing, page: 'not loaded' };
    results.push(row);
    activeListing = row;
    let workerReply;
    const capture = (response) => {
      const url = new URL(response.url());
      if ([proxy, browserProxy].includes(url.origin) && url.pathname === '/lookup'
        && response.request().serviceWorker()?.url() === worker.url()
        && key(url.searchParams.get('address')) === key(listing.page_address)) {
        workerReply = response.json().then((body) => ({ body, status: response.status() }), () => null);
      }
    };
    context.on('response', capture);
    const page = await context.newPage();
    let archive = null;
    const url = listingUrl(listing.url);
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'document' || listingUrl(request.url()) !== url) return route.abort();
      return archive ? route.fulfill({
        contentType: 'text/html; charset=utf-8', body: archive,
        headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'none'" },
      }) : route.continue();
    });
    try {
      // Try the actual URL once. A public archive is a separate source; do not retry past an access block.
      try {
        const nav = await page.goto(listing.url, { waitUntil: 'domcontentloaded', timeout: 10000 });
        row.page = `live HTTP ${nav?.status() ?? 'unknown'}`;
        if (nav?.ok()) {
          const extracted = await page.waitForFunction(() => {
            const host = document.querySelector('#mbx-root');
            if (host?.getAttribute('data-mbx-query')) return true;
            return host?.getAttribute('data-mbx-state') === 'need_address' ? 'missing' : null;
          }, undefined, { timeout: 10000 }).then((result) => result.jsonValue(), () => false);
          row.page = extracted === true ? 'live' : `${row.page} without address`;
        }
      } catch { row.page = 'live navigation failed'; }
      if (row.page !== 'live') {
        try {
          const snapshot = `https://web.archive.org/web/${listing.wayback}id_/${listing.url}`;
          const replay = await fetch(snapshot, { signal: AbortSignal.timeout(12000) });
          if (replay.ok) {
            archive = Buffer.from(await replay.arrayBuffer());
            await page.goto(listing.url, { waitUntil: 'domcontentloaded', timeout: 10000 });
            row.page += '; archive replay';
          } else row.page += `; archive HTTP ${replay.status}`;
        } catch { row.page += '; archive unreachable'; }
      }
      if (row.page === 'live' || row.page.includes('archive replay')) {
        try {
          await page.waitForFunction(() => /^(?:result:|need_address|error)/.test(document.querySelector('#mbx-root')?.getAttribute('data-mbx-state') || ''), undefined, { timeout: 40000 });
        } catch { /* Record the observed state, including timeouts. */ }
      }
      row.panel = await page.evaluate(() => {
        const host = document.querySelector('#mbx-root');
        return { state: host?.getAttribute('data-mbx-state'), query: host?.getAttribute('data-mbx-query'), source: host?.getAttribute('data-mbx-source'),
          match: host?.shadowRoot?.querySelector('[data-bind="display_name"]')?.textContent?.trim() || null };
      });
      row.worker = await workerReply;
    } catch (error) { row.page += `; check failed (${error.name})`; }
    finally { context.off('response', capture); await page.close(); }

    if (!row.worker) {
      try {
        const params = new URLSearchParams({ address: row.page_address, work });
        const response = await fetch(`${proxy}/lookup?${params}`, { signal: AbortSignal.timeout(28000) });
        row.direct = { body: await response.json(), status: response.status() };
      } catch { row.direct = null; }
    }
  }
} catch (error) { fatal = `${error.name}: ${error.message.split('\n')[0]}`; }
finally {
  await context?.close();
  await new Promise((done) => server.close(done));
  const resolvedProfile = await realpath(tempProfile).catch(() => null);
  if (resolvedProfile && dirname(resolvedProfile) === tempRoot && basename(resolvedProfile).startsWith('fit-contract2-')) {
    await rm(resolvedProfile, { recursive: true, force: true }).catch(() => {});
  }
}

const esc = (value) => String(value ?? '—').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
const stamp = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Sydney' }).format(new Date());
const report = [
  '## Contract 2 headed Chromium check', '',
  `Run ${stamp} (Sydney) with the unchanged unpacked extension. Its configured port is 8787, so the harness starts the same Contract 2 app on that port. Listing documents were tested with subresources blocked. No screenshots or listing documents were saved.`, '',
  '| Listing | Page | Extension state | Contract 2 match | Signals available |',
  '| --- | --- | --- | --- | --- |',
];
const observations = [];
for (const row of results) {
  const via = row.worker ? 'extension' : row.direct ? 'direct proxy only' : 'no response';
  const reply = row.worker ?? row.direct;
  const match = reply?.body?.matched;
  const { total, available, missing } = compact(reply?.body);
  report.push(`| [${esc(row.kind)} · ${esc(row.suburb)}](${row.url}) | ${esc(row.page)} | ${esc(row.panel?.state)} | ${esc(match?.display_name ?? 'No match')} (${esc(match?.confidence ?? via)}) | ${total ? `${available}/${total}` : 'Not measured'} (${via}) |`);
  const mismatch = [];
  if (row.panel?.query && key(row.panel.query) !== key(row.page_address)) mismatch.push(`extracted a different address from “${row.page_address}”`);
  if (!row.panel?.query) mismatch.push('no address extracted by extension');
  if (row.panel?.source === 'title') mismatch.push('used the page title instead of JSON-LD or H1');
  if (row.blockedLookup) mismatch.push('unexpected lookup input was withheld from the API');
  if (match && (key(match.display_name) !== key(row.page_address) || match.confidence !== 'exact')) {
    mismatch.push(`proxy resolved “${match.display_name}” (${match.confidence}); expected “${row.page_address}”`);
  } else if (!match) mismatch.push(`no proxy match for “${row.page_address}”`);
  if (row.panel?.match && match && key(row.panel.match) !== key(match.display_name)) mismatch.push(`panel shows “${row.panel.match}”; proxy returned “${match.display_name}”`);
  if (!row.panel?.match) mismatch.push('no matched address shown in panel');
  observations.push(`- **${row.kind} · ${row.suburb}:** ${mismatch.join('; ') || 'address matched'}. Unavailable: ${missing.join(', ') || (total ? 'none' : 'not measured')}.`);
}
report.push('', ...observations, '');
if (fatal) report.push(`Chromium run could not complete: ${esc(fatal)}.`, '');
if (results.some((row) => row.panel?.state === 'result:unknown')) {
  report.push('The existing panel expects a top-level `status` and the older facts format. Contract 2 supplies `matched`, `facts`, and `outsideCoverage`; the panel therefore reports an unknown response. This is an extension integration finding.', '');
}
const heading = '## Contract 2 headed Chromium check';
const previous = await readFile(findings, 'utf8').catch(() => '# E2E findings\n');
const start = previous.indexOf(`\n${heading}`);
const end = start < 0 ? -1 : previous.indexOf('\n## ', start + heading.length + 1);
const output = `${(start < 0 ? previous : previous.slice(0, start)).trimEnd()}\n\n${report.join('\n')}\n${end < 0 ? '' : previous.slice(end)}`;
await writeFile(findings, `${output.trimEnd()}\n`);
const verified = results.filter((row) => row.worker?.status === 200 && row.panel?.state === 'result:ok'
  && row.worker.body?.matched?.confidence === 'exact' && compact(row.worker.body).total === 18
  && key(row.panel.match) === key(row.page_address) && row.panel.source !== 'title').length;
console.log(`Headed Chromium: ${results.length}/${listings.length} attempted, ${results.filter((row) => row.worker).length} extension lookups observed, ${verified} rendered successfully. See tests/findings.md.`);
if (fatal) console.log(fatal);
if (fatal || verified !== listings.length) process.exitCode = 1;
