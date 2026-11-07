import { readFileSync } from 'node:fs';
import { parseAddress, streetKey, cleanQuery } from './src/address.js';
import { findSuburb, key as suburbKey } from './src/suburbs.js';

const defaultCsv = new URL('../data/addresses-city-of-sydney.csv', import.meta.url);
const minScore = 82;
const normalText = (text) => String(text ?? '').normalize('NFKC').replace(/[‐‑‒–—−]/g, '-').trim();
const parsed = (text) => {
  const out = parseAddress(normalText(text).replace(/\s+\((?:[^()]*?\bNSW|Sydney)\)(?=\s*(?:\d{4})?\s*$)/i, ' NSW'));
  if (out.unit) out.unit = out.unit.replace(/^0+(?=\d)/, '');
  return out;
};

export function parseCsv(text) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n' || char === undefined)) {
      row.push(value.trim()); value = '';
      if (char !== ',') { if (row.some(Boolean)) rows.push(row); row = []; }
    } else if (char !== undefined) value += char;
  }
  return rows;
}

const first = (object, ...keys) => keys.map((key) => object[key]).find((value) => value != null && value !== '');
const field = (prefix, value, suffix) => value ? `${prefix ?? ''}${value}${suffix ?? ''}` : '';

export function loadRecords(file = defaultCsv) {
  try {
    const [headers, ...rows] = parseCsv(readFileSync(file, 'utf8'));
    if (!headers) return [];
    const columns = headers.map((header) => header.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/\W+/g, '_'));
    return rows.flatMap((row) => {
      const r = Object.fromEntries(columns.map((header, index) => [header, row[index]]));
      const id = first(r, 'gnaf_id', 'gnaf_pid', 'address_detail_pid', 'address_pid', 'address_id', 'id');
      const suburb = first(r, 'sal', 'suburb', 'locality_name', 'locality');
      let name = first(r, 'display_name', 'full_address', 'address', 'formatted_address', 'address_string', 'address_label', 'name', 'abbr');
      if (!name && suburb) {
        const unit = field(r.flat_number_prefix, first(r, 'flat_number', 'unit_number', 'unit'), r.flat_number_suffix);
        const start = field(r.number_first_prefix, first(r, 'number_first', 'street_number', 'number'), r.number_first_suffix);
        const end = field(r.number_last_prefix, r.number_last, r.number_last_suffix);
        const street = [r.street_name, first(r, 'street_type', 'street_type_code'), r.street_suffix_code].filter(Boolean).join(' ');
        if (start && street) name = `${unit ? `${unit}/` : ''}${start}${end && end !== start ? `-${end}` : ''} ${street}, ${suburb}`;
      }
      return id && name ? [{ gnaf_id: id, display_name: name, suburb, state: first(r, 'state', 'state_abbreviation'),
        postcode: r.postcode, latitude: first(r, 'latitude', 'lat'), longitude: first(r, 'longitude', 'lng', 'lon') }] : [];
    });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function coordinates(row) {
  const p = row.coordinates ?? row._geo ?? row.location ?? row;
  const lat = Array.isArray(p) ? p[1] : first(p, 'lat', 'latitude');
  const lon = Array.isArray(p) ? p[0] : first(p, 'lon', 'lng', 'longitude');
  if (lat == null || lon == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
  return Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180 ? { lat: Number(lat), lon: Number(lon) } : null;
}

function candidate(row, source) {
  if (!row || typeof row !== 'object') return null;
  const id = String(first(row, 'gnaf_id', 'id', 'gnaf_pid') ?? '').toUpperCase();
  const display_name = String(first(row, 'display_name', 'name', 'address', 'abbr') ?? '').trim();
  if (!/^GA[A-Z0-9_]+$/.test(id) || !display_name) return null;
  const p = parsed(display_name);
  const named = first(row, 'sal', 'suburb', 'locality_name');
  if (named && p.suburb && suburbKey(named) !== suburbKey(p.suburb)) return null;
  p.suburb ||= named;
  const state = String(row.state ?? '').toUpperCase().replace(/^NEW SOUTH WALES$/, 'NSW');
  p.state ||= state || (id.startsWith('GANSW') ? 'NSW' : null);
  p.postcode ||= row.postcode ? String(row.postcode) : null;
  const suburb = findSuburb(p.suburb);
  const covered = Boolean(suburb && id.startsWith('GANSW') && (!p.state || p.state === 'NSW'));
  return { gnaf_id: id, display_name, p, suburb: suburb?.apiName, covered, coordinates: coordinates(row), source };
}

function buildingKey(p) {
  return p.number && p.street && p.suburb ? `${p.number}|${streetKey(p.street)}|${suburbKey(p.suburb)}` : null;
}

function compatibleNumber(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 2;
  const range = (x, y) => {
    const parts = /^(\d+)-(\d+)$/.exec(x);
    return !!parts && /^\d+$/.test(y) && +y >= +parts[1] && +y <= +parts[2];
  };
  return range(a, b) || range(b, a) ? 1 : 0;
}

function oneEdit(a, b) {
  if (!a || !b || Math.min(a.length, b.length) < 7 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length > b.length) [a, b] = [b, a];
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (i === a.length) return true;
  return a.length === b.length ? a.slice(i + 1) === b.slice(i + 1) : a.slice(i) === b.slice(i + 1);
}

function compare(query, c) {
  if (query.suburb && suburbKey(query.suburb) !== suburbKey(c.p.suburb)) return null;
  if (query.state && c.p.state && query.state !== c.p.state) return null;
  if (query.postcode && c.p.postcode && query.postcode !== c.p.postcode) return null;
  const qa = streetKey(query.street), ca = streetKey(c.p.street);
  const streetExact = qa === ca;
  const number = compatibleNumber(query.number, c.p.number);
  if (!number || (!streetExact && !oneEdit(qa, ca))) return null;
  const unit = (query.unit ?? null) === (c.p.unit ?? null) && query.lot === c.p.lot;
  const score = (query.suburb ? 25 : 15) + (streetExact ? 35 : 23) + (number === 2 ? 30 : 22) + (unit ? 10 : 0);
  return { c, score, streetExact, number, unit, exact: !!query.suburb && streetExact && number === 2 && unit };
}

function combine(rows) {
  const unique = new Map();
  for (const row of rows) if (row && !unique.has(row.gnaf_id)) unique.set(row.gnaf_id, row);
  return [...unique.values()];
}

const publicCandidate = ({ gnaf_id, display_name }) => ({ gnaf_id, display_name });
const unmatched = (outsideCoverage = false) => ({ matched: null, outsideCoverage, coordinates: null, buildingKey: null });

function exact(row) {
  return { matched: { ...publicCandidate(row), suburb: row.suburb, confidence: 'exact', candidates: [] },
    outsideCoverage: false, coordinates: row.coordinates, coordinatesSource: row.source, buildingKey: buildingKey(row.p) };
}

function ranked(query, rows) {
  return combine(rows).map((row) => compare(query, row)).filter(Boolean).sort((a, b) => b.score - a.score);
}

export function createMatcher({ records = [], geocode = async () => null } = {}) {
  const index = new Map();
  for (const row of records) {
    const c = candidate(row, 'data/addresses-city-of-sydney.csv');
    const key = c?.covered && buildingKey(c.p);
    if (key) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(c);
    }
  }
  return async function match(input) {
    const query = parsed(input);
    const querySuburb = findSuburb(query.suburb);
    if ((query.state && query.state !== 'NSW') || (query.number && query.suburb && !querySuburb)) return unmatched(true);
    if (!query.number || !query.street) return unmatched();
    const key = buildingKey(query);
    const local = index.get(key) ?? [];
    const localExact = ranked(query, local).filter((r) => r.exact);
    if (localExact.length === 1) return exact(localExact[0].c);

    const canonical = cleanQuery(normalText(input));
    const buildingText = `${query.number} ${query.street}${querySuburb ? `, ${querySuburb.label}` : ''}`;
    const queries = [...new Set([normalText(input), canonical, ...(query.unit ? [buildingText] : [])])].filter(Boolean);
    let rows = [...local];
    const outsideRows = [];
    for (const address of queries) {
      let body;
      try { body = await geocode(address); }
      catch (error) {
        if (error?.status === 403 || !rows.length) throw error;
        break;
      }
      const found = Array.isArray(body?.data) && body.available !== false ? body.data : [];
      for (const item of found) {
        const c = candidate(item, '/v1/geocode/address');
        if (c?.covered) rows.push(c);
        else if (c) outsideRows.push(c);
      }
      const confirmed = ranked(query, rows).filter((r) => r.exact && r.score >= minScore);
      if (confirmed.length === 1) return exact(confirmed[0].c);
      if (confirmed.length > 1) break;
    }

    const options = ranked(query, rows);
    const building = options.filter((r) => r.streetExact && r.number === 2 && !!querySuburb);
    if (building.length && !building.some((r) => r.unit)) {
      const parents = building.filter(({ c }) => !c.p.unit && !c.p.lot);
      const parent = parents.length === 1 ? parents[0].c : null;
      return { matched: { gnaf_id: parent?.gnaf_id ?? null, display_name: parent?.display_name ?? buildingText,
        suburb: querySuburb.apiName, confidence: 'building', candidates: building.map(({ c }) => publicCandidate(c)).slice(0, 10) },
      outsideCoverage: false, buildingKey: key, coordinates: parent?.coordinates ?? null, coordinatesSource: parent?.source };
    }
    const suggestions = options.filter((r) => r.unit && r.score >= minScore);
    if (suggestions.length) {
      return { matched: { gnaf_id: null, display_name: normalText(input), suburb: querySuburb?.apiName ?? suggestions[0].c.suburb,
        confidence: 'guess', candidates: suggestions.map(({ c }) => publicCandidate(c)).slice(0, 10) },
      outsideCoverage: false, coordinates: null, buildingKey: null };
    }
    if (!querySuburb && ranked(query, outsideRows).some((r) => r.streetExact && r.number === 2 && r.unit)) return unmatched(true);
    return unmatched();
  };
}
