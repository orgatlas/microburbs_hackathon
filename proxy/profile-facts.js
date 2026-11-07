// profile-facts.js: for a matched gnaf_id, fetch the renter/buyer "fit" facts from Microburbs and return them as
// one plain object (the FACTS CONTRACT: gnaf_id, suburb, property_type, fetched_at, then the optional facts
// location, rent_advert, rent_estimate, transport, crime, amenities, busy_road, flood, vacancy, avm, work, and the
// missing map). Fields checked against the public OpenAPI
// spec (TransportNearby, AmenitiesNearby, RiskRecord, SurroundingProperties, CrimeByMeshBlock, CrimeSummary,
// SuburbBusyRoads, VacancyMap, VacancyRate, SuburbRentMap, MedianRent, HistoryRecord, AvmEstimate).
//
// Rules: a fact the API cannot give (data:null, upstream error, unknown value) is ABSENT, never 0 and never null,
// and facts.missing[key] says why. A sub-field that is absent while its fact is present is explained under a
// dotted key, e.g. missing["crime.rate"] = "mesh_block_not_in_crime_map". getFacts never throws.
//
// createProfileFacts({ client, ttlMs, now }) -> { getFacts({ gnafId, suburb, propertyType, workAddress }) }
//   client.get(path, query) -> Promise<{ status, body, requestId }>, a live Microburbs client that already
//   rate-limits and backs off on 429.
//   now() may return a Date or epoch milliseconds.
//
// Caches (TTL ttlMs, in-flight calls de-duplicated): property endpoints by gnaf_id, suburb datasets by suburb
// (+ property_type for rent-map), work geocodes by normalised address. Only deterministic answers are cached:
// 200 envelopes (no-data envelopes included), 403 and 404. Network errors, timeouts, 401, 429 and 5xx are not.
import { suburbFromDisplayName, cleanQuery, parseAddress, checkMatch } from './src/address.js';
import { findSuburb } from './src/suburbs.js';

const SIX_HOURS = 6 * 3600 * 1000;
const TRANSPORT_RADIUS_M = 2000;
const AMENITY_RADIUS_M = 1000;
const WORK_WAIT_MS = 6000; // extra wait for the workplace after the property's own calls are back
const FLOOD_SEARCH_RADIUS_M = 1000;
const CRIME_UNIT = 'predicted incidents per 100,000 residents per year';
const CRIME_AS_OF = '2020-22 model';
const MAX_NEAREST_AMENITIES = 5;

// via strings are endpoint templates; the UI shortens them.
export const ENDPOINTS = {
  surroundings: '/v1/properties/{gnaf_id}/surroundings/properties',
  transport: '/v1/properties/{gnaf_id}/transport/nearby',
  amenities: '/v1/properties/{gnaf_id}/amenities/nearby',
  flood: '/v1/properties/{gnaf_id}/risks/flood',
  rentAdvert: '/v1/properties/{gnaf_id}/rent-history-latest',
  avm: '/v1/properties/{gnaf_id}/valuation/avm',
  crimeMb: '/v1/suburbs/{suburb_name}/crime/by-mesh-block',
  crimeSummary: '/v1/suburbs/{suburb_name}/crime/summary',
  busyRoads: '/v1/suburbs/{suburb_name}/shapes/busy-roads',
  vacancyMap: '/v1/suburbs/{suburb_name}/market/vacancy-map',
  vacancyRate: '/v1/suburbs/{suburb_name}/market/vacancy-rate',
  rentMap: '/v1/suburbs/{suburb_name}/market/rent-map',
  medianRent: '/v1/suburbs/{suburb_name}/market/median-rent',
  geocode: '/v1/geocode/address',
};
const EP = ENDPOINTS;

export const FACT_KEYS = [
  'location', 'rent_advert', 'rent_estimate', 'transport', 'crime', 'amenities',
  'busy_road', 'flood', 'vacancy', 'avm', 'work',
];

