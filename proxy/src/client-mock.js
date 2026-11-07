// Mock Microburbs client: same interface as the live client, served from fixtures/mock.json.
// Values are invented and only shaped like the documented envelopes. Scenario keywords in the geocode address
// (case-insensitive): nodata, bondi, zzzz, error500, rate429, "pitt street" / "pitt st" (Sarah's workplace,
// 188 Pitt Street, Sydney); anything else -> the default Surry Hills subject (26 Tudor Street).
// Routing: /v1/properties/{id}/{endpoint} -> fixtures.properties[id][endpoint] and
// /v1/suburbs/{name}/{endpoint} -> fixtures.suburbs[name][endpoint] (exact names, query ignored);
// anything missing -> the HTTP 200 no-data envelope, as the live API does.
import fs from 'node:fs';
import { withBackoff } from './client-live.js';

const NO_DATA_REASONS = {
  'basics/all': ['no_basics_for_', 'No property basics for '],
  'valuation/avm': ['no_avm_for_', 'No AVM for '],
  'comparables/recent-sales-nearby': ['no_comparables_for_', 'No recent sales nearby for '],
  'rent-history-latest': ['no_rent_history_for_', 'No rent advert for '],
  'transport/nearby': ['no_transport_for_', 'No transport data for '],
  'amenities/nearby': ['no_amenities_for_', 'No amenities data for '],
  'risks/flood': ['no_flood_for_', 'No flood overlay data for '],
  'surroundings/properties': ['no_surroundings_for_', 'No surrounding properties for '],
  'development/da-list': ['no_das_for_', 'No development applications for '],
  'crime/by-mesh-block': ['no_crime_by_mesh_block_for_', 'No mesh-block crime rates for '],
  'crime/summary': ['no_crime_summary_for_', 'No crime summary for '],
  'shapes/busy-roads': ['no_busy_roads_for_', 'No busy-road segments for '],
  'market/vacancy-map': ['no_vacancy_map_for_', 'No mesh-block vacancy rates for '],
  'market/vacancy-rate': ['no_vacancy_rate_for_', 'No rental vacancy rate for '],
  'market/rent-map': ['no_rent_map_for_', 'No mesh-block rents for '],
  'market/median-rent': ['no_median_rent_for_', 'No median rent for '],
};
const WORK_ADDRESS = /\bpitt\s+st(reet)?\b/;

function noData(endpoint, subject) {
  const [reason, message] = NO_DATA_REASONS[endpoint] || ['no_data_for_', 'No data for '];
  return { data: null, available: false, reason: reason + subject.replace(/\s+/g, '_'), message: message + subject };
}

export function createMockClient({ fixturesPath, latencyMs = [120, 350], sleep, random = Math.random } = {}) {
  const fx = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
  const tripped = new Set();
  let counter = 0;
  const [lo, hi] = latencyMs;
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  function reply(status, body, extra = {}) {
    counter++;
    return { status, body, requestId: `mock-${String(counter).padStart(4, '0')}`, ...extra };
  }

  function route(path, query) {
    const clean = String(path).split('?')[0];

    if (clean === '/v1/geocode/address') {
      const q = String((query && query.address) || '').toLowerCase();
      if (q.includes('error500')) return reply(500, { detail: 'Internal Server Error (mock)' });
      if (q.includes('rate429') && !tripped.has(q)) {
        tripped.add(q);
        return reply(429, { detail: 'Too Many Requests (mock)' }, { retryAfter: '1' });
      }
      if (q.includes('zzzz')) return reply(200, fx.geocode.zzzz);
      if (q.includes('nodata')) return reply(200, fx.geocode.nodata);
      if (q.includes('bondi')) return reply(200, fx.geocode.bondi);
      if (WORK_ADDRESS.test(q)) return reply(200, fx.geocode.work);
      return reply(200, fx.geocode.default);
    }

    if (clean === '/v1/suburbs/list') return reply(200, fx.suburbs_list);

    let m = clean.match(/^\/v1\/properties\/([^/]+)\/(.+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const endpoint = m[2];
      const prop = fx.properties[id];
      const body = prop && prop[endpoint];
      return reply(200, body || noData(endpoint, id));
    }

    m = clean.match(/^\/v1\/suburbs\/([^/]+)\/(.+)$/);
    if (m) {
      const suburb = decodeURIComponent(m[1]);
      const endpoint = m[2];
      const sub = fx.suburbs[suburb];
      const body = sub && sub[endpoint];
      return reply(200, body || noData(endpoint, suburb));
    }

    return reply(404, { detail: 'Not Found (mock)' });
  }

  async function rawGet(path, query) {
    const ms = hi > lo ? lo + Math.floor(random() * (hi - lo)) : lo;
    if (ms > 0) await wait(ms);
    // structuredClone so callers can never mutate the fixtures.
    return structuredClone(route(path, query));
  }

  return { get: withBackoff(rawGet, { sleep: wait }), mock: true };
}
