import { haversineM, nearestLineDistance } from '../profile-facts.js';
import { parseAddress, streetKey } from '../src/address.js';

const TOWN_HALL = { lat: -33.8731, lon: 151.2069 };
const TRANSPORT_RADIUS_METRES = 2000;
const POTENTIAL_FRONTAGE_METRES = 25;
const NEARBY_ROAD_METRES = 150;
const GEOCODE = '/v1/geocode/address';
const TRANSPORT = '/transport/nearby';
const PARKING = '/basics/parking-count';
const BUSY_ROADS = '/shapes/busy-roads';
const PROPERTY = '/v1/properties/{gnaf_id}';
const SUBURB = '/v1/suburbs/{suburb_name}';

const modes = {
  train: 'train station',
  tram: 'light rail stop',
  bus: 'bus stop',
};

function missing(asOf) {
  const definitions = {
    nearestTransport: ['km', 'Nearest train, light rail or bus (straight line)', PROPERTY + TRANSPORT],
    workDistance: ['km', 'Distance to work (straight line)', GEOCODE],
    cbdDistance: ['km', 'Distance to Town Hall (straight line)', PROPERTY + TRANSPORT],
    parking: ['spaces', 'Advertised covered parking', PROPERTY + PARKING],
    roadNoise: ['level', 'Busy road proximity estimate', SUBURB + BUSY_ROADS],
  };
  return Object.fromEntries(Object.entries(definitions).map(([key, [unit, label, source]]) => [
    key, { unit, label, source, asOf, available: false },
  ]));
}

function dataOf(body) {
  return body?.available === false ? null : body?.data ?? null;
}

function point(lat, lon) {
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180
    ? { lat, lon }
    : null;
}

function distanceKm(a, b) {
  return Math.round(haversineM(a.lat, a.lon, b.lat, b.lon)) / 1000;
}

function transportSignal(nearby) {
  const distances = Object.entries(modes)
    .map(([mode, label]) => ({ label, metres: nearby?.nearest?.[mode]?.distance_m }))
    .filter(({ metres }) => Number.isFinite(metres) && metres >= 0)
    .sort((a, b) => a.metres - b.metres);
  if (!distances.length) return null;
  return { value: distances[0].metres / 1000, label: `Nearest ${distances[0].label} (straight line)` };
}

function workCoordinate(candidate) {
  const location = candidate.coordinates ?? candidate._geo ?? candidate.location ?? candidate;
  if (Array.isArray(location)) return point(location[1], location[0]);
  return point(location.lat ?? location.latitude, location.lon ?? location.lng ?? location.longitude);
}

function parseWorkAddress(text) {
  return parseAddress(String(text ?? '').replace(/\(([a-z]{2,3})\)(?=(?:\s+\d{4})?\s*$)/i, '$1'));
}

async function candidatePoint(candidate, get) {
  const coordinates = workCoordinate(candidate);
  if (coordinates) return coordinates;
  const id = candidate.gnaf_id ?? candidate.id;
  if (typeof id !== 'string' || !/^GA[A-Z_0-9]+$/i.test(id)) return null;
  const data = dataOf(await get(`/v1/properties/${encodeURIComponent(id)}${TRANSPORT}`, { radius_m: 100 }));
  return point(data?.center_lat, data?.center_lng);
}