// ---------------------------------------------------------------------------------------------- small helpers
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
/** A finite number, or undefined (never 0 for a missing value). Numeric strings are accepted. */
const num = (x) => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : undefined;
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x);
  return undefined;
};
const str = (x) => (typeof x === 'string' && x.trim() !== '' ? x.trim() : undefined);
const mbKey = (x) => (typeof x === 'string' && x.trim() ? x.trim() : typeof x === 'number' && Number.isFinite(x) ? String(x) : undefined);
const isoDate = (x) => {
  const s = str(x);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
};
const hasEnvelope = (b) => isObj(b) && ('data' in b || b.available === false);
const normQ = (q) => String(q).toLowerCase().replace(/\s+/g, ' ').trim();
const roundTo = (x, dp) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};
const validLatLng = (lat, lng) =>
  lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
/** Assign only real values: undefined / null never become keys. */
function put(obj, key, value) {
  if (value !== undefined && value !== null) obj[key] = value;
  return obj;
}
const shortReason = (s) => String(s).replace(/\s+/g, '_').slice(0, 80);

/** Raw response -> { ok: true, data } (data never null) | { ok: false, why }. */
export function readEnvelope(r) {
  if (!r || typeof r !== 'object') return { ok: false, why: 'upstream_error:network' };
  if (r.status === 200) {
    if (!hasEnvelope(r.body)) return { ok: false, why: 'upstream_error:unreadable' };
    const b = r.body;
    if (b.data === null || b.data === undefined || b.available === false) {
      return { ok: false, why: `no_data:${shortReason(str(b.reason) || 'no_data')}` };
    }
    return { ok: true, data: b.data };
  }
  if (r.status === 403) return { ok: false, why: 'outside_coverage' };
  if (r.status === 404) return { ok: false, why: 'not_found:404' };
  if (!r.status) return { ok: false, why: `upstream_error:${r.error === 'timeout' ? 'timeout' : 'network'}` };
  return { ok: false, why: `upstream_error:${r.status}` };
}

const cacheable = (r) => (r.status === 200 && hasEnvelope(r.body)) || r.status === 403 || r.status === 404;

function createCache(ttlMs, nowMs, max = 3000) {
  const m = new Map();
  return {
    get(k) {
      const e = m.get(k);
      if (!e) return undefined;
      if (nowMs() - e.t > ttlMs) {
        m.delete(k);
        return undefined;
      }
      return e;
    },
    set(k, v, t) {
      m.delete(k);
      m.set(k, { v, t });
      if (m.size > max) m.delete(m.keys().next().value);
    },
  };
}

/** "unit" | "house" for the rent-map / vacancy-rate split. Unknown -> unit (inner Sydney is mostly units). */
export function rentType(propertyType) {
  const s = String(propertyType || '').toLowerCase();
  if (/\b(unit|apartment|flat|studio|strata)/.test(s)) return { type: 'unit', assumed: false };
  if (/\b(house|terrace|semi|cottage|villa|townhouse|duplex)/.test(s)) return { type: 'house', assumed: false };
  return { type: 'unit', assumed: true };
}

// ------------------------------------------------------------------------------------------------- geometry
const EARTH_R = 6371008.8;
const RAD = Math.PI / 180;

