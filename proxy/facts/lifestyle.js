import { haversineM } from '../profile-facts.js';

const POIS = '/lifestyle/pois';
const AMENITIES = '/amenities/nearby';
const POI_SOURCE = `/v1/suburbs/{suburb_name}${POIS}`;
const AMENITY_SOURCE = `/v1/properties/{gnaf_id}${AMENITIES}`;
const LOCAL_RADIUS_METRES = 800;
const GREEN_SPACE_RADIUS_METRES = 2000;
const dailyTypes = new Set(['supermarket', 'gym', 'cafe']);
const nightlifeTypes = new Set(['pub', 'bar', 'nightclub', 'night_club']);
const parkTypes = new Set(['park', 'beach']);

function missing(asOf) {
  const signal = (unit, label, source) => ({ unit, label, source, asOf, available: false });
  return {
    dailyAmenities: signal('types', 'Mapped supermarket, gym and café types within 800 m in this suburb (straight line)', POI_SOURCE),
    nightlife: signal('venues', 'Mapped pubs, bars and nightclubs within 800 m in this suburb (straight line)', POI_SOURCE),
    greenSpace: signal('km', 'Nearest mapped green space (straight line)', AMENITY_SOURCE),
  };
}

function dataOf(body) {
  return body?.available === false ? null : body?.data ?? null;
}

function point(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function metres(from, to) {
  return from && to ? haversineM(from.lat, from.lon, to.lat, to.lon) : null;
}

function normalized(value) {
  return typeof value === 'string'
    ? value.normalize('NFKD').replace(/\p{M}/gu, '').trim().toLowerCase()
    : '';
}

function nearbyPois(pois, home) {
  const features = pois?.pois?.features;
  if (!home || !Array.isArray(features)) return null;
  // Counts of zero require a complete response rather than a partial feature list.
  if (pois.count !== features.length || (pois.returned !== undefined && pois.returned !== features.length)) return null;
  const rows = features.map((feature) => {
    const location = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    return {
      type: normalized(feature?.properties?.subtype),
      name: normalized(feature?.properties?.name),
      location: Array.isArray(location) ? point(location[1], location[0]) : null,
    };
  });
  if (rows.length && !rows.some(({ type, location }) => type && location)) return null;
  return rows.map((row) => ({ ...row, distance: metres(home, row.location) }));
}

function greenSpaceDistance(amenities, home) {
  if (!Array.isArray(amenities?.results)) return null;
  // The API returns the closest rows first, so the first green space is the closest mapped one.
  const first = amenities.results.find((item) => ['green spaces', 'green_spaces'].includes(normalized(item?.category)));
  if (!first) return null;
  if (Number.isFinite(first.distance_m) && first.distance_m >= 0) return first.distance_m;
  return metres(home, point(first.lat, first.lng));
}

export default async function lifestyle({ matched, coordinates, asOf, property, suburb }) {
  const signals = missing(asOf);
  const [amenityBody, poiBody] = await Promise.all([
    matched?.gnaf_id ? property(AMENITIES, { radius_m: GREEN_SPACE_RADIUS_METRES }) : null,
    matched?.suburb ? suburb(POIS) : null,
  ]);
  const amenities = dataOf(amenityBody);
  const home = point(amenities?.center_lat, amenities?.center_lng)
    ?? point(coordinates?.lat, coordinates?.lon ?? coordinates?.lng);
  const rows = nearbyPois(dataOf(poiBody), home);
  const set = (key, value, overrides = {}) => Object.assign(signals[key], overrides, { value, available: true });

  if (rows) {
    const near = rows.filter(({ distance }) => distance !== null && distance <= LOCAL_RADIUS_METRES);
    const types = new Set(near.filter(({ type }) => dailyTypes.has(type)).map(({ type }) => type));
    if (types.size === dailyTypes.size || !rows.some(({ type, distance }) => dailyTypes.has(type) && distance === null)) {
      set('dailyAmenities', types.size);
    }
    if (!rows.some(({ type, distance }) => nightlifeTypes.has(type) && distance === null)) {
      const venues = new Set(near.filter(({ type }) => nightlifeTypes.has(type))
        .map(({ name, location }) => `${name}|${location.lat}|${location.lon}`));
      set('nightlife', venues.size);
    }
  }

  const green = greenSpaceDistance(amenities, home);
  if (green !== null) {
    set('greenSpace', Math.round(green) / 1000);
  } else if (rows) {
    const parks = rows.filter(({ type }) => parkTypes.has(type));
    if (parks.length && parks.every(({ distance }) => distance !== null)) {
      const nearest = parks.reduce((a, b) => a.distance <= b.distance ? a : b);
      set('greenSpace', Math.round(nearest.distance) / 1000, {
        source: POI_SOURCE,
        label: `Nearest mapped ${nearest.type} in this suburb (straight line)`,
      });
    }
  }
  return signals;
}

lifestyle.missing = missing;
