import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import { parseCsv } from '../matcher.js';
import { parseAddress, streetKey } from '../src/address.js';
import { key as suburbKey } from '../src/suburbs.js';

const propertyPath = '/v1/properties/{gnaf_id}';
const suburbPath = '/v1/suburbs/{suburb_name}';
const crimeMap = '/crime/by-mesh-block';
const crimeSummary = '/crime/summary';
const livabilityPath = '/lifestyle/livability';
const riskPath = '/risks/all';
const flagsSource = 'data/public-housing-homes-city-of-sydney.csv';
const proxyDirectory = fileURLToPath(new URL('../', import.meta.url));
const data = (body) => body?.available === false ? null : body?.data ?? null;
const round = (value) => Math.round(value * 10) / 10;

function missing(asOf) {
  const signal = (unit, label, source) => ({ unit, label, source, asOf, available: false });
  return {
    blockCrime: signal('%', 'Estimated block crime vs suburb median', suburbPath + crimeMap),
    livability: signal('points', 'Suburb livability vs regional benchmark', suburbPath + livabilityPath),
    hazards: signal('level', 'Mapped hazards at this property', propertyPath + riskPath),
    socialHousing: signal('%', 'Building share flagged as social housing (estimate)', flagsSource),
  };
}

const hazardNames = { flood: 'flood', landslide: 'landslide', hv_power_line: 'high-voltage lines', environment: 'environmental hazards' };
function hazardLevel(risks) {
  if (!risks) return null;
  const layers = Object.entries(hazardNames).map(([key, name]) => ({ rows: risks[key], name }));
  const onSite = layers.filter(({ rows }) => Array.isArray(rows) && rows.some((r) => r?.on_property === true));
  if (onSite.length) return { value: 2, label: `Mapped on-property ${onSite.map(({ name }) => name).join(', ')}` };
  if (!layers.every(({ rows }) => Array.isArray(rows) && rows.every((r) => r?.on_property === false))) return null;
  if (layers.some(({ rows }) => rows.length)) return { value: 1, label: 'Mapped hazards nearby only' };
  return { value: 0, label: 'No mapped hazards in the four layers checked' };
}

async function checkHazards(bundle, property) {
  const bundled = hazardLevel(bundle);
  if (bundled) return bundled;
  const available = { ...bundle };
  const missing = Object.keys(hazardNames).filter((key) => !Array.isArray(available[key]));
  await Promise.all(missing.map(async (key) => {
    const path = '/risks/' + key.replaceAll('_', '-');
    available[key] = data(await property(path));
  }));
  const result = hazardLevel(available);
  const positive = missing.find((key) => available[key]?.some?.((item) => item?.on_property === true));
  return result && positive ? { ...result, source: propertyPath + '/risks/' + positive.replaceAll('_', '-') } : result;
}

const flagCache = new Map();
function readFlags(file) {
  try {
    const stamp = statSync(file).mtimeMs;
    if (flagCache.get(file)?.stamp === stamp) return flagCache.get(file).flags;
    const [headers, ...rows] = parseCsv(readFileSync(file, 'utf8'));
    const cols = headers?.map((h) => h.toLowerCase().replace(/\W+/g, '_')) ?? [];
    const id = cols.findIndex((h) => /^(?:gnaf_id|gnaf_pid|address_id|address_detail_pid|id)$/.test(h));
    if (id < 0) return null;
    const flag = cols.findIndex((h) => /^(?:(?:estimated_|is_)?(?:public|social)_housing(?:_flag)?|flag|flagged)$/.test(h));
    const all = new Map();
    for (const row of rows) {
      const key = row[id]?.toUpperCase();
      if (!key) continue;
      const value = row[flag]?.toLowerCase();
      if (flag < 0 || /^(?:1|true|yes|y)$/.test(value)) all.set(key, true);
      else if (/^(?:0|false|no|n)$/.test(value) && !all.has(key)) all.set(key, false);
    }
    const flags = { all, explicit: flag >= 0 };
    flagCache.set(file, { stamp, flags });
    return flags;
  } catch { return null; }
}

