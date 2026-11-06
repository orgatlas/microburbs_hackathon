// Regression tests for the bugs found in the adversarial review of the proxy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLookup, classifyCandidate, toSection, mapValuation, pickDa, httpStatusFor } from '../src/lookup.js';
import { withBackoff, createLiveClient } from '../src/client-live.js';
import { suburbFromDisplayName } from '../src/address.js';
import { createApp } from '../src/app.js';

const row = (display_name, id, property_type = 'unit') => ({ display_name, id, property_type });
const TUDOR = '26 Tudor Street, Surry Hills';

// Geocode answers from `geo`, property/suburb endpoints from `props` (value or function); counts every call.
function fakeClient({ geo = {}, props = {} } = {}) {
  const calls = [];
  return {
    calls,
    async get(p, query) {
      calls.push(p);
      if (p === '/v1/geocode/address') {
        const g = geo[query.address];
        return typeof g === 'function' ? g() : { status: 200, body: { data: g || [] }, requestId: 'g' };
      }
      for (const [suffix, r] of Object.entries(props)) if (p.endsWith(suffix)) return typeof r === 'function' ? r() : r;
      return { status: 200, body: { data: null, available: false, reason: 'no_data', message: 'No data' }, requestId: 'p' };
    },
  };
}
const count = (client, suffix) => client.calls.filter((c) => c.endsWith(suffix)).length;

test('a 200 with an unreadable body is an upstream error, not "no data", and is never cached', async () => {
  const garbage = { status: 200, body: { detail: 'non-JSON response from Microburbs' }, requestId: 'x' };
  assert.equal(toSection(garbage, mapValuation).reason, 'upstream_error');
  assert.equal(toSection({ status: 200, body: null }, mapValuation).reason, 'upstream_error');
  // the documented no-data envelope, with or without reason/message, is still "no data"
  assert.equal(toSection({ status: 200, body: { data: null } }, mapValuation).reason, 'no_data');
  assert.equal(toSection({ status: 200, body: { data: null, available: false, reason: 'r1', message: 'm1' } }, mapValuation).message, 'm1');

  const client = fakeClient({ geo: { [TUDOR]: [row(TUDOR, 'GANSW705970502')] }, props: { 'valuation/avm': garbage } });
  const lookup = createLookup({ client });
  const a = await lookup(TUDOR);
  assert.equal(a.status, 'ok');
  assert.equal(a.sections.valuation.reason, 'upstream_error');
  assert.equal(a.sections.basics.reason, 'no_data'); // one bad section does not sink the others
  await lookup(TUDOR);
  assert.equal(count(client, 'valuation/avm'), 2); // refetched: not cached
  assert.equal(count(client, 'basics/all'), 1); // no-data envelope: cached

  const geoClient = fakeClient({ geo: { 'x street, y': () => garbage } });
  const g = createLookup({ client: geoClient });
  const out = await g('x street, y');
  assert.equal(out.status, 'error');
  assert.equal(out.error.code, 'upstream_unavailable');
  assert.equal(httpStatusFor(out), 502);
  await g('x street, y');
  assert.equal(count(geoClient, '/v1/geocode/address'), 2); // not cached as no_match
});

test('coverage filter: no-comma display_name, suffixed API names, wrong state or suburb rejected', () => {
  assert.equal(suburbFromDisplayName('26 Tudor Street Surry Hills'), 'Surry Hills');
  assert.equal(suburbFromDisplayName('Surry Hills'), 'Surry Hills');
  assert.equal(classifyCandidate(row('26 Tudor Street Surry Hills', 'GANSW705970502')).suburb.apiName, 'Surry Hills');
  assert.equal(classifyCandidate(row('3 King Street Newtown', 'GANSW1')).inCoverage, false);
  const names = {
    Camperdown: 'Camperdown (NSW)', Rosebery: 'Rosebery (NSW)', Beaconsfield: 'Beaconsfield (NSW)',
    'Centennial Park': 'Centennial Park (NSW)', 'WATERLOO': 'Waterloo (NSW)', 'the rocks': 'The Rocks (Sydney - NSW)',
  };
  for (const [shown, apiName] of Object.entries(names)) {
    assert.equal(classifyCandidate(row(`1 A Street, ${shown}`, 'GANSW1')).suburb.apiName, apiName, shown);
  }
  for (const s of ['Newtown', 'Bondi', 'Paddington', 'St Peters', 'Annandale']) {
    assert.equal(classifyCandidate(row(`1 A Street, ${s}`, 'GANSW1')).inCoverage, false, s);
  }
  assert.equal(classifyCandidate(row('1 A Street, Surry Hills', 'GAVIC1')).inCoverage, false);
  assert.equal(classifyCandidate(row('1 A Street, Surry Hills', 'GAQLD1')).inCoverage, false);
});

