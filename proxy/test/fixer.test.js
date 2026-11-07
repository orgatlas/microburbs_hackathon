// Fixer pass: the workplace can never hold the property's facts hostage, a work geocode must agree with what was
// typed, an amenities answer without counts is absent (not zeros), and the app shares identical upstream GETs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createMockClient } from '../src/client-mock.js';
import { createProfileFacts } from '../profile-facts.js';
import { shareClient } from '../src/app.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'mock.json');
const SUBJECT = 'GANSW705970502'; // mock: 26 Tudor Street, Surry Hills
const WORK_ID = 'GANSW700000188'; // mock: 188 Pitt Street, Sydney
const mock = () => createMockClient({ fixturesPath: FIXTURES, latencyMs: [0, 1] });
const args = (workAddress) => ({ gnafId: SUBJECT, suburb: 'Surry Hills', propertyType: 'unit', workAddress });

test('work: located from transport/nearby first; matched street and suburb accepted', async () => {
  const f = await createProfileFacts({ client: mock() }).getFacts(args('188 Pitt Street, Sydney'));
  assert.equal(f.work.display_name, '188 Pitt Street, Sydney');
  assert.equal(f.work.via[1], '/v1/properties/{gnaf_id}/transport/nearby');
  assert.ok(Number.isFinite(f.work.distance_m));
  assert.equal(f.missing.work, undefined);
});

test('work: a slow workplace times out alone; every property fact still arrives', async () => {
  const base = mock();
  const slow = {
    get: (p, q) =>
      p.includes(WORK_ID) ? new Promise((r) => setTimeout(() => r({ status: 0, body: null, error: 'timeout' }), 1500)) : base.get(p, q),
  };
  const t0 = Date.now();
  const f = await createProfileFacts({ client: slow, workWaitMs: 200 }).getFacts(args('188 Pitt Street, Sydney'));
  assert.ok(Date.now() - t0 < 1200, 'did not wait for the slow workplace');
  assert.equal(f.missing.work, 'upstream_error:timeout');
  assert.equal(f.work, undefined);
  for (const k of ['location', 'rent_advert', 'transport', 'amenities', 'avm']) assert.ok(f[k], k + ' present');
});

test('work: a same-name street inside the city never stands in for a workplace outside it', async () => {
  const base = mock();
  const geo = {
    get: (p, q) =>
      p === '/v1/geocode/address' && /parramatta/i.test(q.address)
        ? Promise.resolve({
            status: 200,
            body: { data: [
              { id: 'GANSW000000001', display_name: '10 George Street, Parramatta NSW 2150' },
              { id: WORK_ID, display_name: '10 George Street, Redfern NSW 2016' },
            ] },
          })
        : base.get(p, q),
  };
  const f = await createProfileFacts({ client: geo }).getFacts(args('10 George Street, Parramatta NSW 2150'));
  assert.equal(f.work, undefined);
  assert.equal(f.missing.work, 'outside_coverage');
});

test('amenities: an answer without usable counts is absent, never a row of zeros', async () => {
  const base = mock();
  for (const data of [{ radius_m: 1000, results: [] }, { radius_m: 1000, counts: {} }, { radius_m: 1000, counts: { restaurant: null } }]) {
    const c = { get: (p, q) => (p.endsWith('amenities/nearby') ? Promise.resolve({ status: 200, body: { data, available: true } }) : base.get(p, q)) };
    const f = await createProfileFacts({ client: c }).getFacts(args(''));
    assert.equal(f.amenities, undefined, JSON.stringify(data));
    assert.equal(f.missing.amenities, 'no_data:no_counts');
  }
});

test('shareClient: identical GETs in flight or answered 200 hit upstream once; errors are not kept', async () => {
  const calls = [];
  const raw = {
    get: async (p, q) => {
      calls.push(p);
      await new Promise((r) => setTimeout(r, 5));
      return p.includes('fail') ? { status: 502, body: null } : { status: 200, body: { data: { p }, available: true } };
    },
  };
  const c = shareClient(raw);
  await Promise.all([c.get('/a'), c.get('/a'), c.get('/a', {})]);
  await c.get('/a');
  assert.equal(calls.filter((x) => x === '/a').length, 1);
  await c.get('/a', { radius_m: 2000 });
  assert.equal(calls.filter((x) => x === '/a').length, 2, 'a different query is a different call');
  await c.get('/fail');
  await c.get('/fail');
  assert.equal(calls.filter((x) => x === '/fail').length, 2, 'a 502 is not shared after it lands');
});
