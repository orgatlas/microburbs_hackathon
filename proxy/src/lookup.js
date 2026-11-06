// lookup(address): listing text -> geocode -> City of Sydney filter -> pick -> property facts, as one JSON blob.
import { parseAddress, checkMatch, cleanQuery, streetKey, suburbFromDisplayName } from './address.js';
import { findSuburb } from './suburbs.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const STATE_PREFIX = {
  GANSW: 'NSW', GAVIC: 'VIC', GAQLD: 'QLD', GASA_: 'SA', GAWA_: 'WA', GATAS: 'TAS', GANT_: 'NT', GAACT: 'ACT', GAOT_: 'OT',
};
const PROPERTY_ENDPOINTS = ['basics/all', 'valuation/avm', 'comparables/recent-sales-nearby', 'rent-history-latest', 'transport/nearby'];

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const num = (x) => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x);
  return null;
};
const str = (x) => (typeof x === 'string' ? x : x === null || x === undefined ? null : String(x));
const normQ = (q) => String(q).toLowerCase().replace(/\s+/g, ' ').trim();
// A readable Microburbs envelope: {"data": ...} or the no-data form {"data": null, "available": false, ...}.
// Anything else on a 200 (HTML from a CDN, non-JSON, {}) is an upstream fault: never "no data", never cached.
const hasEnvelope = (b) => isObj(b) && ('data' in b || b.available === false);
const UNREADABLE = 'Microburbs sent an unreadable answer (HTTP 200).';

export function stateOf(gnafId) {
  return STATE_PREFIX[String(gnafId || '').slice(0, 5).toUpperCase()] || null;
}

/** In coverage iff the id is a NSW G-NAF id AND the display_name's last comma segment is one of the 29 suburbs. */
export function classifyCandidate(row) {
  const id = String((row && row.id) || '');
  const suburbText = suburbFromDisplayName((row && row.display_name) || '');
  const state = stateOf(id);
  if (state !== 'NSW') return { inCoverage: false, why: `Outside City of Sydney (${state || 'unknown state'})`, suburb: null };
  const suburb = findSuburb(suburbText);
  if (!suburb) return { inCoverage: false, why: `Outside City of Sydney (${suburbText || 'no suburb'})`, suburb: null };
  return { inCoverage: true, why: null, suburb };
}

export function unavailable(reason, message) {
  return { available: false, reason: String(reason), message: String(message) };
}

/** Envelope -> Section. mapData(data) returns a whole Section (so it can still say "unavailable"). */
export function toSection(r, mapData) {
  if (r && r.status === 200) {
    if (!hasEnvelope(r.body)) return unavailable('upstream_error', UNREADABLE);
    const b = r.body;
    if (b.data === null || b.data === undefined) {
      return unavailable(b.reason || 'no_data', b.message || 'Microburbs has no data for this.');
    }
    return mapData(b.data);
  }
  if (r && r.status === 403) {
    const b = isObj(r.body) ? r.body : {};
    const msg = typeof b.message === 'string' ? b.message : typeof b.detail === 'string' ? b.detail : null;
    return unavailable('outside_coverage', msg || 'Outside the City of Sydney coverage area.');
  }
  const status = r ? r.status : 0;
  return unavailable('upstream_error', status ? `Microburbs did not answer (HTTP ${status})` : 'Microburbs did not answer (network error)');
}

export function mapValuation(d) {
  if (!isObj(d) || num(d.predicted_price) === null) return unavailable('no_data', 'No automated valuation for this property.');
  return {
    available: true,
    data: {
      predicted_price: num(d.predicted_price),
      predicted_price_low: num(d.predicted_price_low),
      predicted_price_high: num(d.predicted_price_high),
      prediction_date: str(d.prediction_date),
      confidence_score: num(d.confidence_score),
    },
  };
}