test('candidate choice: the right house in a neighbouring suburb beats a wrong house in the listed suburb', async () => {
  const q = '120 Crown Street, Surry Hills NSW 2010';
  const client = fakeClient({ geo: { [q]: [row('120 Crown Street, Darlinghurst', 'GANSW2'), row('12 Crown Street, Surry Hills', 'GANSW3')] } });
  const out = await createLookup({ client })(q);
  assert.equal(out.match.gnaf_id, 'GANSW2');
  assert.equal(out.match.check.verdict, 'partial');
  assert.equal(out.match.check.suburb, false);

  // the exact unit still beats the bare building, and the suburb still breaks a street + number tie
  const u = '5/120 Crown Street, Surry Hills NSW 2010';
  const c2 = fakeClient({ geo: { [u]: [row('120 Crown Street, Surry Hills', 'GANSW10'), row('5/120 Crown Street, Surry Hills', 'GANSW11')] } });
  assert.equal((await createLookup({ client: c2 })(u)).match.gnaf_id, 'GANSW11');
  const t = '1 Short Street, Waterloo NSW 2017';
  const c3 = fakeClient({ geo: { [t]: [row('1 Short Street, Surry Hills', 'GANSW20'), row('1 Short Street, Waterloo', 'GANSW21')] } });
  assert.equal((await createLookup({ client: c3 })(t)).match.gnaf_id, 'GANSW21');
});

test('backoff is bounded: a timeout is not retried and a long Retry-After returns the 429 at once', async () => {
  let tries = 0;
  const slow = withBackoff(async () => {
    tries++;
    const e = new Error('timed out');
    e.name = 'TimeoutError';
    throw e;
  }, { sleep: async () => {} });
  const r = await slow('/x');
  assert.equal(r.status, 0);
  assert.equal(r.error, 'timeout');
  assert.equal(tries, 1);

  const waits = [];
  let calls = 0;
  const longWait = withBackoff(async () => (calls++, { status: 429, retryAfter: '30', requestId: 'rl' }), { sleep: async (ms) => waits.push(ms) });
  assert.equal((await longWait('/x')).status, 429);
  assert.deepEqual(waits, []);
  assert.equal(calls, 1);

  // Retry-After: 1 keeps being honoured inside the budget
  const w2 = [];
  let n = 0;
  const short = withBackoff(async () => (++n <= 3 ? { status: 429, retryAfter: '1' } : { status: 200, body: { data: [] } }), { sleep: async (ms) => w2.push(ms) });
  assert.equal((await short('/x')).status, 200);
  assert.deepEqual(w2, [1000, 1000, 1000]);
});

test('DA same_street tolerates a placeholder house number; rows without lat/lng are skipped', () => {
  const das = [
    { area_name: 'XX Example Street', date: '2024-01-26', category: 'New Dwelling' },
    { area_name: '5 Other Lane', date: '2025-01-01' },
  ];
  const same = pickDa(das, { street: 'Example St' });
  assert.equal(same.data.basis, 'same_street');
  assert.equal(same.data.address, 'XX Example Street');
  // coordinates known but no row has any: falls back instead of failing
  assert.equal(pickDa(das, { lat: -33.88, lng: 151.21, street: 'Nowhere Road' }).data.basis, 'latest_in_suburb');
  const near = pickDa([{ area_name: 'a', lat: -33.8869, lng: 151.2098 }, { area_name: 'b' }], { lat: -33.8869, lng: 151.2098 });
  assert.equal(near.data.basis, 'nearest');
  assert.equal(near.data.distance_m, 0);
});

