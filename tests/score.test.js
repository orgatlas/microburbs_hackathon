'use strict';
// Unit tests for extension/panel/score.js (SCORING TABLE v1, see docs/SCORING.md).
// Written independently from the table, as the check on score.js. Every expected number is
// hand-computed from the table; the arithmetic sits in a comment next to each assertion.
// Fixtures are made up and shaped like the FACTS CONTRACT (no API output is stored here).
// Run from the repo root: node --test tests/score.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const score = require('../extension/panel/score.js');

const OPTS = { now: '2026-11-07' };
const ORDER = ['affordability', 'commute', 'safety', 'liveliness', 'quiet', 'negotiability'];
const LABELS = {
  affordability: 'Affordability', commute: 'Commute', safety: 'Safety',
  liveliness: 'Liveliness', quiet: 'Quiet', negotiability: 'Negotiability',
};
const PRIORITY_OF = {
  affordability: 'cheap', commute: 'close_to_work', safety: 'safe',
  liveliness: 'lively', quiet: 'quiet', negotiability: 'negotiable',
};
const ITEM_LABEL = {
  affordability: { halo: 'Affordable', failo: 'Unaffordable' },
  commute_work: { halo: 'Close to work', failo: 'Long commute' },
  commute_transit: { halo: 'Good transit', failo: 'Poor transit' },
  safety: { halo: 'Lower crime', failo: 'Higher crime' },
  liveliness: { halo: 'Lively', failo: 'Few amenities' },
  quiet: { halo: 'Quiet street', failo: 'Busy road nearby' },
  negotiability: { halo: 'Room to negotiate', failo: 'Tight market' },
};

// Endpoint templates, as the proxy writes them into `via`.
const VIA = {
  location: ['/v1/properties/{gnaf_id}/context/mesh-blocks'],
  rent_advert: '/v1/properties/{gnaf_id}/rent-history-latest',
  rent_estimate: '/v1/suburbs/{suburb_name}/market/rent-map',
  transport: '/v1/properties/{gnaf_id}/transport/nearby',
  crime: ['/v1/suburbs/{suburb_name}/crime/by-mesh-block', '/v1/suburbs/{suburb_name}/crime/summary'],
  amenities: '/v1/properties/{gnaf_id}/amenities/nearby',
  busy_road: '/v1/suburbs/{suburb_name}/shapes/busy-roads',
  flood: '/v1/properties/{gnaf_id}/risks/flood',
  vacancy: ['/v1/suburbs/{suburb_name}/market/vacancy-map', '/v1/suburbs/{suburb_name}/market/vacancy-rate'],
  avm: '/v1/properties/{gnaf_id}/valuation/avm',
  work: ['/v1/geocode/address'],
};
const CRIME_UNIT = 'predicted incidents per 100,000 residents per year';
const FETCHED = '2026-11-07T00:30:00.000Z';

// Work fact for 188 Pitt Street. Every fixture location sits on the SAME longitude as work, so the
// haversine distance is exactly R * dLat (radians): no trigonometry needed to hand-check it, and
// the expected scores below hold for any Earth radius between 6371 and 6378.137 km.
const WORK = { display_name: '188 Pitt Street, Sydney NSW 2000', lat: -33.8705, lng: 151.2080, via: VIA.work };