export function mapBasics(d) {
  if (!isObj(d)) return unavailable('unexpected_shape', 'Microburbs returned property basics in an unexpected shape.');
  return {
    available: true,
    data: {
      bed_count: num(d.bed_count),
      bath_count: num(d.bath_count),
      parking_count: num(d.parking_count),
      dwelling_type: str(d.dwelling_type),
      land_area_sqm: num(d.land_area_sqm),
    },
  };
}

/** Nearest first (missing dist_km last), at most 3, contract fields only. */
export function mapSales(d) {
  if (!Array.isArray(d)) return unavailable('unexpected_shape', 'Microburbs returned recent sales in an unexpected shape.');
  const rows = d
    .filter(isObj)
    .map((row, i) => ({ row, i, dist: num(row.dist_km) }))
    .sort((a, b) => {
      if (a.dist === null && b.dist === null) return a.i - b.i;
      if (a.dist === null) return 1;
      if (b.dist === null) return -1;
      return a.dist - b.dist || a.i - b.i;
    })
    .slice(0, 3)
    .map(({ row }) => ({
      address: str(row.address),
      price: num(row.price),
      date_sold: str(row.date_sold),
      dist_km: num(row.dist_km),
      bedrooms: num(row.bedrooms),
      bathrooms: num(row.bathrooms),
      property_type: str(row.property_type),
    }));
  if (!rows.length) return unavailable('no_recent_sales', 'No recent sales nearby.');
  return { available: true, data: rows };
}