test('cache: TTL respected, cleaned-query retry at most once', async () => {
  let t = 0;
  const client = fakeClient({ geo: { [TUDOR]: [row(TUDOR, 'GANSW705970502')] } });
  const lookup = createLookup({ client, now: () => t, ttlMs: 1000 });
  await lookup(TUDOR);
  t = 999;
  assert.equal((await lookup(TUDOR)).cached, true);
  t = 2500;
  assert.equal((await lookup(TUDOR)).cached, false);
  assert.equal(count(client, '/v1/geocode/address'), 2);

  const none = fakeClient();
  const out = await createLookup({ client: none })('Unit 5, 12 Nowhere St, Nowhere NSW 2999');
  assert.equal(out.status, 'no_match');
  assert.equal(count(none, '/v1/geocode/address'), 2);
});

test('live client: query and path are encoded, the key only goes in the Authorization header', async () => {
  const seen = [];
  const KEY = 'test-key-never-echo-1234';
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), auth: init.headers.Authorization });
    return new Response('<html>oops</html>', { status: 200, headers: { 'x-request-id': 'rid-1' } });
  };
  const client = createLiveClient({ apiKey: KEY, baseUrl: 'https://example.invalid/', fetchImpl, sleep: async () => {} });
  const r = await client.get('/v1/geocode/address', { address: '5/120 Crown St & #?%, Surry Hills' });
  assert.equal(seen[0].url, 'https://example.invalid/v1/geocode/address?address=5%2F120+Crown+St+%26+%23%3F%25%2C+Surry+Hills');
  assert.equal(seen[0].auth, `Bearer ${KEY}`);
  assert.equal(r.status, 200);
  assert.ok(!JSON.stringify(r).includes(KEY));

  const lookup = createLookup({ client, mode: 'live' });
  const out = await lookup('26 Tudor Street, Surry Hills');
  assert.equal(out.mode, 'live');
  assert.equal(out.error.code, 'upstream_unavailable');
  assert.ok(!JSON.stringify(out).includes(KEY));
});

test('app: only /health and /lookup, no CORS headers; the Vercel entry imports without listening', async () => {
  const app = createApp({ mode: 'mock', lookup: async (a) => ({ status: 'ok', mode: 'mock', query: a }) });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const ok = await fetch(`${base}/lookup?address=${encodeURIComponent('5/120 Crown St & #?%')}`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).query, '5/120 Crown St & #?%');
    assert.equal(ok.headers.get('access-control-allow-origin'), null);
    assert.equal(ok.headers.get('x-powered-by'), null);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    for (const p of ['/', '/v1/geocode/address?address=x', '/lookup.json', '/api']) {
      assert.equal((await fetch(base + p)).status, 404, p);
    }
    assert.equal((await fetch(`${base}/lookup`, { method: 'POST' })).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  process.env.MOCK = '1';
  const vercel = (await import('../api/index.js')).default;
  assert.equal(typeof vercel, 'function');
  assert.equal(typeof vercel.listen, 'function');
});

test('a section whose client call throws only marks that section unavailable', async () => {
  const client = fakeClient({
    geo: { [TUDOR]: [row(TUDOR, 'GANSW705970502')] },
    props: {
      'valuation/avm': () => { throw new Error('boom'); },
      'rent-history-latest': () => undefined,
      'basics/all': { status: 200, body: { data: { bed_count: 2, bath_count: 1, parking_count: null, dwelling_type: 'unit', extra: 1 } } },
      'comparables/recent-sales-nearby': { status: 401, body: { detail: 'bad key' } },
    },
  });
  const out = await createLookup({ client })(TUDOR);
  assert.equal(out.status, 'ok');
  assert.equal(out.sections.valuation.reason, 'upstream_error');
  assert.equal(out.sections.rent.reason, 'upstream_error');
  assert.equal(out.sections.sales.reason, 'upstream_error');
  assert.deepEqual(out.sections.basics, { available: true, data: { bed_count: 2, bath_count: 1, parking_count: null, dwelling_type: 'unit', land_area_sqm: null } });

  const geoThrows = fakeClient({ geo: { [TUDOR]: () => { throw new Error('boom'); } } });
  const g = await createLookup({ client: geoThrows })(TUDOR);
  assert.equal(g.status, 'error');
  assert.equal(g.error.code, 'upstream_unavailable');
});
