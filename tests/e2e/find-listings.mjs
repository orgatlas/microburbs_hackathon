#!/usr/bin/env node
// Test tooling only (not the extension): find archived 2025-2026 Wayback snapshots of
// City of Sydney listings on realestate.com.au / domain.com.au, and classify each as
// rent or sale from the snapshot's <title> text. Prints candidate rows as JSON lines;
// pick 3 rent + 3 sale into tests/e2e/listings.json by hand.
// Nothing is written. Never touches the live listing sites (only web.archive.org).
//
//   node tests/e2e/find-listings.mjs [--rea] [--domain] [--max N] [domainSearchPath...]
// e.g. node tests/e2e/find-listings.mjs --domain www.domain.com.au/sale/glebe-nsw-2037/
const args = process.argv.slice(2);
const maxIdx = args.indexOf('--max');
const MAX = maxIdx >= 0 ? Number(args[maxIdx + 1]) : 8;
const wantRea = args.includes('--rea') || !args.includes('--domain');
const wantDomain = args.includes('--domain') || !args.includes('--rea');

const REA_PREFIXES = [
  'www.realestate.com.au/property-apartment-nsw-surry+hills-',
  'www.realestate.com.au/property-apartment-nsw-pyrmont-',
  'www.realestate.com.au/property-apartment-nsw-redfern-',
  'www.realestate.com.au/property-apartment-nsw-zetland-',
  'www.realestate.com.au/property-apartment-nsw-ultimo-',
  'www.realestate.com.au/property-apartment-nsw-darlinghurst-',
  'www.realestate.com.au/property-unit-nsw-glebe-',
  'www.realestate.com.au/property-apartment-nsw-potts+point-',
];
const POSITIONAL = args.filter((a, i) => !a.startsWith('--') && !(maxIdx >= 0 && i === maxIdx + 1));
const DOMAIN_SEARCH = POSITIONAL.length ? POSITIONAL : [
  'www.domain.com.au/rent/surry-hills-nsw-2010/',
  'www.domain.com.au/rent/pyrmont-nsw-2009/',
  'www.domain.com.au/rent/redfern-nsw-2016/',
  'www.domain.com.au/rent/glebe-nsw-2037/',
  'www.domain.com.au/rent/zetland-nsw-2017/',
  'www.domain.com.au/sale/zetland-nsw-2017/',
  'www.domain.com.au/sale/pyrmont-nsw-2009/',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(45000) });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      return { status: r.status, url: r.url, text: await r.text() };
    } catch (e) {
      if (i === tries - 1) return { status: 0, error: String(e.message || e), text: '' };
      await sleep(1500 * (i + 1));
    }
  }
}
async function cdx(params) {
  const q = new URLSearchParams({ output: 'json', from: '2025', to: '2026', filter: 'statuscode:200', ...params });
  const r = await get('https://web.archive.org/cdx/search/cdx?' + q);
  try {
    const rows = JSON.parse(r.text || '[]');
    const [head, ...rest] = rows;
    return rest.map((row) => Object.fromEntries(head.map((k, i) => [k, row[i]])));
  } catch {
    return [];
  }
}
const pick = (re, s) => {
  const m = re.exec(s);
  return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ').trim() : null;
};
// realestate.com.au titles say "... - Apartment for Rent|Sale - realestate.com.au".
// domain.com.au titles say "<address> - House For Rent | Domain" for rentals, "Sold <address> on <date> ..." for
// sold homes and just "<address> | Domain" for homes for sale.
const classify = (title) => {
  const t = String(title || '').toLowerCase();
  if (/\b(for rent|for lease|to rent|rental|leased)\b/.test(t)) return 'rent';
  if (/^sold\b/.test(t)) return 'sold';
  if (/\b(for sale|auction|under offer)\b/.test(t)) return 'sale';
  if (/ \| domain$/.test(t) && !/^wayback/.test(t)) return 'sale';
  return null;
};
async function inspect(ts, original) {
  const r = await get('https://web.archive.org/web/' + ts + 'id_/' + original);
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i, r.text);
  const h1 = pick(/<h1[^>]*>([\s\S]*?)<\/h1>/i, r.text);
  const ld = /"streetAddress"/.test(r.text);
  return { ts, url: original.replace(/^http:/, 'https:').replace(/:80\//, '/'), status: r.status, bytes: r.text.length, title, h1, ld, kind: classify(title) };
}
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    })
  );
  return out;
}

if (wantRea) {
  await pool(REA_PREFIXES, 3, async (prefix) => {
    const rows = await cdx({ url: prefix, matchType: 'prefix', collapse: 'urlkey', limit: String(MAX), fl: 'timestamp,original' });
    for (const row of rows.slice(0, MAX)) {
      if (!/-\d{6,}\/?$/.test(row.original.split('?')[0])) continue;
      const res = await inspect(row.timestamp, row.original.split('?')[0]);
      console.log(JSON.stringify({ site: 'realestate', prefix, ...res }));
    }
  });
}
if (wantDomain) {
  await pool(DOMAIN_SEARCH, 3, async (search) => {
    const snaps = await cdx({ url: search, fl: 'timestamp,original', limit: '5' });
    const last = snaps[snaps.length - 1];
    if (!last) return console.log(JSON.stringify({ site: 'domain', search, note: 'no 2025-2026 snapshot' }));
    const page = await get('https://web.archive.org/web/' + last.timestamp + 'id_/https://' + search);
    const links = [...new Set([...page.text.matchAll(/https:\/\/www\.domain\.com\.au\/([a-z0-9-]+-nsw-\d{4}-\d{7,})/g)].map((m) => 'https://www.domain.com.au/' + m[1]))];
    console.log(JSON.stringify({ site: 'domain', search, ts: last.timestamp, links: links.length }));
    for (const link of links.slice(0, MAX)) {
      const s = await cdx({ url: link.replace(/^https:\/\//, ''), fl: 'timestamp,original', limit: '3' });
      if (!s.length) continue;
      const res = await inspect(s[s.length - 1].timestamp, link);
      console.log(JSON.stringify({ site: 'domain', search, ...res }));
    }
  });
}
