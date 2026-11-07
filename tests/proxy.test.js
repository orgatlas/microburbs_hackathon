const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { mkdtemp, writeFile, unlink, rmdir } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

const asOf = '2026-11-07';
const gnaf = (id) => `GANSW9${String(id).padStart(8, '0')}`;
const record = (id, display_name) => ({ gnaf_id: gnaf(id), display_name });
const records = [
  record(1, 'UNIT 105/8 Sam Sing Street, Waterloo (NSW)'),
  record(2, 'UNIT 110/11 Wigram Lane, Glebe (NSW)'),
  record(3, 'UNIT 504/349-355 Bulwara Road, Ultimo'),
  record(4, '8-10 Young Street, Redfern'),
  record(5, '8 Darling Island Road, Pyrmont'),
  record(6, 'UNIT 801/8 Darling Island Road, Pyrmont'),
  record(7, 'UNIT 802/8 Darling Island Road, Pyrmont'),
  record(9, '12 Botany Road, Alexandria'),
];

let server;
let dataDir;
const geocoded = [];
before(async () => {
  const { createApp } = await import('../proxy/server.js');
  const { ApiError } = await import('../proxy/cache.js');
  dataDir = await mkdtemp(join(tmpdir(), 'fit-proxy-tests-'));
  const addressFile = join(dataDir, 'addresses.csv');
  const flagsFile = join(dataDir, 'flags.csv');
  await writeFile(addressFile, ['gnaf_id,display_name', ...records.map(({ gnaf_id, display_name }) => `${gnaf_id},"${display_name}"`)].join('\n'));
  await writeFile(flagsFile, `gnaf_id,public_housing\n${gnaf(6)},true\n${gnaf(7)},false\n`);
  const env = { MICROBURBS_ADDRESSES_CSV: addressFile, MICROBURBS_SOCIAL_HOUSING_CSV: flagsFile };
  const app = createApp({ env, today: () => asOf, client: { async get(path, params) {
    if (path === '/v1/geocode/address') {
      const address = params.address.toLowerCase();
      geocoded.push(address);
      if (address.includes('chippendale')) throw new Error('Synthetic network failure');
      if (address.includes('zetland')) throw new ApiError(403);
      if (address.includes('surry hills')) return { data: [
        { id: gnaf(81), sal: 'Bondi', display_name: '342 Bourke Street, Bondi' },
        { id: gnaf(82), sal: 'Surry Hills', display_name: 'UNIT 9/342 Bourke Street, Surry Hills' },
        { id: gnaf(83), sal: 'Surry Hills', display_name: 'UNIT 8/342 Bourke Street, Surry Hills' },
      ] };
      return { data: null, available: false };
    }
    if (path === `/v1/properties/${gnaf(9)}/basics/parking-count`) return { data: { parking_count: 0 } };
    return { data: null, available: false };
  } } });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
});

after(async () => {
  if (server) await new Promise((done) => server.close(done));
  if (dataDir) {
    await Promise.all(['addresses.csv', 'flags.csv'].map((file) => unlink(join(dataDir, file)).catch(() => {})));
    await rmdir(dataDir);
  }
});

async function lookup(address, work) {
  const query = new URLSearchParams({ address });
  if (work) query.set('work', work);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/lookup?${query}`, { signal: AbortSignal.timeout(5000) });
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['facts', 'matched', 'outsideCoverage']);
  assert.deepEqual(Object.keys(body.facts).sort(), ['commute', 'lifestyle', 'price', 'safety']);
  if (body.matched !== null) {
    assert.deepEqual(Object.keys(body.matched).sort(), ['candidates', 'confidence', 'display_name', 'gnaf_id', 'suburb']);
    assert.ok(Array.isArray(body.matched.candidates));
    for (const candidate of body.matched.candidates) {
      assert.deepEqual(Object.keys(candidate).sort(), ['display_name', 'gnaf_id']);
    }
  }
  const signals = Object.values(body.facts).flatMap(Object.values);
  assert.equal(signals.length, 18);
  for (const signal of signals) {
    assert.equal(typeof signal.available, 'boolean');
    assert.equal(signal.asOf, asOf);
    for (const field of ['label', 'source', 'unit']) assert.equal(typeof signal[field], 'string');
    assert.deepEqual(Object.keys(signal).sort(), ['asOf', 'available', 'label', 'source', 'unit', ...(signal.available ? ['value'] : [])]);
    if (signal.available) assert.ok(Number.isFinite(signal.value));
  }
  return { status: response.status, ...body };
}

async function exact(input, id, work) {
  const result = await lookup(input, work);
  assert.equal(result.status, 200);
  assert.equal(result.outsideCoverage, false);
  assert.equal(result.matched?.confidence, 'exact');
  assert.equal(result.matched.gnaf_id, gnaf(id));
  return result;
}

test('Waterloo: explicit Unit and St abbreviation hit the local index', async () => {
  await exact('Unit 105, 8 Sam Sing St, Waterloo NSW 2017', 1);
  assert.ok(!geocoded.some((query) => query.includes('sam sing')));
});

test('Glebe: slash-format unit and suburb suffix match', () => exact('110/11 Wigram Lane, Glebe NSW 2037', 2));

test('Ultimo: Level prefix preserves the unit and range', () => exact('Level 5, 504/349-355 Bulwara Rd, Ultimo NSW', 3));

test('Redfern: en-dash street range normalizes to the indexed range', () => exact('8–10 Young St, Redfern NSW 2016', 4));

test('Bondi: a declared outside suburb returns 403', async () => {
  const result = await lookup('9 Beach Road, Bondi NSW 2026');
  assert.equal(result.status, 403);
  assert.equal(result.outsideCoverage, true);
  assert.equal(result.matched, null);
});

test('Pyrmont: known building and unknown unit show real alternatives', async () => {
  const result = await lookup('999/8 Darling Island Road, Pyrmont NSW 2009');
  assert.equal(result.status, 200);
  assert.equal(result.matched?.confidence, 'building');
  assert.ok(result.matched.candidates.some((candidate) => candidate.gnaf_id === gnaf(6)));
  assert.ok(result.matched.candidates.some((candidate) => candidate.gnaf_id === gnaf(7)));
  assert.equal(result.facts.commute.parking.available, false);
  assert.equal(result.facts.safety.socialHousing.value, 50);
  assert.match(result.facts.safety.socialHousing.label, /building.*estimate/i);
});

test('Surry Hills: matching parts beat higher ranked wrong suburb and unit', () => exact('8/342 Bourke St, Surry Hills NSW 2010', 83));

test('Chippendale: a geocoder failure is an HTTP 200 no-data result', async () => {
  const result = await lookup('11 Blackfriars Street, Chippendale NSW 2008');
  assert.equal(result.status, 200);
  assert.equal(result.outsideCoverage, false);
  assert.equal(result.matched, null);
});

test('Alexandria: parking zero is available despite missing rent and a work geocode 403', async () => {
  const result = await exact('12 Botany Rd, Alexandria NSW 2015', 9, '59 Portman Street, Zetland NSW 2017');
  assert.equal(result.facts.commute.parking.value, 0);
  assert.equal(result.facts.commute.workDistance.available, false);
  assert.equal(result.facts.price.rentAffordability.available, false);
});

test('Zetland: upstream 403 is propagated as outside coverage', async () => {
  const result = await lookup('59 Portman Street, Zetland NSW 2017');
  assert.equal(result.status, 403);
  assert.equal(result.outsideCoverage, true);
  assert.equal(result.matched, null);
});