async function locateWork(work, get) {
  if (typeof work !== 'string' || work.trim().length < 2) return null;
  const requested = parseWorkAddress(work);
  if (!requested.street || !requested.suburb) return null;
  // A failed work lookup must not change the coverage status of the listing.
  try {
    const data = dataOf(await get(GEOCODE, { address: work }));
    if (!Array.isArray(data)) return null;
    const buildings = new Map();
    const states = new Set();
    for (const candidate of data) {
      if (!candidate || typeof candidate !== 'object') continue;
      const id = candidate.gnaf_id ?? candidate.id;
      const parsed = parseWorkAddress(candidate.display_name ?? candidate.name ?? candidate.abbr);
      const state = parsed.state ?? (typeof id === 'string' ? id.slice(2, 5).replace(/_$/, '').toUpperCase() : null);
      if (streetKey(parsed.street) !== streetKey(requested.street)
        || parsed.suburb?.toLowerCase() !== requested.suburb.toLowerCase()
        || (requested.state && state && requested.state !== state)
        || (requested.postcode && parsed.postcode && requested.postcode !== parsed.postcode)) continue;
      if (requested.number || requested.lot || requested.unit) {
        if (requested.number === parsed.number && requested.lot === parsed.lot && requested.unit === parsed.unit) {
          buildings.set(id ?? parsed.number, candidate);
        }
      } else if (parsed.number) {
        if (state) states.add(state);
        if (!buildings.has(parsed.number)) buildings.set(parsed.number, candidate);
      }
    }
    if (requested.number || requested.lot || requested.unit) {
      if (buildings.size !== 1) return null;
      const coordinates = await candidatePoint(buildings.values().next().value, get);
      return coordinates ? { coordinates, estimate: false } : null;
    }

    // A street-only work query has no single address. Average distinct building
    // points on that street and tell the panel this is an estimate.
    if (states.size > 1 || buildings.size < 2) return null;
    const points = await Promise.allSettled([...buildings.values()].slice(0, 3).map((candidate) => candidatePoint(candidate, get)));
    const valid = points.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []);
    if (valid.length < 2) return null;
    const coordinates = {
      lat: valid.reduce((sum, entry) => sum + entry.lat, 0) / valid.length,
      lon: valid.reduce((sum, entry) => sum + entry.lon, 0) / valid.length,
    };
    return { coordinates, estimate: true };
  } catch {
    return null;
  }
}

function roadSignal(roads, home) {
  if (!home || !Array.isArray(roads?.geojson?.features)) return null;
  const features = roads.geojson.features;
  const nearest = nearestLineDistance(home.lat, home.lon, features)?.distance_m ?? Infinity;
  if (nearest === Infinity && (features.length !== 0 || roads.count !== 0)) return null;
  if (nearest <= POTENTIAL_FRONTAGE_METRES) return { value: 2, label: 'Potential busy road frontage (estimate)' };
  if (nearest <= NEARBY_ROAD_METRES) return { value: 1, label: 'Busy road nearby (estimate)' };
  return { value: 0, label: 'No mapped busy road within 150 m in this suburb' };
}

export default async function commute({ matched, coordinates, coordinatesSource, work, asOf, get, property, suburb }) {
  const signals = missing(asOf);
  const [transportBody, parkingBody, roadsBody, destination] = await Promise.all([
    matched?.gnaf_id ? property(TRANSPORT, { radius_m: TRANSPORT_RADIUS_METRES }) : null,
    matched?.gnaf_id && matched.confidence === 'exact' ? property(PARKING) : null,
    matched?.suburb ? suburb(BUSY_ROADS) : null,
    locateWork(work, get),
  ]);
  const transport = dataOf(transportBody);
  const propertyCenter = point(transport?.center_lat, transport?.center_lng);
  const home = propertyCenter ?? point(coordinates?.lat, coordinates?.lon ?? coordinates?.lng);
  const parking = dataOf(parkingBody)?.parking_count;
  const set = (key, details) => Object.assign(signals[key], details, { available: true });
  const nearest = transportSignal(transport);
  if (nearest) set('nearestTransport', nearest);
  if (Number.isInteger(parking) && parking >= 0) set('parking', { value: parking });
  if (home) {
    set('cbdDistance', {
      value: distanceKm(home, TOWN_HALL),
      source: propertyCenter ? PROPERTY + TRANSPORT : coordinatesSource ?? GEOCODE,
    });
    if (destination) {
      set('workDistance', {
        value: distanceKm(home, destination.coordinates),
        label: destination.estimate ? 'Distance to work street (straight-line estimate)' : signals.workDistance.label,
      });
    }
  }
  const road = roadSignal(dataOf(roadsBody), home);
  if (road) set('roadNoise', road);
  return signals;
}

commute.missing = missing;