export function mapRent(d) {
  if (!isObj(d)) return unavailable('unexpected_shape', 'Microburbs returned the rent advert in an unexpected shape.');
  return { available: true, data: { weekly_rent: num(d.price), date: str(d.date), address: str(d.address) } };
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** One DA: nearest by distance when the property's lat/lng is known, else same street, else the newest. */
export function pickDa(rows, { lat = null, lng = null, street = null } = {}) {
  if (!Array.isArray(rows)) return unavailable('unexpected_shape', 'Microburbs returned the DA list in an unexpected shape.');
  const list = rows.filter(isObj);
  if (!list.length) return unavailable('no_das', 'No development applications in this suburb in the last 5 years.');
  const shape = (row, basis, distance) => ({
    available: true,
    data: {
      address: str(row.area_name),
      suburb: str(row.suburb),
      date: str(row.date),
      category: str(row.category),
      description: str(row.description),
      distance_m: distance === null ? null : Math.round(distance),
      basis,
    },
  });
  if (num(lat) !== null && num(lng) !== null) {
    let best = null;
    for (const row of list) {
      const rl = num(row.lat);
      const rg = num(row.lng);
      if (rl === null || rg === null) continue;
      const d = haversineM(num(lat), num(lng), rl, rg);
      if (!best || d < best.d) best = { row, d };
    }
    if (best) return shape(best.row, 'nearest', best.d);
  }
  const sKey = streetKey(street);
  if (sKey) {
    // endsWith: tolerate a placeholder house number the parser keeps as a word ("XX Example Street").
    const same = list.find((row) => {
      const k = streetKey(parseAddress(String(row.area_name || '')).street);
      return Boolean(k) && (k === sKey || k.endsWith(' ' + sKey));
    });
    if (same) return shape(same, 'same_street', null);
  }
  const newest = [...list].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
  return shape(newest, 'latest_in_suburb', null);
}

function createCache(ttlMs, now, max = 5000) {
  const m = new Map();
  return {
    get(k) {
      const e = m.get(k);
      if (!e) return undefined;
      if (now() - e.t > ttlMs) {
        m.delete(k);
        return undefined;
      }
      return e.v;
    },
    set(k, v) {
      m.delete(k);
      m.set(k, { v, t: now() });
      if (m.size > max) m.delete(m.keys().next().value);
    },
  };
}

const cacheableProperty = (r) => (r.status === 200 && hasEnvelope(r.body)) || r.status === 403 || r.status === 404;
const cacheableGeocode = (r) => r.status === 200 && hasEnvelope(r.body);

export function createLookup({ client, mode = 'mock', ttlMs = SIX_HOURS, now = Date.now } = {}) {
  if (!client || typeof client.get !== 'function') throw new Error('createLookup: client with get(path, query) required');
  const geoCache = createCache(ttlMs, now);
  const propCache = createCache(ttlMs, now);
  const daCache = createCache(ttlMs, now);
  const inflight = new Map();

  async function cachedGet(cache, cacheKey, cacheable, path, query) {
    const hit = cache.get(cacheKey);
    if (hit) return { ...hit, fromCache: true };
    if (inflight.has(cacheKey)) return { ...(await inflight.get(cacheKey)), fromCache: false };
    // A client that throws or returns nothing counts as "no answer" (status 0) for that one call only, so a
    // single failing section can never reject the Promise.all and sink the whole lookup.
    const p = Promise.resolve()
      .then(() => client.get(path, query))
      .then((r) => (r && typeof r === 'object' ? r : { status: 0, body: null }), () => ({ status: 0, body: null }))
      .then((r) => {
        const res = { status: r.status, body: r.body, requestId: r.requestId ?? null };
        if (cacheable(res)) cache.set(cacheKey, res);
        return res;
      });
    inflight.set(cacheKey, p);
    try {
      return { ...(await p), fromCache: false };
    } finally {
      inflight.delete(cacheKey);
    }
  }

  async function geocode(q) {
    const r = await cachedGet(geoCache, `geo|${normQ(q)}`, cacheableGeocode, '/v1/geocode/address', { address: q });
    const requestId = r.requestId ?? null;
    if (r.status === 200) {
      if (!hasEnvelope(r.body)) return { kind: 'error', code: 'upstream_unavailable', message: UNREADABLE, requestId };
      const d = r.body.data;
      return { kind: 'rows', rows: Array.isArray(d) ? d.filter((x) => isObj(x) && x.id) : [] };
    }
    if (r.status === 403) return { kind: 'outside' };
    if (r.status === 404) return { kind: 'rows', rows: [] };
    if (r.status === 401) {
      return { kind: 'error', code: 'upstream_auth', message: 'Microburbs rejected the proxy API key (HTTP 401). Check MICROBURBS_API_KEY on the proxy.', requestId };
    }
    if (r.status === 429) {
      return { kind: 'error', code: 'upstream_rate_limited', message: 'Microburbs is rate limiting requests (HTTP 429). Try again in a few seconds.', requestId };
    }
    if (r.status === 400 || r.status === 422) {
      return { kind: 'error', code: 'bad_request', message: `Microburbs could not read that address (HTTP ${r.status}).`, requestId };
    }
    return {
      kind: 'error',
      code: 'upstream_unavailable',
      message: r.status ? `Microburbs did not answer (HTTP ${r.status}).` : 'Microburbs did not answer (network error or timeout).',
      requestId,
    };
  }

  function fail(body, code, message, requestId = null) {
    return { ...body, status: 'error', cached: false, match: null, sections: null, error: { code, message, request_id: requestId } };
  }

  async function run(body, query) {
    const listing = parseAddress(query);
    const geoQuery = query.replace(/\s+/g, ' ');
    const first = await geocode(geoQuery);
    if (first.kind === 'error') return fail(body, first.code, first.message, first.requestId);
    if (first.kind === 'outside') return { ...body, status: 'outside_coverage' };

    let rows = first.rows;
    let classes = rows.map(classifyCandidate);
    if (!classes.some((c) => c.inCoverage)) {
      const cleaned = cleanQuery(query);
      if (cleaned && cleaned.length >= 3 && normQ(cleaned) !== normQ(geoQuery)) {
        const retry = await geocode(cleaned);
        if (retry.kind === 'rows' && retry.rows.length) {
          rows = retry.rows;
          classes = rows.map(classifyCandidate);
        }
      }
    }
    if (!rows.length) return { ...body, status: 'no_match' };

    // Pick: street agrees x4 + number (unit + street number) agrees x2 + suburb agrees x1; ties -> geocoder order.
    // Street and number outrank the suburb: listings often use a neighbouring suburb name ("Surry Hills" for a
    // Darlinghurst address on Crown St), and the right house in the G-NAF suburb beats a wrong house in the listed one.
    let best = -1;
    let bestScore = -1;
    let bestCheck = null;
    rows.forEach((row, i) => {
      if (!classes[i].inCoverage) return;
      const c = checkMatch(listing, row);
      const score = (c.street === true ? 4 : 0) + (c.number === true ? 2 : 0) + (c.suburb === true ? 1 : 0);
      if (score > bestScore) {
        best = i;
        bestScore = score;
        bestCheck = c;
      }
    });

    const all = rows.map((row, i) => ({
      display_name: str(row.display_name) || '',
      gnaf_id: str(row.id) || '',
      in_coverage: classes[i].inCoverage,
      why_skipped: i === best ? null : classes[i].inCoverage ? 'Another candidate matched the listing text better' : classes[i].why,
    }));
    const candidates = best >= 5 ? [...all.slice(0, 4), all[best]] : all.slice(0, 5);

    if (best < 0) return { ...body, status: 'outside_coverage', candidates };

    const row = rows[best];
    const suburb = classes[best].suburb;
    const id = String(row.id);
    const enc = encodeURIComponent(id);

    const [basics, avm, comps, rent, transport, das] = await Promise.all([
      ...PROPERTY_ENDPOINTS.map((ep) => cachedGet(propCache, `prop|${id}|${ep}`, cacheableProperty, `/v1/properties/${enc}/${ep}`)),
      cachedGet(daCache, `da|${suburb.apiName}`, cacheableProperty, `/v1/suburbs/${encodeURIComponent(suburb.apiName)}/development/da-list`),
    ]);

    let lat = null;
    let lng = null;
    if (transport.status === 200 && isObj(transport.body) && isObj(transport.body.data)) {
      lat = num(transport.body.data.center_lat);
      lng = num(transport.body.data.center_lng);
    }
    const subjectStreet = parseAddress(String(row.display_name || '')).street;

    return {
      ...body,
      status: 'ok',
      cached: [basics, avm, comps, rent, transport].every((r) => r.fromCache),
      match: {
        gnaf_id: id,
        display_name: str(row.display_name) || '',
        property_type: str(row.property_type),
        suburb: suburb.apiName,
        suburb_label: suburb.label,
        rank: best + 1,
        check: bestCheck,
      },
      candidates,
      sections: {
        valuation: toSection(avm, mapValuation),
        basics: toSection(basics, mapBasics),
        sales: toSection(comps, mapSales),
        rent: toSection(rent, mapRent),
        da: toSection(das, (d) => pickDa(d, { lat, lng, street: subjectStreet })),
      },
    };
  }

  return async function lookup(address) {
    const query = typeof address === 'string' ? address.trim() : '';
    const body = {
      status: 'ok',
      mode,
      query,
      cached: false,
      fetched_at: new Date(now()).toISOString(),
      match: null,
      candidates: [],
      sections: null,
      error: null,
    };
    if (query.length < 3 || query.length > 200) {
      return fail(body, 'bad_request', 'Send ?address= with 3 to 200 characters of address text.');
    }
    try {
      return await run(body, query);
    } catch {
      return fail(body, 'internal', 'The proxy hit an unexpected error.');
    }
  };
}

/** HTTP status for a lookup body. */
export function httpStatusFor(body) {
  if (!body || body.status !== 'error') return 200;
  const code = body.error && body.error.code;
  if (code === 'bad_request') return 400;
  if (code === 'internal') return 500;
  return 502;
}
