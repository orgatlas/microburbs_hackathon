import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLookup, classifyCandidate, toSection, mapSales, mapValuation, pickDa, httpStatusFor } from '../src/lookup.js';
import { withBackoff, backoffDelay } from '../src/client-live.js';
import { createMockClient } from '../src/client-mock.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(here, '..', 'fixtures', 'mock.json');
const fastMock = () => createMockClient({ fixturesPath, latencyMs: [0, 0], sleep: async () => {} });

// A fake client: geocode answers from a table, every property/suburb endpoint answers from `props`.
function fakeClient({ geocode = {}, props = {} } = {}) {
  const calls = [];
  return {
    calls,
    async get(p, query) {
      calls.push(p);
      if (p === '/v1/geocode/address') {
        const rows = geocode[query.address];
        return rows === undefined ? { status: 200, body: { data: [] }, requestId: 'r1' } : typeof rows === 'function' ? rows() : { status: 200, body: { data: rows }, requestId: 'r1' };
      }
      for (const [suffix, res] of Object.entries(props)) if (p.endsWith(suffix)) return res;
      return { status: 200, body: { data: null, available: false, reason: 'no_data', message: 'No data' }, requestId: 'r2' };
    },
  };
}
const row = (display_name, id, property_type = 'unit') => ({ display_name, id, property_type, abbr: display_name.toUpperCase(), name: display_name });

test('coverage filter: exact API names, NSW only, the 29 only', () => {
  assert.equal(classifyCandidate(row('1 Glebe Point Road, Glebe', 'GANSW700000002')).suburb.apiName, 'Glebe (NSW)');
  assert.equal(classifyCandidate(row('1 George Street, The Rocks', 'GANSW700000003')).suburb.apiName, 'The Rocks (Sydney - NSW)');
  assert.equal(classifyCandidate(row('1 Golden Grove Street, Darlington', 'GANSW700000004')).suburb.apiName, 'Darlington (Sydney - NSW)');
  assert.equal(classifyCandidate(row('1 Elizabeth Street, Waterloo', 'GANSW700000005')).suburb.label, 'Waterloo');

  const padd = classifyCandidate(row('26 Tudor Street, Paddington', 'GANSW700000006'));
  assert.equal(padd.inCoverage, false);
  assert.equal(padd.why, 'Outside City of Sydney (Paddington)');

  const qld = classifyCandidate(row('26 Tudor Street, Surry Hills', 'GAQLD700000007'));
  assert.equal(qld.inCoverage, false);
  assert.equal(qld.why, 'Outside City of Sydney (QLD)');
});

test('the exact unit is preferred over the bare building', async () => {
  const q = '5/120 Crown Street, Surry Hills NSW 2010';
  const client = fakeClient({
    geocode: { [q]: [row('120 Crown Street, Surry Hills', 'GANSW700000010', 'building'), row('5/120 Crown Street, Surry Hills', 'GANSW700000011')] },
  });
  const out = await createLookup({ client })(q);
  assert.equal(out.status, 'ok');
  assert.equal(out.match.gnaf_id, 'GANSW700000011');
  assert.equal(out.match.rank, 2);
  assert.equal(out.match.check.verdict, 'exact');
  assert.equal(out.candidates[0].why_skipped, 'Another candidate matched the listing text better');
});

test('outside coverage and no match', async () => {
  const client = fakeClient({ geocode: { '1 Oxford Street, Paddington NSW 2021': [row('1 Oxford Street, Paddington', 'GANSW700000020')] } });
  const lookup = createLookup({ client });
  const out = await lookup('1 Oxford Street, Paddington NSW 2021');
  assert.equal(out.status, 'outside_coverage');
  assert.equal(out.sections, null);
  assert.equal(out.candidates[0].why_skipped, 'Outside City of Sydney (Paddington)');
  // one retry with the cleaned query happened
  assert.equal(client.calls.filter((c) => c === '/v1/geocode/address').length, 2);

  const none = await lookup('zzzz zzzz');
  assert.equal(none.status, 'no_match');
  assert.deepEqual(none.candidates, []);

  const bad = await lookup('  a ');
  assert.equal(bad.status, 'error');
  assert.equal(bad.error.code, 'bad_request');
  assert.equal(httpStatusFor(bad), 400);
});