function parsed(address) {
  return parseAddress(String(address ?? '').replace(/[–—]/g, '-').replace(/\s+\([^()]*\)\s*$/, ''));
}

function building(address) {
  return address.number && address.street && address.suburb
    ? `${address.number}|${streetKey(address.street)}|${suburbKey(address.suburb)}` : null;
}

const unitIndexes = new WeakMap();
function housingShare({ env, matched, records }) {
  if (!Array.isArray(records) || matched?.confidence === 'guess') return null;
  const input = env?.MICROBURBS_SOCIAL_HOUSING_CSV || '../' + flagsSource;
  const flags = readFlags(isAbsolute(input) ? input : resolve(proxyDirectory, input));
  if (!flags) return null;
  const signature = building(parsed(matched.display_name));
  if (!signature) return null;
  if (!unitIndexes.has(records)) {
    const index = new Map();
    for (const record of records) {
      const text = record.display_name ?? record.name ?? record.address;
      if (/^(?:shop|office|suite|lot)\b/i.test(text)) continue;
      const address = parsed(text);
      const key = building(address);
      const id = String(record.gnaf_id ?? record.gnaf_pid ?? record.id ?? '').toUpperCase();
      if (!key || !address.unit || !id) continue;
      if (!index.has(key)) index.set(key, new Map());
      const units = index.get(key);
      if (!units.has(address.unit)) units.set(address.unit, new Set());
      units.get(address.unit).add(id);
    }
    unitIndexes.set(records, index);
  }
  const units = unitIndexes.get(records).get(signature);
  if (!units || units.size < 2) return null;
  const unitFlags = [...units.values()].map((ids) => [...ids].map((id) => flags.all.get(id)));
  if (flags.explicit && unitFlags.some((values) => !values.some((value) => typeof value === 'boolean'))) return null;
  const count = unitFlags.filter((values) => values.includes(true)).length;
  if (!flags.explicit && count === 0) return null; // No flags do not establish building coverage.
  return round(count / units.size * 100);
}

export default async function safety(ctx) {
  const { matched, asOf, property, suburb } = ctx;
  const signals = missing(asOf);
  if (!matched?.suburb) return signals;
  const verified = matched.confidence !== 'guess';
  const [profile, map, summary, livability, hazards] = (await Promise.all([
    verified && matched.gnaf_id ? property('/profile') : null,
    verified && matched.gnaf_id ? suburb(crimeMap) : null,
    verified && matched.gnaf_id ? suburb(crimeSummary) : null,
    suburb(livabilityPath),
    verified && matched.gnaf_id ? property(riskPath) : null,
  ])).map(data);
  const set = (key, values) => Object.assign(signals[key], values, { available: true });
  const rate = profile?.mesh_block ? map?.mesh_blocks?.[profile.mesh_block] : null;
  if (Number.isFinite(rate) && rate >= 0 && Number.isFinite(summary?.suburb_median) && summary.suburb_median > 0) {
    set('blockCrime', { value: round((rate / summary.suburb_median - 1) * 100) });
  }
  const benchmark = livability?.benchmark?.scores;
  if (benchmark && Array.isArray(livability.scores)) {
    const deltas = livability.scores.flatMap(({ key, value }) => Number.isFinite(value) && Number.isFinite(benchmark[key]) ? [value - benchmark[key]] : []);
    if (deltas.length) set('livability', { value: round(deltas.reduce((a, b) => a + b, 0) / deltas.length) });
  }
  const hazard = verified && matched.gnaf_id ? await checkHazards(hazards, property) : null;
  if (hazard) set('hazards', hazard);
  const housing = housingShare(ctx);
  if (housing !== null) set('socialHousing', { value: housing });
  return signals;
}

safety.missing = missing;