// ---------------------------------------------------------------------------------------------
// Profiles and fixtures
// ---------------------------------------------------------------------------------------------
function sarah(overrides) {
  return Object.assign({
    version: 1, name: 'Sarah', about: '19 · casual retail',
    budget: { mode: 'rent', max_rent_week: 250, max_price: null },
    income_week: 600,
    work_address: '188 Pitt Street, Sydney NSW 2000',
    priorities: ['cheap', 'close_to_work', 'safe'],
  }, overrides || {});
}
function buyer(overrides) {
  return Object.assign({
    version: 1, name: 'Buyer', about: 'test buyer',
    budget: { mode: 'buy', max_rent_week: null, max_price: 1000000 },
    income_week: 2000,
    work_address: '188 Pitt Street, Sydney NSW 2000',
    priorities: ['cheap'],
  }, overrides || {});
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function shell(gnaf, suburb, extra) {
  return Object.assign({ gnaf_id: gnaf, suburb: suburb, property_type: 'unit', fetched_at: FETCHED, missing: {} }, extra);
}

// Fixture 1: a cheap share-house room in Surry Hills that HALOS for Sarah.
const HALO = {
  gnaf_id: 'GANSW000000001', suburb: 'Surry Hills', property_type: 'unit', fetched_at: FETCHED,
  location: { lat: -33.8890, lng: 151.2080, mesh_block: '11205258900', via: VIA.location },
  rent_advert: { weekly_rent: 165, date: '2026-08-20', via: VIA.rent_advert, as_of: '2026-08-20' },
  // A fresh advert must win over the estimate (400 would make Sarah fail affordability).
  rent_estimate: { weekly_rent: 400, basis: 'mesh_block', property_type: 'unit', via: VIA.rent_estimate, as_of: '2026-10' },
  transport: { radius_m: 1500, nearest: { train: { distance_m: 450, label: 'Central' }, bus: { distance_m: 60, label: 'Crown St' } }, via: VIA.transport },
  crime: { rate: 2240, basis: 'mesh_block', suburb_median: 3360, national_median: 2800, verdict: 'Below average', unit: CRIME_UNIT, via: VIA.crime, as_of: '2020-22 model' },
  amenities: { radius_m: 1000, counts: { restaurant: 20, supermarket: 2, green_spaces: 2 }, nearest: [{ category: 'supermarket', name: 'Supermarket', distance_m: 220 }], via: VIA.amenities },
  busy_road: { nearest_m: 300, road_class: 'primary', segments: 3, via: VIA.busy_road },
  flood: { on_property: false, nearest_m: 420, via: VIA.flood },
  vacancy: { block_pct: 3.0, suburb_pct: 2.0, property_type: 'unit', via: VIA.vacancy, as_of: '2026-10' },
  work: WORK,
  missing: { avm: 'not_requested' },
};

// Fixture 2: a $780/wk Zetland apartment that FAILS AFFORDABILITY for Sarah.
const FAIL = {
  gnaf_id: 'GANSW000000002', suburb: 'Zetland', property_type: 'unit', fetched_at: FETCHED,
  // dLat to work = 33.908272 - 33.8705 = 0.037772 deg -> 6371 * 0.037772 * pi/180 = 4.20005 km
  location: { lat: -33.908272, lng: 151.2080, via: VIA.location },
  rent_advert: { weekly_rent: 780, date: '2026-09-15', via: VIA.rent_advert, as_of: '2026-09-15' },
  transport: { radius_m: 1500, nearest: { train: { distance_m: 1200, label: 'Green Square' }, bus: { distance_m: 250, label: 'Bus stop' } }, via: VIA.transport },
  crime: { rate: 6160, basis: 'mesh_block', suburb_median: 4480, national_median: 2800, verdict: 'Above average', unit: CRIME_UNIT, via: VIA.crime, as_of: '2020-22 model' },
  amenities: { radius_m: 1000, counts: { restaurant: 12, supermarket: 1, green_spaces: 0 }, via: VIA.amenities },
  busy_road: { nearest_m: 40, road_class: 'trunk', segments: 5, via: VIA.busy_road },
  flood: { on_property: false, via: VIA.flood },
  work: WORK,
  missing: { rent_estimate: 'no_data:no_rent_map_for_Zetland', vacancy: 'no_data:no_vacancy_for_Zetland', avm: 'not_requested' },
};

// Fixture 3: every fact absent.
const EMPTY = shell('GANSW000000003', 'Waterloo (NSW)', {
  property_type: null,
  missing: {
    location: 'upstream_error:502', rent_advert: 'no_data:no_rent_for_GANSW000000003', rent_estimate: 'mesh_block_unknown',
    transport: 'upstream_error:502', crime: 'upstream_error:502', amenities: 'upstream_error:502', busy_road: 'upstream_error:502',
    flood: 'upstream_error:502', vacancy: 'no_data:no_vacancy_for_Waterloo', avm: 'not_requested', work: 'not_requested',
  },
});

// Only amenities and busy road are present (liveliness 80, quiet 90).
const PARTIAL = shell('GANSW000000004', 'Redfern', {
  amenities: { radius_m: 1000, counts: { restaurant: 20, supermarket: 2, green_spaces: 2 }, via: VIA.amenities },
  busy_road: { nearest_m: 300, road_class: 'secondary', segments: 4, via: VIA.busy_road },
  missing: { rent_advert: 'no_data:x', rent_estimate: 'no_data:x', transport: 'upstream_error:502', crime: 'upstream_error:502', vacancy: 'no_data:x', flood: 'upstream_error:502', location: 'upstream_error:502', work: 'not_requested', avm: 'not_requested' },
});

// Three scored dimensions with distinct scores, for the weight arithmetic:
//   liveliness A = 20 + 3*2 + 2*2 = 30 -> anchor (30,80) -> 80
//   quiet D = 50 m (primary) -> anchor (50,30) -> 30
//   negotiability V = block 2.0 (no suburb_pct, so no modifier) -> anchor (2.0,55) -> 55
const W = shell('GANSW000000005', 'Glebe', {
  amenities: { radius_m: 1000, counts: { restaurant: 20, supermarket: 2, green_spaces: 2 }, via: VIA.amenities },
  busy_road: { nearest_m: 50, road_class: 'primary', segments: 2, via: VIA.busy_road },
  vacancy: { block_pct: 2.0, property_type: 'unit', via: VIA.vacancy, as_of: '2026-10' },
  missing: { rent_advert: 'no_data:x', transport: 'upstream_error:502', crime: 'upstream_error:502', flood: 'upstream_error:502', work: 'not_requested', avm: 'not_requested' },
});

// Ordering fixture: picked items must come before unpicked ones regardless of score.
const ORDERING = {
  gnaf_id: 'GANSW000000006', suburb: 'Surry Hills', property_type: 'unit', fetched_at: FETCHED,
  location: { lat: -33.8890, lng: 151.2080, via: VIA.location },
  rent_advert: { weekly_rent: 165, date: '2026-08-20', via: VIA.rent_advert, as_of: '2026-08-20' },
  transport: { radius_m: 1500, nearest: { train: { distance_m: 450 } }, via: VIA.transport },
  crime: { rate: 11200, basis: 'mesh_block', suburb_median: 11200, national_median: 2800, unit: CRIME_UNIT, via: VIA.crime, as_of: '2020-22 model' },
  amenities: { radius_m: 1000, counts: {}, via: VIA.amenities },
  busy_road: { nearest_m: 50, road_class: 'primary', segments: 2, via: VIA.busy_road },
  vacancy: { block_pct: 5.0, via: VIA.vacancy, as_of: '2026-10' },
  work: WORK,
  missing: { flood: 'upstream_error:502', avm: 'not_requested' },
};

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
function run(facts, profile, opts) { return score.scoreListing(facts, profile, opts || OPTS); }
function dim(res, key) {
  const d = res.dimensions.find((x) => x.key === key);
  assert.ok(d, 'dimension ' + key + ' present');
  return d;
}
function scoresOf(res) {
  const out = {};
  for (const d of res.dimensions) out[d.key] = d.score;
  return out;
}
function near(actual, expected, msg) {
  assert.equal(typeof actual, 'number', (msg || '') + ' should be a number, got ' + actual);
  assert.ok(Math.abs(actual - expected) < 1e-6, (msg || '') + ' expected ' + expected + ', got ' + actual);
}
function bandOf(s) { return s === null ? null : s >= 70 ? 'halo' : s < 40 ? 'failo' : 'meh'; }
function viaList(v) { return Array.isArray(v) ? v : [v]; }
function hasVia(d, v) {
  for (const one of viaList(v)) assert.ok(d.via.includes(one), d.key + '.via ' + JSON.stringify(d.via) + ' should include ' + one);
}
function keysOf(x) {
  if (Array.isArray(x)) return x.map((p) => (typeof p === 'string' ? p : (p && (p.key || p.id || p.value))));
  return Object.keys(x || {});
}
// Walks the whole result: no NaN number anywhere, no "NaN"/"undefined"/"Infinity" in any string.
function assertClean(value, path) {
  path = path || 'result';
  if (typeof value === 'number') { assert.ok(!Number.isNaN(value), path + ' is NaN'); return; }
  if (typeof value === 'string') { assert.ok(!/NaN|undefined|Infinity/.test(value), path + ' = ' + JSON.stringify(value)); return; }
  if (Array.isArray(value)) { value.forEach((v, i) => assertClean(v, path + '[' + i + ']')); return; }
  if (value && typeof value === 'object') for (const k of Object.keys(value)) assertClean(value[k], path + '.' + k);
}
// Contract shape + internal consistency of any scoreListing result.
function assertShape(res) {
  assert.ok(res && typeof res === 'object', 'result is an object');
  assert.ok(res.mode === 'rent' || res.mode === 'buy', 'mode is rent|buy, got ' + res.mode);
  assert.deepEqual(res.dimensions.map((d) => d.key), ORDER, 'six dimensions in contract order');
  let num = 0;
  let den = 0;
  for (const d of res.dimensions) {
    assert.equal(d.label, LABELS[d.key], d.key + ' label');
    assert.equal(d.priority, PRIORITY_OF[d.key], d.key + ' priority');
    assert.equal(typeof d.picked, 'boolean', d.key + ' picked is boolean');
    assert.equal(d.weight, d.picked ? 2 : 1, d.key + ' weight is 2 when picked else 1');
    assert.ok(Array.isArray(d.via), d.key + ' via is an array');
    assert.ok(Array.isArray(d.notes), d.key + ' notes is an array');
    assert.ok(d.as_of === null || typeof d.as_of === 'string', d.key + ' as_of is string|null');
    if (d.score === null) {
      assert.equal(d.band, null, d.key + ' blank -> band null');
      assert.equal(typeof d.blank_reason, 'string', d.key + ' blank -> blank_reason string');
      assert.ok(d.blank_reason.length > 0, d.key + ' blank_reason non-empty');
    } else {
      assert.ok(Number.isInteger(d.score) && d.score >= 0 && d.score <= 100, d.key + ' score is an integer 0-100, got ' + d.score);
      assert.equal(d.band, bandOf(d.score), d.key + ' band matches score');
      assert.equal(d.blank_reason, null, d.key + ' scored -> blank_reason null');
      assert.ok(d.fact && typeof d.fact.display === 'string' && d.fact.display.length > 0, d.key + ' scored -> fact.display');
      assert.ok(d.fact.value === null || typeof d.fact.value === 'number', d.key + ' fact.value number|null');
      assert.equal(typeof d.fact.unit, 'string', d.key + ' fact.unit string');
      assert.ok(d.via.length > 0, d.key + ' scored -> via names its endpoint(s)');
      num += d.weight * d.score;
      den += d.weight;
    }
  }
  const scored = res.dimensions.filter((d) => d.score !== null);
  assert.deepEqual(res.coverage, { scored: scored.length, of: 6 }, 'coverage');
  assert.deepEqual([...res.blank].sort(), res.dimensions.filter((d) => d.score === null).map((d) => d.key).sort(), 'blank lists null dimensions');
  assert.equal(res.total, den ? Math.round(num / den) : null, 'total = round(sum(w*s)/sum(w)) over scored dims');
  assert.equal(res.band, bandOf(res.total), 'total band');
  for (const it of res.halos) {
    const d = dim(res, it.key);
    assert.equal(it.kind, 'halo');
    assert.ok(d.score >= 70, 'halo item has score >= 70');
    assert.equal(it.score, d.score);
    assert.equal(it.number, d.fact.display, 'item.number = fact.display');
    assert.deepEqual(it.via, d.via);
    assert.equal(it.as_of, d.as_of);
    assert.equal(it.picked, d.picked);
  }
  for (const it of res.failos) {
    assert.equal(it.kind, 'failo');
    if (it.key === 'flood') continue;
    const d = dim(res, it.key);
    assert.ok(d.score < 40, 'failo item has score < 40');
    assert.equal(it.score, d.score);
    assert.equal(it.number, d.fact.display, 'item.number = fact.display');
    assert.deepEqual(it.via, d.via);
    assert.equal(it.as_of, d.as_of);
    assert.equal(it.picked, d.picked);
  }
  assertClean(res);
  return res;
}

// ---------------------------------------------------------------------------------------------
// 0. API surface
// ---------------------------------------------------------------------------------------------
test('exports the contract API', () => {
  assert.ok(score.TABLE && typeof score.TABLE === 'object', 'TABLE is exported');
  for (const fn of ['interpolate', 'bandFor', 'scoreDimension', 'scoreListing']) {
    assert.equal(typeof score[fn], 'function', fn + ' is a function');
  }
  assert.deepEqual(keysOf(score.PRIORITIES).sort(), ['cheap', 'close_to_work', 'lively', 'negotiable', 'quiet', 'safe']);
  assert.deepEqual(keysOf(score.DIMENSIONS), ORDER, 'DIMENSIONS in contract order');
});

// ---------------------------------------------------------------------------------------------
// 1. A listing that halos for its profile
// ---------------------------------------------------------------------------------------------
test('fixture 1: cheap, near-work, low-crime, lively, quiet, slack-market room halos for Sarah', () => {
  const res = assertShape(run(HALO, sarah()));
  assert.equal(res.mode, 'rent');
  // affordability: advert 2026-08-20 is fresh (< 18 months before 2026-11-07), so R = 165 (not the 400 estimate)
  //   s = 165/600 = 0.275 -> between (0.25,100),(0.30,80): 100 - 0.5*20 = 90
  //   b = 165/250 = 0.66 -> below 0.90 -> 100;  min(90, 100) = 90
  assert.equal(dim(res, 'affordability').score, 90);
  // commute: dLat = 0.0185 deg -> d = 6371 * 0.0185 * pi/180 = 2.057 km
  //   between (1.5,100),(3,85): 100 - (0.557/1.5)*15 = 94.43; train 450 <= 800 -> +10 = 104.4 -> cap 100
  assert.equal(dim(res, 'commute').score, 100);
  // safety: c = 2240/2800 = 0.8 -> between (0.5,100),(1.0,80): 100 - 0.6*20 = 88
  //   block/suburb = 2240/3360 = 0.667 <= 0.8 -> +10 = 98; no flood
  assert.equal(dim(res, 'safety').score, 98);
  // liveliness: A = 20 + 3*2 + 2*2 = 30 -> anchor (30,80) -> 80
  assert.equal(dim(res, 'liveliness').score, 80);
  // quiet: D = 300 -> between (200,80),(400,100): 80 + 0.5*20 = 90; primary -> no penalty
  assert.equal(dim(res, 'quiet').score, 90);
  // negotiability: V = 3.0 -> anchor (3.0,75); block/suburb = 3.0/2.0 = 1.5 >= 1.25 -> +10 = 85
  assert.equal(dim(res, 'negotiability').score, 85);
  // weights (Sarah picks cheap, close_to_work, safe): 2,2,2,1,1,1 -> sum 9
  //   total = (2*90 + 2*100 + 2*98 + 80 + 90 + 85) / 9 = 831/9 = 92.33 -> 92
  assert.equal(res.total, 92);
  assert.ok(res.total >= 70);
  assert.equal(res.band, 'halo');
  assert.deepEqual(res.coverage, { scored: 6, of: 6 });
  assert.deepEqual(res.blank, []);
  // halos: picked first by score desc (commute 100, safety 98, affordability 90),
  //        then unpicked by score desc (quiet 90, negotiability 85, liveliness 80)
  assert.ok(res.halos.length > 0);
  assert.deepEqual(res.halos.map((i) => i.key), ['commute', 'safety', 'affordability', 'quiet', 'negotiability', 'liveliness']);
  assert.deepEqual(res.halos.map((i) => i.label), [
    ITEM_LABEL.commute_work.halo, ITEM_LABEL.safety.halo, ITEM_LABEL.affordability.halo,
    ITEM_LABEL.quiet.halo, ITEM_LABEL.negotiability.halo, ITEM_LABEL.liveliness.halo,
  ]);
  assert.deepEqual(res.halos.map((i) => i.picked), [true, true, true, false, false, false]);
  assert.deepEqual(res.failos, [], 'no failos and no flood item (on_property false)');
  // via / as_of travel with the fact used
  const aff = dim(res, 'affordability');
  hasVia(aff, VIA.rent_advert);
  assert.ok(!aff.via.includes(VIA.rent_estimate), 'affordability did not use the estimate');
  assert.equal(aff.as_of, '2026-08-20');
  hasVia(dim(res, 'commute'), VIA.transport);
  hasVia(dim(res, 'safety'), VIA.crime);
  assert.equal(dim(res, 'safety').as_of, '2020-22 model');
  hasVia(dim(res, 'liveliness'), VIA.amenities);
  hasVia(dim(res, 'quiet'), VIA.busy_road);
  hasVia(dim(res, 'negotiability'), VIA.vacancy);
  assert.match(dim(res, 'commute').fact.display, /km/, 'commute display shows the distance to work');
});

// ---------------------------------------------------------------------------------------------
// 2. A listing that fails affordability for Sarah
// ---------------------------------------------------------------------------------------------
test('fixture 2: $780/wk fails affordability for Sarah (income $600, budget $250)', () => {
  const res = assertShape(run(FAIL, sarah()));
  const aff = dim(res, 'affordability');
  // advert dated 2026-09-15 is fresh -> R = 780
  //   s = 780/600 = 1.30 -> above last anchor 0.70 -> 0
  //   b = 780/250 = 3.12 -> above last anchor 1.40 -> 0;  min = 0
  assert.equal(aff.score, 0);
  assert.equal(aff.band, 'failo');
  assert.equal(aff.picked, true);
  assert.equal(aff.weight, 2);
  hasVia(aff, VIA.rent_advert);
  assert.equal(aff.as_of, '2026-09-15');
  assert.match(aff.fact.display, /780/, 'display shows the weekly rent');
  assert.match(aff.fact.display, /130\s*%/, 'display shows 780/600 = 130% of income');
  // commute: d = 4.20005 km -> between (3,85),(6,60): 85 - (1.20005/3)*25 = 75.0;
  //   train 1200 > 800, bus 250 <= 300 -> +5 = 80
  assert.equal(dim(res, 'commute').score, 80);
  // safety: c = 6160/2800 = 2.2 -> between (2.0,55),(4.0,25): 55 - 0.1*30 = 52
  //   block/suburb = 6160/4480 = 1.375 >= 1.25 -> -10 = 42
  assert.equal(dim(res, 'safety').score, 42);
  // liveliness: A = 12 + 3*1 + 2*0 = 15 -> anchor (15,55) -> 55
  assert.equal(dim(res, 'liveliness').score, 55);
  // quiet: D = 40 -> between (25,10),(50,30): 10 + 0.6*20 = 22; trunk and D < 150 -> -10 = 12
  assert.equal(dim(res, 'quiet').score, 12);
  // negotiability: vacancy absent -> blank (not 0)
  assert.equal(dim(res, 'negotiability').score, null);
  assert.deepEqual(res.blank, ['negotiability']);
  assert.deepEqual(res.coverage, { scored: 5, of: 6 });
  // total = (2*0 + 2*80 + 2*42 + 55 + 12) / (2+2+2+1+1) = 311/8 = 38.875 -> 39
  assert.equal(res.total, 39);
  assert.equal(res.band, 'failo');
  // failos: picked first (affordability 0), then unpicked by score asc (quiet 12); safety 42 is meh
  assert.deepEqual(res.failos.map((i) => i.key), ['affordability', 'quiet']);
  const first = res.failos[0];
  assert.equal(first.key, 'affordability');
  assert.equal(first.kind, 'failo');
  assert.equal(first.label, ITEM_LABEL.affordability.failo);
  assert.equal(first.picked, true);
  assert.equal(first.score, 0);
  assert.equal(first.number, aff.fact.display);
  assert.deepEqual(first.via, aff.via);
  assert.equal(res.failos[1].label, ITEM_LABEL.quiet.failo);
  // halos: commute 80 only
  assert.deepEqual(res.halos.map((i) => i.key), ['commute']);
  assert.equal(res.halos[0].label, ITEM_LABEL.commute_work.halo);
});

// ---------------------------------------------------------------------------------------------
// 3. Absent facts -> blank (null), never zero
// ---------------------------------------------------------------------------------------------
test('absent facts score null (never 0); blank lists every key; total null', () => {
  const res = assertShape(run(EMPTY, sarah()));
  for (const d of res.dimensions) {
    assert.equal(d.score, null, d.key + ' is blank, not 0');
    assert.equal(d.band, null);
  }
  assert.deepEqual([...res.blank].sort(), [...ORDER].sort());
  assert.equal(res.total, null);
  assert.equal(res.band, null);
  assert.deepEqual(res.coverage, { scored: 0, of: 6 });
  assert.deepEqual(res.halos, []);
  assert.deepEqual(res.failos, []);
  assert.match(dim(res, 'affordability').blank_reason, /rent/i, 'rent mode without rent facts says "No rent data"');
});

test('facts null / undefined -> everything blank, total null', () => {
  for (const facts of [null, undefined]) {
    const res = assertShape(run(facts, sarah()));
    assert.equal(res.total, null);
    assert.equal(res.band, null);
    assert.deepEqual(res.coverage, { scored: 0, of: 6 });
    assert.deepEqual([...res.blank].sort(), [...ORDER].sort());
    assert.deepEqual(res.halos, []);
    assert.deepEqual(res.failos, []);
    assert.ok(res.dimensions.every((d) => d.score === null));
  }
});

test('total uses only scored dimensions', () => {
  const res = assertShape(run(PARTIAL, sarah()));
  // liveliness A = 20 + 6 + 4 = 30 -> 80; quiet D = 300 -> 90; both unpicked (weight 1)
  assert.equal(dim(res, 'liveliness').score, 80);
  assert.equal(dim(res, 'quiet').score, 90);
  // total = (80 + 90) / 2 = 85. (Treating the 4 blanks as 0 would give (80+90)/(2+2+2+1+1+1) = 19.)
  assert.equal(res.total, 85);
  assert.equal(res.band, 'halo');
  assert.deepEqual(res.coverage, { scored: 2, of: 6 });
  assert.deepEqual([...res.blank].sort(), ['affordability', 'commute', 'negotiability', 'safety']);
  // picked-but-blank dimensions keep weight 2 / picked true but add nothing
  assert.equal(dim(res, 'affordability').weight, 2);
  assert.equal(dim(res, 'affordability').score, null);
});

// ---------------------------------------------------------------------------------------------
// 4. Weights: a picked priority counts double
// ---------------------------------------------------------------------------------------------
test('weights: picking a priority doubles its weight and moves the total', () => {
  const p = (priorities) => sarah({ priorities: priorities });
  // scores: liveliness 80, quiet 30, negotiability 55 (see fixture W)
  const none = assertShape(run(W, p([])));
  assert.deepEqual(scoresOf(none), { affordability: null, commute: null, safety: null, liveliness: 80, quiet: 30, negotiability: 55 });
  // (80 + 30 + 55) / 3 = 165/3 = 55
  assert.equal(none.total, 55);
  assert.ok(none.dimensions.every((d) => d.weight === 1 && d.picked === false));

  const quiet = assertShape(run(W, p(['quiet'])));
  // (80 + 2*30 + 55) / (1 + 2 + 1) = 195/4 = 48.75 -> 49
  assert.equal(quiet.total, 49);
  assert.equal(dim(quiet, 'quiet').weight, 2);
  assert.equal(dim(quiet, 'quiet').picked, true);
  assert.equal(dim(quiet, 'liveliness').weight, 1);

  const lively = assertShape(run(W, p(['lively'])));
  // (2*80 + 30 + 55) / 4 = 245/4 = 61.25 -> 61
  assert.equal(lively.total, 61);

  const two = assertShape(run(W, p(['quiet', 'negotiable'])));
  // (80 + 2*30 + 2*55) / (1 + 2 + 2) = 250/5 = 50
  assert.equal(two.total, 50);

  const three = assertShape(run(W, p(['lively', 'quiet', 'negotiable'])));
  // all scored dims doubled: (160 + 60 + 110) / 6 = 330/6 = 55 (same as unweighted)
  assert.equal(three.total, 55);

  const blanks = assertShape(run(W, p(['cheap', 'close_to_work', 'safe'])));
  // the picked dimensions are blank, so the scored ones keep weight 1: 165/3 = 55
  assert.equal(blanks.total, 55);

  // same listing, different picks: Sarah (cheap, close_to_work, safe) 92 vs (lively, quiet, negotiable)
  //   (90 + 100 + 98 + 2*80 + 2*90 + 2*85) / 9 = 798/9 = 88.67 -> 89
  assert.equal(run(HALO, sarah()).total, 92);
  assert.equal(assertShape(run(HALO, p(['lively', 'quiet', 'negotiable']))).total, 89);
});

test('halos/failos sort picked first, then by score', () => {
  const res = assertShape(run(ORDERING, sarah()));
  // affordability 90 (as fixture 1), commute 100 (d = 2.057 km, train 450 -> cap 100)
  // safety: c = 11200/2800 = 4.0 -> anchor (4.0,25); block/suburb = 1.0 -> no modifier -> 25
  // liveliness: counts {} present -> A = 0 -> 0;  quiet: D = 50 -> 30
  // negotiability: V = block 5.0 (no suburb) -> anchor (5.0,100) -> 100
  assert.deepEqual(scoresOf(res), { affordability: 90, commute: 100, safety: 25, liveliness: 0, quiet: 30, negotiability: 100 });
  // halos: picked by score desc (commute 100, affordability 90) BEFORE unpicked negotiability 100
  assert.deepEqual(res.halos.map((i) => i.key), ['commute', 'affordability', 'negotiability']);
  // failos: picked safety 25 BEFORE unpicked liveliness 0 and quiet 30 (score asc)
  assert.deepEqual(res.failos.map((i) => i.key), ['safety', 'liveliness', 'quiet']);
  assert.deepEqual(res.failos.map((i) => i.label), [ITEM_LABEL.safety.failo, ITEM_LABEL.liveliness.failo, ITEM_LABEL.quiet.failo]);
  // total = (2*90 + 2*100 + 2*25 + 0 + 30 + 100) / 9 = 560/9 = 62.2 -> 62 (meh)
  assert.equal(res.total, 62);
  assert.equal(res.band, 'meh');
});

// ---------------------------------------------------------------------------------------------
// 5. interpolate and bandFor
// ---------------------------------------------------------------------------------------------
test('interpolate: linear between anchors, clamped outside them', () => {
  const I = score.interpolate;
  const up = [[0, 0], [10, 100]];
  near(I(up, -5), 0, 'below first anchor -> first score');
  near(I(up, 0), 0, 'at first anchor');
  near(I(up, 2.5), 25, '0 + 0.25*100');
  near(I(up, 10), 100, 'at last anchor');
  near(I(up, 15), 100, 'above last anchor -> last score');
  const share = [[0.25, 100], [0.30, 80], [0.40, 45], [0.50, 20], [0.70, 0]];
  near(I(share, 0.10), 100, 'below first');
  near(I(share, 0.25), 100, 'first anchor');
  near(I(share, 0.30), 80, 'inner anchor');
  near(I(share, 0.36), 59, '80 + (0.06/0.10)*(45-80) = 80 - 21');
  near(I(share, 0.70), 0, 'last anchor');
  near(I(share, 1.30), 0, 'above last');
  const live = [[0, 0], [5, 25], [15, 55], [30, 80], [50, 100]];
  near(I(live, 10), 40, '25 + 0.5*30');
  near(I(live, 40), 90, '80 + 0.5*20');
  near(I(live, 60), 100, 'above last');
  const commute = [[1.5, 100], [3, 85], [6, 60], [10, 35], [20, 10], [30, 0]];
  near(I(commute, 4.2), 75, '85 - (1.2/3)*25');
  near(I(commute, 25), 5, '10 - 0.5*10');
  near(I(commute, 0), 100, 'below first');
  near(I(commute, 99), 0, 'above last');
});

test('bandFor: failo < 40 <= meh < 70 <= halo', () => {
  assert.equal(score.bandFor(0), 'failo');
  assert.equal(score.bandFor(39), 'failo');
  assert.equal(score.bandFor(40), 'meh');
  assert.equal(score.bandFor(69), 'meh');
  assert.equal(score.bandFor(70), 'halo');
  assert.equal(score.bandFor(100), 'halo');
  assert.equal(score.bandFor(null), null);
});

// ---------------------------------------------------------------------------------------------
// 6. Affordability: rent source choice and buy mode
// ---------------------------------------------------------------------------------------------
test('affordability: advert older than 18 months -> rent_estimate', () => {
  const facts = shell('GANSW000000007', 'Ultimo', {
    rent_advert: { weekly_rent: 900, date: '2025-01-15', via: VIA.rent_advert, as_of: '2025-01-15' }, // ~22 months old
    rent_estimate: { weekly_rent: 240, basis: 'mesh_block', property_type: 'unit', via: VIA.rent_estimate, as_of: '2026-10' },
  });
  const res = assertShape(run(facts, sarah()));
  const aff = dim(res, 'affordability');
  // R = 240: s = 240/600 = 0.40 -> anchor (0.40,45) -> 45
  //          b = 240/250 = 0.96 -> between (0.90,100),(1.00,70): 100 - 0.6*30 = 82;  min = 45
  // (Using the stale 900 advert would give s = 1.5 -> 0.)
  assert.equal(aff.score, 45);
  hasVia(aff, VIA.rent_estimate);
  assert.ok(!aff.via.includes(VIA.rent_advert), 'stale advert not cited');
  assert.equal(aff.as_of, '2026-10');
});

test('affordability: stale advert and no estimate -> the older advert', () => {
  const facts = shell('GANSW000000008', 'Ultimo', {
    rent_advert: { weekly_rent: 216, date: '2025-01-15', via: VIA.rent_advert, as_of: '2025-01-15' },
  });
  const aff = dim(assertShape(run(facts, sarah())), 'affordability');
  // s = 216/600 = 0.36 -> 80 - 0.6*35 = 59;  b = 216/250 = 0.864 -> below 0.90 -> 100;  min = 59
  assert.equal(aff.score, 59);
  hasVia(aff, VIA.rent_advert);
});

test('affordability: opts.now decides whether the advert is fresh', () => {
  const facts = shell('GANSW000000009', 'Pyrmont', {
    rent_advert: { weekly_rent: 165, date: '2025-07-01', via: VIA.rent_advert, as_of: '2025-07-01' },
    rent_estimate: { weekly_rent: 240, basis: 'suburb', property_type: 'unit', via: VIA.rent_estimate, as_of: '2026-10' },
  });
  // now 2026-11-07: advert is 16 months old -> fresh -> 165 -> min(90, 100) = 90
  assert.equal(dim(run(facts, sarah(), { now: '2026-11-07' }), 'affordability').score, 90);
  // now 2027-06-01: advert is 23 months old -> stale -> estimate 240 -> min(45, 82) = 45
  assert.equal(dim(run(facts, sarah(), { now: '2027-06-01' }), 'affordability').score, 45);
  // a Date works as well as a 'YYYY-MM-DD' string
  assert.equal(dim(run(facts, sarah(), { now: new Date('2026-11-07T01:00:00Z') }), 'affordability').score, 90);
  assert.equal(run(HALO, sarah(), { now: new Date('2026-11-07T01:00:00Z') }).total, 92);
});

test('affordability: uses only the inputs that are set', () => {
  const facts = shell('GANSW000000010', 'Chippendale', {
    rent_advert: { weekly_rent: 165, date: '2026-08-20', via: VIA.rent_advert, as_of: '2026-08-20' },
  });
  // income only: s = 165/600 = 0.275 -> 90
  const incomeOnly = sarah({ budget: { mode: 'rent', max_rent_week: null, max_price: null } });
  assert.equal(dim(assertShape(run(facts, incomeOnly)), 'affordability').score, 90);
  // budget only: b = 165/250 = 0.66 -> 100
  const budgetOnly = sarah({ income_week: null });
  assert.equal(dim(assertShape(run(facts, budgetOnly)), 'affordability').score, 100);
  // neither -> blank "Set a budget or income"
  const neither = sarah({ income_week: null, budget: { mode: 'rent', max_rent_week: null, max_price: null } });
  const aff = dim(assertShape(run(facts, neither)), 'affordability');
  assert.equal(aff.score, null);
  assert.match(aff.blank_reason, /budget|income/i);
});

test('affordability: rent mode with only an AVM is blank ("No rent data")', () => {
  const facts = shell('GANSW000000011', 'Darlington', {
    avm: { predicted_price: 1040000, predicted_price_low: 950000, predicted_price_high: 1130000, confidence_score: 0.7, via: VIA.avm, as_of: '2026-10-01' },
  });
  const aff = dim(assertShape(run(facts, sarah())), 'affordability');
  assert.equal(aff.score, null);
  assert.match(aff.blank_reason, /rent/i);
});

test('affordability: buy mode uses the AVM against budget and income multiple', () => {
  const AVM = { predicted_price: 1040000, predicted_price_low: 950000, predicted_price_high: 1130000, confidence_score: 0.7, via: VIA.avm, as_of: '2026-10-01' };
  // the rent facts must be ignored in buy mode
  const facts = shell('GANSW000000012', 'Erskineville', {
    avm: AVM,
    rent_advert: { weekly_rent: 165, date: '2026-08-20', via: VIA.rent_advert, as_of: '2026-08-20' },
  });
  const res = assertShape(run(facts, buyer()));
  assert.equal(res.mode, 'buy');
  const aff = dim(res, 'affordability');
  // b = 1,040,000 / 1,000,000 = 1.04 -> between (1.00,70),(1.15,35): 70 - (0.04/0.15)*35 = 60.67
  // m = 1,040,000 / (2000*52 = 104,000) = 10 -> between (9,40),(12,10): 40 - (1/3)*30 = 30;  min = 30
  assert.equal(aff.score, 30);
  assert.equal(aff.band, 'failo');
  hasVia(aff, VIA.avm);
  assert.ok(!aff.via.includes(VIA.rent_advert), 'buy mode does not cite the rent advert');
  assert.equal(aff.as_of, '2026-10-01');
  assert.equal(res.failos[0].key, 'affordability');
  assert.equal(res.failos[0].label, ITEM_LABEL.affordability.failo);
  // higher income: m = 1,040,000 / (5200*52 = 270,400) = 3.85 -> below 4 -> 100; budget binds: 60.67 -> 61
  assert.equal(dim(assertShape(run(facts, buyer({ income_week: 5200 }))), 'affordability').score, 61);
  // no max_price: m only = 30
  assert.equal(dim(assertShape(run(facts, buyer({ budget: { mode: 'buy', max_rent_week: null, max_price: null } }))), 'affordability').score, 30);
  // no income: b = 1,040,000 / 2,000,000 = 0.52 -> 100
  assert.equal(dim(assertShape(run(facts, buyer({ income_week: null, budget: { mode: 'buy', max_rent_week: null, max_price: 2000000 } }))), 'affordability').score, 100);
  // price under budget, modest multiple: b = 960,000/1,000,000 = 0.96 -> 82; m = 960,000/(4000*52 = 208,000) = 4.615
  //   -> 100 - (0.615/2)*25 = 92.3;  min = 82 -> halo "Affordable"
  const cheaper = shell('GANSW000000013', 'Erskineville', { avm: Object.assign({}, AVM, { predicted_price: 960000 }) });
  const r2 = assertShape(run(cheaper, buyer({ income_week: 4000 })));
  assert.equal(dim(r2, 'affordability').score, 82);
  assert.equal(r2.halos[0].key, 'affordability');
  assert.equal(r2.halos[0].label, ITEM_LABEL.affordability.halo);
  // buy mode without an AVM -> blank "No valuation" (rent facts are not a fallback)
  const noAvm = shell('GANSW000000014', 'Erskineville', { rent_advert: facts.rent_advert });
  const blank = dim(assertShape(run(noAvm, buyer())), 'affordability');
  assert.equal(blank.score, null);
  assert.match(blank.blank_reason, /valuation/i);
});

// ---------------------------------------------------------------------------------------------
// 7. Flood, busy roads, crime fallback, vacancy modifiers, commute without work, amenities
// ---------------------------------------------------------------------------------------------
test('flood on property: safety -20 and a "flood" failo item', () => {
  const facts = clone(HALO);
  facts.flood = { on_property: true, nearest_m: 0, via: VIA.flood };
  const res = assertShape(run(facts, sarah()));
  // safety: 88 + 10 (0.667x suburb) - 20 (flood) = 78
  assert.equal(dim(res, 'safety').score, 78);
  // no dimension below 40, so the flood item is the only (and last) failo
  assert.equal(res.failos.length, 1);
  const flood = res.failos[res.failos.length - 1];
  assert.equal(flood.key, 'flood');
  assert.equal(flood.kind, 'failo');
  assert.equal(flood.label, 'Flood overlay on property');
  assert.ok(Array.isArray(flood.via) && flood.via.includes(VIA.flood), 'flood item cites the flood endpoint');
  // total = (2*90 + 2*100 + 2*78 + 80 + 90 + 85) / 9 = 791/9 = 87.9 -> 88
  assert.equal(res.total, 88);
});

test('flood item comes after the dimension failos', () => {
  const facts = clone(FAIL);
  facts.flood = { on_property: true, nearest_m: 0, via: VIA.flood };
  const res = assertShape(run(facts, sarah()));
  // safety 52 - 10 - 20 = 22 -> failo now
  assert.equal(dim(res, 'safety').score, 22);
  // picked by score asc (affordability 0, safety 22), unpicked (quiet 12), then flood
  assert.deepEqual(res.failos.map((i) => i.key), ['affordability', 'safety', 'quiet', 'flood']);
});

test('flood only: safety stays blank (absent is not zero) but the flood item still shows', () => {
  const facts = shell('GANSW000000015', 'Rosebery', { flood: { on_property: true, nearest_m: 0, via: VIA.flood } });
  const res = assertShape(run(facts, sarah()));
  assert.equal(dim(res, 'safety').score, null);
  assert.equal(res.total, null);
  assert.deepEqual(res.failos.map((i) => i.key), ['flood']);
});

test('safety: clamps to 0..100 and needs national_median', () => {
  const crime = (c) => shell('GANSW000000016', 'Haymarket', { crime: Object.assign({ basis: 'mesh_block', unit: CRIME_UNIT, via: VIA.crime, as_of: '2020-22 model' }, c) });
  // c = 1120/2800 = 0.4 -> below 0.5 -> 100; 1120/3360 = 0.33 <= 0.8 -> +10 = 110 -> clamp 100
  assert.equal(dim(assertShape(run(crime({ rate: 1120, suburb_median: 3360, national_median: 2800 }), sarah())), 'safety').score, 100);
  // c = 28000/2800 = 10 -> above 8.0 -> 0; 28000/5600 = 5 >= 1.25 -> -10; flood -20 -> -30 -> clamp 0
  const worst = crime({ rate: 28000, suburb_median: 5600, national_median: 2800 });
  worst.flood = { on_property: true, via: VIA.flood };
  assert.equal(dim(assertShape(run(worst, sarah())), 'safety').score, 0);
  // national_median missing -> blank
  const noNat = dim(assertShape(run(crime({ rate: 2240, suburb_median: 3360 }), sarah())), 'safety');
  assert.equal(noNat.score, null);
  // modifier boundaries at c = 1.0 (base 80):
  //   2800/3500 = 0.80 <= 0.8 -> +10 = 90;  2800/2240 = 1.25 >= 1.25 -> -10 = 70;  2800/3110 = 0.90 -> 80
  assert.equal(dim(run(crime({ rate: 2800, suburb_median: 3500, national_median: 2800 }), sarah()), 'safety').score, 90);
  assert.equal(dim(run(crime({ rate: 2800, suburb_median: 2240, national_median: 2800 }), sarah()), 'safety').score, 70);
  assert.equal(dim(run(crime({ rate: 2800, suburb_median: 3110, national_median: 2800 }), sarah()), 'safety').score, 80);
});

test('safety: suburb fallback when the mesh block has no rate', () => {
  const facts = shell('GANSW000000017', 'Millers Point', {
    crime: { basis: 'suburb', suburb_median: 3920, national_median: 2800, verdict: 'Above average', unit: CRIME_UNIT, via: VIA.crime, as_of: '2020-22 model' },
    missing: { crime_rate: 'mesh_block_unknown' },
  });
  const s = dim(assertShape(run(facts, sarah())), 'safety');
  // c = 3920/2800 = 1.4 -> between (1.0,80),(2.0,55): 80 - 0.4*25 = 70; no within-suburb modifier
  assert.equal(s.score, 70);
  assert.equal(s.band, 'halo');
  assert.equal(s.as_of, '2020-22 model');
});

test('quiet: busy-road distance, motorway/trunk penalty, no segments -> 90', () => {
  const road = (r) => shell('GANSW000000018', 'Alexandria', { busy_road: Object.assign({ via: VIA.busy_road, segments: 6 }, r) });
  // segments 0 -> "No busy road mapped in the suburb" -> 90
  const none = dim(assertShape(run(road({ segments: 0 }), sarah())), 'quiet');
  assert.equal(none.score, 90);
  assert.equal(none.band, 'halo');
  hasVia(none, VIA.busy_road);
  // D = 140 trunk: between (100,55),(200,80): 55 + 0.4*25 = 65; trunk and 140 < 150 -> -10 = 55
  assert.equal(dim(run(road({ nearest_m: 140, road_class: 'trunk' }), sarah()), 'quiet').score, 55);
  // D = 160 motorway: 55 + 0.6*25 = 70; 160 is not < 150 -> no penalty = 70
  assert.equal(dim(run(road({ nearest_m: 160, road_class: 'motorway' }), sarah()), 'quiet').score, 70);
  // D = 140 primary: 65, no penalty
  assert.equal(dim(run(road({ nearest_m: 140, road_class: 'primary' }), sarah()), 'quiet').score, 65);
  // D = 0 -> 0 (busy road on the doorstep is a real 0, not a blank); D = 500 -> above last -> 100
  const zero = dim(assertShape(run(road({ nearest_m: 0, road_class: 'primary' }), sarah())), 'quiet');
  assert.equal(zero.score, 0);
  assert.equal(dim(run(road({ nearest_m: 500, road_class: 'primary' }), sarah()), 'quiet').score, 100);
  // busy_road absent -> blank
  assert.equal(dim(run(shell('GANSW000000019', 'Alexandria', {}), sarah()), 'quiet').score, null);
});

test('negotiability: vacancy anchors and block-vs-suburb modifiers', () => {
  const vac = (v) => shell('GANSW000000020', 'Newtown', { vacancy: Object.assign({ property_type: 'unit', via: VIA.vacancy, as_of: '2026-10' }, v) });
  const s = (v, prof) => dim(assertShape(run(vac(v), prof || sarah())), 'negotiability').score;
  assert.equal(s({ block_pct: 3.0, suburb_pct: 2.0 }), 85); // 75 + 10 (ratio 1.5)
  assert.equal(s({ block_pct: 2.5, suburb_pct: 2.0 }), 75); // 55 + 0.5*20 = 65; ratio 1.25 >= 1.25 -> +10
  assert.equal(s({ block_pct: 2.0, suburb_pct: 2.0 }), 55); // anchor; ratio 1.0 -> no modifier
  assert.equal(s({ block_pct: 3.0, suburb_pct: 4.0 }), 65); // 75; ratio 0.75 <= 0.75 -> -10
  assert.equal(s({ block_pct: 1.0, suburb_pct: 2.0 }), 20); // 30; ratio 0.5 -> -10
  assert.equal(s({ suburb_pct: 3.0 }), 75); // block absent -> V = suburb 3.0 -> 75; no modifier
  assert.equal(s({ block_pct: 6.0, suburb_pct: 2.0 }), 100); // above last -> 100; +10 -> clamp 100
  assert.equal(s({ block_pct: 0.4, suburb_pct: 1.0 }), 0); // below first -> 10; ratio 0.4 -> -10 = 0
  // same metric in buy mode
  assert.equal(s({ block_pct: 3.0, suburb_pct: 2.0 }, buyer()), 85);
  // labels
  const hi = assertShape(run(vac({ block_pct: 3.0, suburb_pct: 2.0 }), sarah()));
  assert.equal(hi.halos.find((i) => i.key === 'negotiability').label, ITEM_LABEL.negotiability.halo);
  const lo = assertShape(run(vac({ block_pct: 1.0, suburb_pct: 2.0 }), sarah()));
  assert.equal(lo.failos.find((i) => i.key === 'negotiability').label, ITEM_LABEL.negotiability.failo);
  hasVia(dim(lo, 'negotiability'), VIA.vacancy);
});

test('commute: with a work location', () => {
  const at = (loc, nearest) => {
    const f = shell('GANSW000000021', 'Zetland', { location: { lat: loc, lng: 151.2080, via: VIA.location }, work: WORK });
    if (nearest) f.transport = { radius_m: 1500, nearest: nearest, via: VIA.transport };
    return f;
  };
  const FAR = -33.908272; // 4.20005 km from work -> base 75
  const c = (f) => dim(assertShape(run(f, sarah())), 'commute');
  assert.equal(c(at(FAR, null)).score, 75); // no transport fact -> no bonus
  assert.equal(c(at(FAR, { tram: { distance_m: 700 } })).score, 85); // tram <= 800 -> +10
  assert.equal(c(at(FAR, { ferry: { distance_m: 800 } })).score, 85); // ferry at exactly 800 -> +10
  assert.equal(c(at(FAR, { train: { distance_m: 640 }, bus: { distance_m: 80 } })).score, 85); // +10 only, bonuses do not stack
  assert.equal(c(at(FAR, { bus: { distance_m: 300 } })).score, 80); // bus <= 300 -> +5
  assert.equal(c(at(FAR, { bus: { distance_m: 350 } })).score, 75); // bus 350 -> no bonus
  const close = c(at(-33.8890, { train: { distance_m: 450 } })); // 2.057 km -> 94.43 + 10 -> cap 100
  assert.equal(close.score, 100);
  const res = assertShape(run(at(FAR, { train: { distance_m: 640 } }), sarah()));
  assert.equal(res.halos.find((i) => i.key === 'commute').label, ITEM_LABEL.commute_work.halo);
});

test('commute: without a work location falls back to transit', () => {
  const t = (nearest) => shell('GANSW000000022', 'Darlinghurst', {
    location: { lat: -33.8790, lng: 151.2190, via: VIA.location },
    transport: { radius_m: 1500, nearest: nearest, via: VIA.transport },
    missing: { work: 'not_requested' },
  });
  const c = (f, prof) => dim(assertShape(run(f, prof || sarah())), 'commute');
  // train 640: between (300,90),(800,75): 90 - (340/500)*15 = 79.8 -> 80
  const train = c(t({ train: { distance_m: 640 }, bus: { distance_m: 80 } }));
  assert.equal(train.score, 80);
  hasVia(train, VIA.transport);
  assert.equal(c(t({ train: { distance_m: 1000 }, ferry: { distance_m: 500 } })).score, 84); // nearest fast = 500: 90 - 0.4*15
  assert.equal(c(t({ tram: { distance_m: 300 } })).score, 90); // first anchor
  assert.equal(c(t({ train: { distance_m: 1500 } })).score, 50); // anchor (1500,50)
  assert.equal(c(t({ train: { distance_m: 3500 } })).score, 25); // above last -> 25
  assert.equal(c(t({ bus: { distance_m: 200 } })).score, 45); // no fast stop, bus <= 300 -> 45
  assert.equal(c(t({})).score, 20); // transport present, no stop at all -> 20
  const r = assertShape(run(t({ train: { distance_m: 640 } }), sarah()));
  assert.equal(r.halos.find((i) => i.key === 'commute').label, ITEM_LABEL.commute_transit.halo);
  const poor = assertShape(run(t({}), sarah()));
  assert.equal(poor.failos.find((i) => i.key === 'commute').label, ITEM_LABEL.commute_transit.failo);
  // no transport and no work -> blank
  assert.equal(dim(run(shell('GANSW000000023', 'Darlinghurst', {}), sarah()), 'commute').score, null);
});

test('liveliness: a category missing from a present counts object counts as 0', () => {
  const a = (counts) => shell('GANSW000000024', 'Newtown', { amenities: { radius_m: 1000, counts: counts, via: VIA.amenities } });
  const l = (counts) => dim(assertShape(run(a(counts), sarah())), 'liveliness');
  const empty = l({});
  assert.equal(empty.score, 0); // A = 0 -> 0 (a real zero: the fact is present)
  assert.equal(empty.band, 'failo');
  assert.equal(l({ restaurant: 5 }).score, 25); // A = 5 -> anchor (5,25)
  assert.equal(l({ supermarket: 5 }).score, 55); // A = 3*5 = 15 -> anchor (15,55)
  assert.equal(l({ green_spaces: 5 }).score, 40); // A = 2*5 = 10 -> 25 + 0.5*30 = 40
  assert.equal(l({ restaurant: 30, supermarket: 3, green_spaces: 6 }).score, 100); // A = 30+9+12 = 51 -> above 50 -> 100
  const res = assertShape(run(a({}), sarah()));
  assert.equal(res.failos.find((i) => i.key === 'liveliness').label, ITEM_LABEL.liveliness.failo);
  assert.equal(dim(run(shell('GANSW000000025', 'Newtown', {}), sarah()), 'liveliness').score, null); // absent -> blank
});

// ---------------------------------------------------------------------------------------------
// 8. Missing profile fields never produce NaN
// ---------------------------------------------------------------------------------------------
test('no NaN anywhere for profiles with missing income/budget', () => {
  const profiles = [
    {},
    { budget: {} },
    { version: 1, budget: { mode: 'rent', max_rent_week: null, max_price: null }, income_week: null, priorities: [] },
    { version: 1, budget: { mode: 'rent' }, priorities: ['cheap'] },
    { version: 1, budget: { mode: 'buy', max_price: null }, priorities: ['cheap', 'quiet'] },
    { version: 1, budget: { mode: 'buy' }, income_week: undefined },
    { version: 1, budget: { mode: 'rent', max_rent_week: 250 } },
    { version: 1, income_week: 600, priorities: ['negotiable'] },
  ];
  const withAvm = clone(HALO);
  withAvm.avm = { predicted_price: 1040000, via: VIA.avm, as_of: '2026-10-01' };
  for (const prof of profiles) {
    for (const facts of [HALO, FAIL, withAvm, EMPTY, PARTIAL, null]) {
      const res = assertShape(run(facts, prof));
      assertClean(res);
    }
  }
  // rent mode, no income and no budget -> affordability blank, everything else still scores
  const r = assertShape(run(HALO, { budget: { mode: 'rent', max_rent_week: null, max_price: null }, income_week: null, priorities: [] }));
  assert.equal(dim(r, 'affordability').score, null);
  assert.match(dim(r, 'affordability').blank_reason, /budget|income/i);
  // the other five are the fixture-1 numbers, unweighted: (100 + 98 + 80 + 90 + 85) / 5 = 453/5 = 90.6 -> 91
  assert.equal(r.total, 91);
  // missing priorities -> no weights (all 1)
  assert.ok(r.dimensions.every((d) => d.weight === 1 && d.picked === false));
});

test('robustness (not in the contract): missing profile object does not throw or NaN', () => {
  for (const prof of [undefined, null]) {
    const res = assertShape(run(HALO, prof));
    assertClean(res);
    assert.ok(res.dimensions.every((d) => d.weight === 1));
  }
});

test('priorities: duplicates and unknown keys are ignored; weight is only ever 1 or 2', () => {
  const res = assertShape(run(W, sarah({ priorities: ['quiet', 'quiet', 'bogus'] })));
  assert.equal(dim(res, 'quiet').weight, 2);
  // (80 + 2*30 + 55) / 4 = 195/4 = 48.75 -> 49, same as picking 'quiet' once
  assert.equal(res.total, 49);
});

test('pure: does not mutate its inputs and touches no DOM or chrome.* API', () => {
  const facts = clone(FAIL);
  const prof = sarah();
  const before = JSON.stringify([facts, prof]);
  run(facts, prof);
  score.scoreDimension('commute', facts, prof, OPTS);
  assert.equal(JSON.stringify([facts, prof]), before, 'facts and profile unchanged');
  const src = require('node:fs').readFileSync(require.resolve('../extension/panel/score.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/\bchrome\s*\.|\bdocument\s*\.|\bwindow\s*\.|\blocalStorage\b|\bfetch\s*\(/.test(src), 'no chrome/DOM/network in score.js');
});

// ---------------------------------------------------------------------------------------------
// scoreDimension agrees with scoreListing
// ---------------------------------------------------------------------------------------------
test('scoreDimension returns the same score as scoreListing', () => {
  for (const facts of [HALO, FAIL, EMPTY, ORDERING]) {
    const res = run(facts, sarah());
    for (const key of ORDER) {
      const d = score.scoreDimension(key, facts, sarah(), OPTS);
      assert.equal(d.score, dim(res, key).score, key + ' on ' + facts.gnaf_id);
      assert.equal(d.band, dim(res, key).band, key + ' band on ' + facts.gnaf_id);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Fixer pass (v1.1): commute names the matched workplace; verdict wording (meter.js)
// ---------------------------------------------------------------------------------------------
test('commute display names the matched workplace, not just "work"', () => {
  const res = assertShape(run(HALO, sarah()));
  const c = dim(res, 'commute');
  assert.match(c.fact.display, /^[\d.]+ (km|m) to 188 Pitt St\b/, c.fact.display);
  assert.ok(!/to work/.test(c.fact.display), 'the workplace is named');
  // no display_name on the work fact -> falls back to "work"
  const noName = Object.assign({}, HALO, { work: { lat: WORK.lat, lng: WORK.lng, via: VIA.work } });
  assert.match(dim(run(noName, sarah()), 'commute').fact.display, / to work\b/);
});

test('panel fit uses the visible pillars and leaves uncertain or missing evidence unrated', () => {
  require('../extension/panel/insights.js');
  const { summarize } = globalThis.MBX.insights;
  const profile = sarah();
  const scoreResult = run(HALO, profile);
  const original = summarize(scoreResult, HALO, profile, true);
  assert.deepEqual(original.pillars.map(pillar => pillar.label), ['Commute', 'Safety', 'Lifestyle', 'Price']);
  assert.deepEqual(original.coverage, { scored: 4, of: 4 });
  const differentVacancy = { ...HALO, vacancy: { block_pct: 0.1 } };
  assert.equal(summarize(run(differentVacancy, profile), differentVacancy, profile, true).total, original.total);
  assert.equal(summarize(scoreResult, HALO, profile, false).total, null);
  const missing = summarize(run({}, profile), {}, profile, true);
  assert.equal(missing.total, null);
  assert.ok(missing.pillars.every(pillar => pillar.score === null));
});
