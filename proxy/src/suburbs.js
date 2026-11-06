// The City of Sydney coverage set: the 29 suburbs the Microburbs hackathon key can see.
// Exact API names (copied from /v1/suburbs/list?lga=Sydney). Anything else returns 403 upstream.

export const STATIC_SUBURBS = [
  'Alexandria', 'Barangaroo', 'Beaconsfield (NSW)', 'Camperdown (NSW)', 'Centennial Park (NSW)',
  'Chippendale', 'Darlinghurst', 'Darlington (Sydney - NSW)', 'Dawes Point', 'Elizabeth Bay',
  'Erskineville', 'Eveleigh', 'Forest Lodge', 'Glebe (NSW)', 'Haymarket', 'Millers Point',
  'Moore Park', 'Potts Point', 'Pyrmont', 'Redfern', 'Rosebery (NSW)', 'Rushcutters Bay',
  'Surry Hills', 'Sydney', 'The Rocks (Sydney - NSW)', 'Ultimo', 'Waterloo (NSW)',
  'Woolloomooloo', 'Zetland',
];

/** Matching key: lowercase, trailing parenthetical such as " (NSW)" removed, whitespace collapsed. */
export function key(name) {
  return String(name ?? '')
    .replace(/\s*\([^()]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Display form: the API name without its disambiguating parenthetical, e.g. "Waterloo (NSW)" -> "Waterloo". */
export function label(apiName) {
  return String(apiName ?? '').replace(/\s*\([^()]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
}

function buildMap(names) {
  const map = new Map();
  for (const apiName of names) map.set(key(apiName), { apiName, label: label(apiName) });
  return map;
}

let coverage = buildMap(STATIC_SUBURBS);
let source = 'static';

/** { apiName, label } for a suburb in coverage (any casing, with or without the parenthetical), else null. */
export function findSuburb(name) {
  return coverage.get(key(name)) || null;
}

export function isCovered(name) {
  return coverage.has(key(name));
}

export function coverageList() {
  return [...coverage.values()].map((s) => s.apiName);
}

export function coverageSource() {
  return source;
}

/** Test hook: put the static list back. */
export function resetCoverage() {
  coverage = buildMap(STATIC_SUBURBS);
  source = 'static';
}

function looksRight(rows) {
  if (!Array.isArray(rows) || rows.length < 20 || rows.length > 40) return false;
  if (!rows.every((r) => r && typeof r.suburb === 'string' && r.suburb.trim())) return false;
  const keys = new Set(rows.map((r) => key(r.suburb)));
  return keys.has('sydney') && keys.has('surry hills') && keys.has('ultimo');
}

/**
 * Live mode: refresh the exact API names once at startup. Keeps the static list on any failure
 * or when the answer looks wrong. Returns a short status string for the startup log (never the key).
 */
export async function refreshSuburbs(client) {
  try {
    const r = await client.get('/v1/suburbs/list', { lga: 'Sydney' });
    const rows = r && r.status === 200 && r.body ? r.body.data : null;
    if (!looksRight(rows)) {
      return `static list kept (refresh answered HTTP ${r ? r.status : '?'}${r && r.status === 200 ? ', unexpected shape' : ''})`;
    }
    coverage = buildMap(rows.map((row) => row.suburb.trim()));
    source = 'live';
    return `refreshed from API (${coverage.size} suburbs)`;
  } catch {
    return 'static list kept (refresh failed)';
  }
}