test('envelope -> section mapping', () => {
  assert.deepEqual(toSection({ status: 200, body: { data: null, available: false, reason: 'no_avm_for_X', message: 'No AVM for X' } }, mapValuation), {
    available: false, reason: 'no_avm_for_X', message: 'No AVM for X',
  });
  assert.equal(toSection({ status: 403, body: { detail: 'Outside coverage' } }, mapValuation).reason, 'outside_coverage');
  assert.deepEqual(toSection({ status: 503, body: null }, mapValuation), { available: false, reason: 'upstream_error', message: 'Microburbs did not answer (HTTP 503)' });

  const sales = toSection({ status: 200, body: { data: [{ dist_km: 0.41 }, { dist_km: null, address: 'x' }, { dist_km: 0.065 }, { dist_km: 0.22 }, { dist_km: 0.12 }] } }, mapSales);
  assert.deepEqual(sales.data.map((s) => s.dist_km), [0.065, 0.12, 0.22]);
  assert.deepEqual(Object.keys(sales.data[0]).sort(), ['address', 'bathrooms', 'bedrooms', 'date_sold', 'dist_km', 'price', 'property_type']);

  const das = [
    { area_name: '1 Far Street', date: '2026-10-01', lat: -33.8, lng: 151.3 },
    { area_name: '30 Tudor Street', date: '2026-06-01', lat: null, lng: null },
    { area_name: '3 Near Lane', date: '2026-05-01', lat: -33.8858, lng: 151.2104 },
  ];
  const near = pickDa(das, { lat: -33.8869, lng: 151.2098, street: 'Tudor Street' });
  assert.equal(near.data.basis, 'nearest');
  assert.equal(near.data.address, '3 Near Lane');
  assert.ok(near.data.distance_m > 100 && near.data.distance_m < 150);
  assert.equal(pickDa(das, { street: 'Tudor St' }).data.basis, 'same_street');
  const latest = pickDa(das, { street: 'Nowhere Road' });
  assert.equal(latest.data.basis, 'latest_in_suburb');
  assert.equal(latest.data.distance_m, null);
});

test('429 backoff: honours Retry-After, gives up after 4 attempts', async () => {
  const waits = [];
  let n = 0;
  const flaky = withBackoff(async () => (++n <= 2 ? { status: 429, retryAfter: n === 1 ? '1' : null } : { status: 200, body: { data: [] }, requestId: 'ok' }), {
    sleep: async (ms) => waits.push(ms),
    random: () => 0,
  });
  const r = await flaky('/v1/geocode/address', { address: 'x' });
  assert.equal(r.status, 200);
  assert.deepEqual(waits, [1000, 800]);

  let calls = 0;
  const always = withBackoff(async () => (calls++, { status: 429, retryAfter: null, requestId: 'rl' }), { sleep: async () => {} });
  const r2 = await always('/x');
  assert.equal(r2.status, 429);
  assert.equal(calls, 4);
  assert.equal(backoffDelay(null, 2, () => 0), 1600);

  // network error: retried once, then status 0
  let tries = 0;
  const down = withBackoff(async () => { tries++; throw new TypeError('fetch failed'); }, { sleep: async () => {} });
  assert.equal((await down('/x')).status, 0);
  assert.equal(tries, 2);

  // a lookup whose geocode stays rate limited -> upstream_rate_limited, HTTP 502
  const client = fakeClient({ geocode: { '26 Tudor Street, Surry Hills': () => ({ status: 429, body: {}, requestId: 'req-429' }) } });
  const out = await createLookup({ client })('26 Tudor Street, Surry Hills');
  assert.equal(out.error.code, 'upstream_rate_limited');
  assert.equal(out.error.request_id, 'req-429');
  assert.equal(httpStatusFor(out), 502);
});

test('mock end to end, and a repeat lookup returns cached:true', async () => {
  const lookup = createLookup({ client: fastMock(), mode: 'mock' });
  const a = await lookup('26 Tudor Street, Surry Hills NSW 2010');
  assert.equal(a.status, 'ok');
  assert.equal(a.cached, false);
  assert.equal(a.match.gnaf_id, 'GANSW705970502');
  assert.equal(a.match.rank, 2);
  assert.equal(a.candidates[0].why_skipped, 'Outside City of Sydney (QLD)');
  assert.equal(a.sections.valuation.data.predicted_price, 1125000);
  assert.equal(a.sections.da.data.basis, 'nearest');
  const b = await lookup('26 Tudor Street, Surry Hills NSW 2010');
  assert.equal(b.cached, true);
  assert.deepEqual(b.sections, a.sections);

  const nd = await lookup('nodata');
  assert.equal(nd.status, 'ok');
  for (const s of Object.values(nd.sections)) assert.equal(s.available, false);

  assert.equal((await lookup('10 Campbell Parade, Bondi Beach NSW 2026')).status, 'outside_coverage');
  assert.equal((await lookup('zzzz')).status, 'no_match');
  assert.equal((await lookup('error500')).error.code, 'upstream_unavailable');
  assert.equal((await lookup('rate429')).status, 'ok');
});