export function haversineM(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLng = (lng2 - lng1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Distance from the origin to segment A-B in a local metric plane. */
function originToSegment(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? -(ax * dx + ay * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * Shortest point-to-segment distance (m) from (lat0, lng0) to any LineString / MultiLineString feature, using an
 * equirectangular projection centred on the point (error well under 1 m at suburb scale).
 * -> { distance_m, road_class } | null when no usable geometry.
 */
export function nearestLineDistance(lat0, lng0, features) {
  const kx = Math.cos(lat0 * RAD) * EARTH_R * RAD;
  const ky = EARTH_R * RAD;
  let best = Infinity;
  let bestClass;
  for (const f of Array.isArray(features) ? features : []) {
    const g = isObj(f) ? f.geometry : null;
    if (!isObj(g) || !Array.isArray(g.coordinates)) continue;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const line of lines) {
      if (!Array.isArray(line)) continue;
      let prev = null;
      for (const pt of line) {
        if (!Array.isArray(pt) || pt.length < 2) continue;
        const lng = num(pt[0]);
        const lat = num(pt[1]);
        if (lng === undefined || lat === undefined) continue;
        const x = (lng - lng0) * kx;
        const y = (lat - lat0) * ky;
        const d = prev ? originToSegment(prev[0], prev[1], x, y) : Math.hypot(x, y);
        if (d < best) {
          best = d;
          bestClass = isObj(f.properties) ? str(f.properties.road_class) : undefined;
        }
        prev = [x, y];
      }
    }
  }
  return best === Infinity ? null : { distance_m: best, road_class: bestClass };
}

// ---------------------------------------------------------------------------------------- per-fact builders
// Each builder gets the raw responses it needs and a miss(key, why) callback, and returns the fact or undefined.

function subjectRow(surrData, gnafId) {
  const rows = isObj(surrData) && Array.isArray(surrData.properties) ? surrData.properties.filter(isObj) : [];
  return rows.find((r) => r.is_subject === true) || rows.find((r) => str(r.gnaf_pid) && str(r.gnaf_pid) === gnafId) || null;
}

/** Location of a property: surroundings is_subject row (with mesh block), else a transport / amenities centre. */
function buildLocation({ surroundings, transport, amenities, gnafId }, miss, keyPrefix = 'location') {
  const s = readEnvelope(surroundings);
  let surrWhy = s.why;
  if (s.ok) {
    const row = subjectRow(s.data, gnafId);
    const lat = row ? num(row.lat) : undefined;
    const lng = row ? num(row.lng) : undefined;
    if (validLatLng(lat, lng)) {
      const loc = { lat, lng };
      const mb = mbKey(row.mb);
      if (mb) loc.mesh_block = mb;
      else miss(`${keyPrefix}.mesh_block`, 'mesh_block_unknown:not_in_surroundings_row');
      loc.via = [EP.surroundings];
      return loc;
    }
    surrWhy = row ? 'subject_row_without_lat_lng' : 'no_subject_row';
  }
  for (const [r, via] of [[transport, EP.transport], [amenities, EP.amenities]]) {
    const t = readEnvelope(r);
    if (!t || !t.ok || !isObj(t.data)) continue;
    const lat = num(t.data.center_lat);
    const lng = num(t.data.center_lng);
    if (validLatLng(lat, lng)) {
      miss(`${keyPrefix}.mesh_block`, `mesh_block_unknown:surroundings_${surrWhy}`);
      return { lat, lng, via: [via] };
    }
  }
  miss(keyPrefix, `location_unknown:surroundings_${surrWhy}`);
  return undefined;
}

function buildRentAdvert(r, miss) {
  const e = readEnvelope(r);
  if (!e.ok) return void miss('rent_advert', e.why);
  if (!isObj(e.data)) return void miss('rent_advert', 'upstream_error:unexpected_shape');
  const price = num(e.data.price);
  if (price === undefined || price <= 0) return void miss('rent_advert', 'no_data:advert_without_price');
  const date = isoDate(e.data.date);
  const out = { weekly_rent: price };
  put(out, 'date', date);
  out.via = EP.rentAdvert;
  put(out, 'as_of', date);
  return out;
}

function buildRentEstimate({ rentMap, medianRent, mb, type }, miss) {
  let blockWhy;
  const rm = readEnvelope(rentMap);
  if (!mb) blockWhy = 'mesh_block_unknown';
  else if (!rm.ok) blockWhy = `rent_map_${rm.why}`;
  else if (!isObj(rm.data) || !Array.isArray(rm.data.microburbs)) blockWhy = 'rent_map_upstream_error:unexpected_shape';
  else {
    const row = rm.data.microburbs.find((x) => isObj(x) && mbKey(x.mb) === mb);
    const w = row ? num(row.weekly_rent) : undefined;
    if (w !== undefined && w > 0) {
      const out = { weekly_rent: w, basis: 'mesh_block', property_type: type, via: EP.rentMap };
      put(out, 'as_of', isoDate(rm.data.as_of) || str(rm.data.as_of));
      return out;
    }
    blockWhy = row ? 'mesh_block_rent_missing' : `mesh_block_not_in_${type}_rent_map`;
  }
  const md = readEnvelope(medianRent);
  let suburbWhy = md.why;
  if (md.ok && isObj(md.data)) {
    const w = num(md.data[type]);
    if (w !== undefined && w > 0) {
      miss('rent_estimate.mesh_block', blockWhy);
      const out = { weekly_rent: w, basis: 'suburb', property_type: type, via: EP.medianRent };
      put(out, 'as_of', isoDate(md.data.as_of) || str(md.data.as_of));
      return out;
    }
    suburbWhy = `no_data:no_${type}_median_rent`;
  } else if (md.ok) suburbWhy = 'upstream_error:unexpected_shape';
  miss('rent_estimate', `block:${blockWhy}; suburb:${suburbWhy}`);
  return undefined;
}

function buildTransport(r, miss) {
  const e = readEnvelope(r);
  if (!e.ok) return void miss('transport', e.why);
  // nearest is required by the spec: without it we cannot tell "nothing within the radius" from a bad answer.
  if (!isObj(e.data) || !isObj(e.data.nearest)) return void miss('transport', 'upstream_error:unexpected_shape');
  const src = e.data.nearest;
  const nearest = {};
  for (const mode of Object.keys(src)) {
    const stop = src[mode];
    const d = isObj(stop) ? num(stop.distance_m) : undefined;
    if (d === undefined || d < 0) continue; // null / missing mode = none inside the radius
    const row = { distance_m: Math.round(d) };
    put(row, 'label', str(stop.label));
    put(row, 'name', str(stop.name));
    nearest[mode] = row;
  }
  return { radius_m: num(e.data.radius_m) ?? TRANSPORT_RADIUS_M, nearest, via: EP.transport };
}

function buildCrime({ crimeMb, crimeSummary, mb }, miss) {
  const cm = readEnvelope(crimeMb);
  const cs = readEnvelope(crimeSummary);
  let rate;
  let rateWhy;
  if (!cm.ok) rateWhy = cm.why;
  else if (!isObj(cm.data) || !isObj(cm.data.mesh_blocks)) rateWhy = 'upstream_error:unexpected_shape';
  else if (!mb) rateWhy = 'mesh_block_unknown';
  else {
    rate = num(cm.data.mesh_blocks[mb]);
    if (rate === undefined || rate < 0) {
      rate = undefined;
      rateWhy = 'mesh_block_not_in_crime_map';
    }
  }
  const summary = cs.ok && isObj(cs.data) ? cs.data : null;
  const suburbMedian = summary ? num(summary.suburb_median) : undefined;
  if (rate === undefined && suburbMedian === undefined) {
    miss('crime', `rate:${rateWhy}; summary:${cs.ok ? 'no_suburb_median' : cs.why}`);
    return undefined;
  }
  const out = {};
  const via = [];
  if (rate !== undefined) {
    out.rate = rate;
    out.basis = 'mesh_block';
    via.push(EP.crimeMb);
  } else {
    out.basis = 'suburb';
    miss('crime.rate', rateWhy);
  }
  if (summary) {
    put(out, 'suburb_median', suburbMedian);
    put(out, 'national_median', num(summary.national_median));
    put(out, 'verdict', str(summary.verdict));
    via.push(EP.crimeSummary);
  } else miss('crime.suburb_median', cs.why);
  out.unit = (cm.ok && isObj(cm.data) && str(cm.data.unit)) || (summary && str(summary.unit)) || CRIME_UNIT;
  out.via = via;
  out.as_of = CRIME_AS_OF;
  return out;
}

function buildAmenities(r, miss) {
  const e = readEnvelope(r);
  if (!e.ok) return void miss('amenities', e.why);
  if (!isObj(e.data) || (!isObj(e.data.counts) && !Array.isArray(e.data.results))) {
    return void miss('amenities', 'upstream_error:unexpected_shape');
  }
  // No counts object (or no usable count in it) -> absent, never a row of zeros: the score reads counts only.
  if (!isObj(e.data.counts)) return void miss('amenities', 'no_data:no_counts');
  const counts = {};
  for (const [k, v] of Object.entries(e.data.counts)) {
    const n = num(v);
    if (n !== undefined && n >= 0) counts[k] = n; // a real 0 from the API stays 0; null is dropped
  }
  // None of the three scored categories is a number: absent (the TABLE scores a present counts object, gaps as 0).
  if (!['restaurant', 'supermarket', 'green_spaces'].some((k) => k in counts)) return void miss('amenities', 'no_data:no_counts');
  const rows = (Array.isArray(e.data.results) ? e.data.results : [])
    .filter(isObj)
    .map((x) => ({ category: str(x.category), name: str(x.name), distance_m: num(x.distance_m) }))
    .filter((x) => x.category && x.distance_m !== undefined && x.distance_m >= 0)
    .sort((a, b) => a.distance_m - b.distance_m);
  // The nearest of each category first, then the next nearest overall, up to MAX_NEAREST_AMENITIES.
  const picked = [];
  const seen = new Set();
  for (const x of rows) {
    if (!seen.has(x.category)) {
      seen.add(x.category);
      picked.push(x);
    }
  }
  for (const x of rows) {
    if (picked.length >= MAX_NEAREST_AMENITIES) break;
    if (!picked.includes(x)) picked.push(x);
  }
  const nearest = picked
    .slice(0, Math.max(MAX_NEAREST_AMENITIES, seen.size))
    .sort((a, b) => a.distance_m - b.distance_m)
    .map((x) => put(put({ category: x.category }, 'name', x.name), 'distance_m', Math.round(x.distance_m)));
  const out = { radius_m: num(e.data.radius_m) ?? AMENITY_RADIUS_M, counts };
  if (nearest.length) out.nearest = nearest;
  out.via = EP.amenities;
  return out;
}

function buildBusyRoad({ busyRoads, location }, miss) {
  const e = readEnvelope(busyRoads);
  if (!e.ok) return void miss('busy_road', e.why);
  // Neither geometry nor a count: a bad answer, not "no busy roads".
  if (!isObj(e.data) || (!isObj(e.data.geojson) && num(e.data.count) === undefined)) {
    return void miss('busy_road', 'upstream_error:unexpected_shape');
  }
  const fc = isObj(e.data.geojson) ? e.data.geojson : null;
  const features = fc && Array.isArray(fc.features) ? fc.features.filter(isObj) : [];
  const count = num(e.data.count);
  const segments = features.length || (count !== undefined && count > 0 ? count : 0);
  const out = {};
  if (segments > 0) {
    if (!location) miss('busy_road.nearest_m', 'location_unknown');
    else {
      const near = nearestLineDistance(location.lat, location.lng, features);
      if (near) {
        out.nearest_m = Math.round(near.distance_m);
        put(out, 'road_class', near.road_class);
      } else miss('busy_road.nearest_m', 'no_geometry');
    }
  } else miss('busy_road.nearest_m', 'no_busy_roads_in_suburb');
  out.segments = segments;
  out.via = EP.busyRoads;
  return out;
}

function buildFlood(r, miss) {
  const e = readEnvelope(r);
  if (!e.ok) return void miss('flood', e.why);
  if (!Array.isArray(e.data)) return void miss('flood', 'upstream_error:unexpected_shape');
  const rows = e.data.filter(isObj).filter((x) => !str(x.name) || /flood/i.test(x.name));
  if (!rows.length) {
    // [] = no modelled flood overlay within the 1 km search radius.
    miss('flood.nearest_m', `none_within_${FLOOD_SEARCH_RADIUS_M}m`);
    return { on_property: false, via: EP.flood };
  }
  const flags = rows.map((x) => x.on_property);
  let on;
  if (flags.some((f) => f === true)) on = true;
  else if (flags.every((f) => f === false)) on = false;
  else return void miss('flood', 'on_property_unknown');
  const out = { on_property: on };
  const dists = rows.map((x) => num(x.nearest_distance_m)).filter((d) => d !== undefined && d >= 0);
  if (dists.length) out.nearest_m = Math.round(Math.min(...dists));
  else miss('flood.nearest_m', 'not_given');
  out.via = EP.flood;
  return out;
}

function buildVacancy({ vacancyMap, vacancyRate, mb, type }, miss) {
  const vm = readEnvelope(vacancyMap);
  const vr = readEnvelope(vacancyRate);
  const via = [];
  let blockPct;
  let blockWhy;
  if (!mb) blockWhy = 'mesh_block_unknown';
  else if (!vm.ok) blockWhy = vm.why;
  else if (!isObj(vm.data) || !Array.isArray(vm.data.mbs)) blockWhy = 'upstream_error:unexpected_shape';
  else {
    const row = vm.data.mbs.find((x) => isObj(x) && mbKey(x.mb) === mb);
    const v = row ? num(row.vacancy_pct) : undefined;
    if (v !== undefined && v >= 0) {
      blockPct = v; // vacancy-map vacancy_pct is already a percent (0.74 = 0.74%)
      via.push(EP.vacancyMap);
    } else blockWhy = row ? 'no_data:mesh_block_vacancy_null' : 'mesh_block_not_in_vacancy_map';
  }
  let suburbPct;
  let suburbWhy;
  let asOf;
  if (!vr.ok) suburbWhy = vr.why;
  else if (!isObj(vr.data)) suburbWhy = 'upstream_error:unexpected_shape';
  else {
    const rv = vr.data[type];
    const v = isObj(rv) ? num(rv.value) : undefined;
    if (v !== undefined && v >= 0) {
      suburbPct = roundTo(v * 100, 3); // vacancy-rate value is a fraction (0.00842 = 0.84%)
      asOf = isoDate(vr.data.as_of) || str(vr.data.as_of);
      via.push(EP.vacancyRate);
    } else suburbWhy = `no_data:no_${type}_vacancy_rate`;
  }
  if (blockPct === undefined && suburbPct === undefined) {
    miss('vacancy', `block:${blockWhy}; suburb:${suburbWhy}`);
    return undefined;
  }
  const out = {};
  if (blockPct !== undefined) out.block_pct = blockPct;
  else miss('vacancy.block_pct', blockWhy);
  if (suburbPct !== undefined) out.suburb_pct = suburbPct;
  else miss('vacancy.suburb_pct', suburbWhy);
  out.property_type = type;
  out.via = via;
  put(out, 'as_of', asOf);
  return out;
}

function buildAvm(r, miss) {
  const e = readEnvelope(r);
  if (!e.ok) return void miss('avm', e.why);
  if (!isObj(e.data)) return void miss('avm', 'upstream_error:unexpected_shape');
  const price = num(e.data.predicted_price);
  if (price === undefined || price <= 0) return void miss('avm', 'no_data:no_predicted_price');
  const out = { predicted_price: price };
  const lo = num(e.data.predicted_price_low);
  const hi = num(e.data.predicted_price_high);
  if (lo !== undefined && lo > 0) out.predicted_price_low = lo;
  if (hi !== undefined && hi > 0) out.predicted_price_high = hi;
  put(out, 'confidence_score', num(e.data.confidence_score)); // null in the API -> absent, never 0
  out.via = EP.avm;
  put(out, 'as_of', isoDate(e.data.prediction_date));
  return out;
}

// ------------------------------------------------------------------------------------------------- factory
export function createProfileFacts({ client, ttlMs = SIX_HOURS, now = () => new Date(), workWaitMs = WORK_WAIT_MS } = {}) {
  if (!client || typeof client.get !== 'function') throw new Error('createProfileFacts: client with get(path, query) required');
  const nowMs = () => {
    try {
      const v = now();
      const t = v instanceof Date ? v.getTime() : Number(v);
      return Number.isFinite(t) ? t : Date.now();
    } catch {
      return Date.now();
    }
  };
  const propCache = createCache(ttlMs, nowMs);
  const suburbCache = createCache(ttlMs, nowMs);
  const workCache = createCache(ttlMs, nowMs);
  const inflight = new Map();

  async function fetchRaw(cache, cacheKey, path, query) {
    const hit = cache.get(cacheKey);
    if (hit) return { ...hit.v, at: hit.t, fromCache: true };
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);
    const p = (async () => {
      let r = null;
      try {
        r = await client.get(path, query);
      } catch {
        r = null;
      }
      const t = nowMs();
      const res = r && typeof r === 'object'
        ? { status: Number(r.status) || 0, body: r.body ?? null, error: r.error }
        : { status: 0, body: null, error: 'network error' };
      if (cacheable(res)) cache.set(cacheKey, res, t);
      return { ...res, at: t, fromCache: false };
    })();
    inflight.set(cacheKey, p);
    try {
      return await p;
    } finally {
      inflight.delete(cacheKey);
    }
  }

  const propGet = (gnafId, ep, query) =>
    fetchRaw(propCache, `prop|${gnafId}|${ep}|${JSON.stringify(query || {})}`, `/v1/properties/${encodeURIComponent(gnafId)}/${ep}`, query);
  const suburbGet = (suburb, ep, query) =>
    fetchRaw(suburbCache, `sub|${suburb}|${ep}|${JSON.stringify(query || {})}`, `/v1/suburbs/${encodeURIComponent(suburb)}/${ep}`, query);

  async function geocodeWork(q) {
    const r = await fetchRaw(workCache, `work|${normQ(q)}`, EP.geocode, { address: q });
    const e = readEnvelope(r);
    const rows = e.ok && Array.isArray(e.data) ? e.data.filter((x) => isObj(x) && str(x.id)) : [];
    // Candidates come from the whole country: keep NSW G-NAF ids whose suburb is one of the 29, then take the first
    // whose street agrees with what was typed and whose suburb does not contradict it (the listing matcher's own
    // check), so a workplace outside the City of Sydney never turns into a same-name street inside it.
    const typed = parseAddress(q);
    const inCov = rows.filter((x) => {
      const gid = String(x.id).toUpperCase();
      return gid.startsWith('GANSW') && Boolean(findSuburb(suburbFromDisplayName(String(x.display_name || ''))));
    });
    const pick = inCov.find((x) => {
      const c = checkMatch(typed, x);
      return c.street === true && c.suburb !== false;
    });
    const typedOutside = Boolean(typed.suburb) && !findSuburb(typed.suburb);
    return { e, rows, inCov, pick, typedOutside, at: r.at };
  }

  /** Work address text -> { value: { display_name, lat, lng, gnaf_id, via } } | { why }. Pushes response times. */
  async function resolveWork(q, ats) {
    if (!q) return { why: 'not_requested' };
    if (q.length < 3 || q.length > 200) return { why: 'bad_request:work_address_length' };
    let g = await geocodeWork(q);
    ats.push(g.at);
    if (!g.pick) {
      const cleaned = cleanQuery(q);
      if (cleaned && cleaned.length >= 3 && normQ(cleaned) !== normQ(q)) {
        const g2 = await geocodeWork(cleaned);
        ats.push(g2.at);
        if (g2.pick || (!g.rows.length && g2.rows.length) || (!g.e.ok && g2.e.ok)) g = g2;
      }
    }
    if (!g.pick) {
      if (!g.e.ok) return { why: g.e.why };
      if (!g.rows.length) return { why: 'no_data:no_geocode_match' };
      return { why: g.typedOutside || !g.inCov.length ? 'outside_coverage' : 'no_match:work_street_or_suburb_differs' };
    }
    const wid = String(g.pick.id);
    const notes = {};
    const note = (k, w) => {
      if (!(k in notes)) notes[k] = w;
    };
    // A workplace needs lat/lng only: the small transport/nearby answer (its centre) first; surroundings/properties
    // (every address within 200 m, largest in the CBD) only when that cannot place it.
    const t = await propGet(wid, 'transport/nearby', { radius_m: TRANSPORT_RADIUS_M });
    ats.push(t.at);
    let loc = buildLocation({ surroundings: null, transport: t, amenities: null, gnafId: wid }, () => {}, 'work');
    if (!loc) {
      const surr = await propGet(wid, 'surroundings/properties');
      ats.push(surr.at);
      loc = buildLocation({ surroundings: surr, transport: t, amenities: null, gnafId: wid }, note, 'work');
    }
    if (!loc) return { why: notes.work || 'location_unknown' };
    return {
      value: { display_name: str(g.pick.display_name) || q, lat: loc.lat, lng: loc.lng, gnaf_id: wid, via: [EP.geocode, ...loc.via] },
    };
  }

  async function getFacts({ gnafId, suburb, propertyType, workAddress } = {}) {
    const startMs = nowMs();
    const ats = [];
    const missing = {};
    const miss = (k, why) => {
      if (!(k in missing)) missing[k] = String(why);
    };
    let facts = { gnaf_id: '', suburb: '', property_type: null, fetched_at: new Date(startMs).toISOString() };
    try {
      const id = str(gnafId);
      const sub = findSuburb(suburb);
      const apiSuburb = sub ? sub.apiName : str(suburb);
      const { type, assumed } = rentType(propertyType);
      facts = { gnaf_id: id || '', suburb: apiSuburb || '', property_type: str(propertyType) || null, fetched_at: facts.fetched_at };
      if (assumed) miss('property_type', `unknown:${type}_assumed_for_rent_and_vacancy`);
      if (!id) {
        for (const k of FACT_KEYS) miss(k, 'no_gnaf_id');
        facts.missing = missing;
        return facts;
      }
      const suburbWhy = !apiSuburb ? 'suburb_unknown' : !sub ? 'outside_coverage' : null;
      const skipped = Promise.resolve(null);
      const S = (ep, query) => (suburbWhy ? skipped : suburbGet(apiSuburb, ep, query));

      // Work geocode + locate runs alongside the property and suburb calls.
      const workQ = typeof workAddress === 'string' ? workAddress.replace(/\s+/g, ' ').trim() : '';
      const workP = resolveWork(workQ, ats).catch(() => ({ why: 'internal_error' }));

      const responses = await Promise.all([
        propGet(id, 'surroundings/properties'),
        propGet(id, 'transport/nearby', { radius_m: TRANSPORT_RADIUS_M }),
        propGet(id, 'amenities/nearby', { radius_m: AMENITY_RADIUS_M }),
        propGet(id, 'risks/flood'),
        propGet(id, 'rent-history-latest'),
        propGet(id, 'valuation/avm'),
        S('crime/by-mesh-block'),
        S('crime/summary'),
        S('shapes/busy-roads', { geojson: true }),
        S('market/vacancy-map'),
        S('market/vacancy-rate'),
        S('market/rent-map', { property_type: type }),
        S('market/median-rent'),
      ]);
      for (const r of responses) if (r && Number.isFinite(r.at)) ats.push(r.at);
      const [
        surroundings, transport, amenities, flood, rentAdvert, avm,
        crimeMb, crimeSummary, busyRoads, vacancyMap, vacancyRate, rentMap, medianRent,
      ] = responses;

      const safe = (key, fn, suburbBased = false) => {
        if (suburbBased && suburbWhy) return miss(key, suburbWhy);
        try {
          const v = fn(miss);
          if (v !== undefined) facts[key] = v;
          else miss(key, 'no_data');
        } catch {
          miss(key, 'internal_error');
        }
      };

      safe('location', (m) => buildLocation({ surroundings, transport, amenities, gnafId: id }, m));
      const location = facts.location;
      const mb = location ? location.mesh_block : undefined;
      safe('rent_advert', (m) => buildRentAdvert(rentAdvert, m));
      safe('rent_estimate', (m) => buildRentEstimate({ rentMap, medianRent, mb, type }, m), true);
      safe('transport', (m) => buildTransport(transport, m));
      safe('crime', (m) => buildCrime({ crimeMb, crimeSummary, mb }, m), true);
      safe('amenities', (m) => buildAmenities(amenities, m));
      safe('busy_road', (m) => buildBusyRoad({ busyRoads, location }, m), true);
      safe('flood', (m) => buildFlood(flood, m));
      safe('vacancy', (m) => buildVacancy({ vacancyMap, vacancyRate, mb, type }, m), true);
      safe('avm', (m) => buildAvm(avm, m));

      // The workplace never holds the property's facts hostage: after the property calls, wait at most
      // workWaitMs more (a real timer, not the injectable clock), then report work as timed out.
      let workTimer;
      const work = await Promise.race([
        workP,
        new Promise((r) => {
          workTimer = setTimeout(() => r({ why: 'upstream_error:timeout' }), workWaitMs);
        }),
      ]);
      clearTimeout(workTimer);
      if (work && work.value) {
        const w = { ...work.value };
        if (location) {
          // Straight-line metres from the property (an extra beyond the contract; the UI may use or ignore it).
          const via = w.via;
          delete w.via;
          w.distance_m = Math.round(haversineM(location.lat, location.lng, w.lat, w.lng));
          w.via = via;
        }
        facts.work = w;
      } else miss('work', (work && work.why) || 'internal_error');
    } catch {
      for (const k of FACT_KEYS) if (!(k in facts)) miss(k, 'internal_error');
    }
    for (const k of FACT_KEYS) if (!(k in facts)) miss(k, 'no_data');
    // fetched_at: when the oldest answer used was fetched (a cache hit keeps its original time).
    const oldest = ats.filter((t) => Number.isFinite(t)).reduce((a, b) => Math.min(a, b), startMs);
    facts.fetched_at = new Date(oldest).toISOString();
    facts.missing = missing;
    return facts;
  }

  return { getFacts };
}

export default createProfileFacts;
