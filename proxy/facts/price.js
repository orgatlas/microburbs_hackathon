import { haversineM } from '../profile-facts.js';

const PROPERTY = '/v1/properties/{gnaf_id}';
const SUBURB = '/v1/suburbs/{suburb_name}';
const rentHistory = '/rent-history-latest';
const valuation = '/valuation/avm';
const recentSales = '/comparables/recent-sales-nearby';
const cmaSales = '/comparables/cma-comp-set';
const rentMap = '/market/rent-map';
const medianRent = '/market/median-rent';
const strataLevies = '/market/strata-levies';
const councilRates = '/development/council-rates';
const construction = '/development/construction-activity';
const vacancyMap = '/market/vacancy-map';
const daysOnMarket = '/market/days-on-market';

function missing(asOf) {
  const signal = (unit, label, source) => ({ unit, label, source, asOf, available: false });
  return {
    rentAffordability: signal('AUD/week', 'Weekly rent', PROPERTY + rentHistory),
    buyAffordability: signal('AUD', 'Automated valuation estimate', PROPERTY + valuation),
    comparableValue: signal('%', 'Valuation estimate vs mean of three nearby comparable sales', PROPERTY + recentSales),
    runningCosts: signal('AUD/year', 'Area benchmark for annual running costs', SUBURB + councilRates),
    developmentPressure: signal('score', 'Satellite construction change score in this mesh block', SUBURB + construction),
    negotiatingRoom: signal('%', 'Estimated rental vacancy in this mesh block', SUBURB + vacancyMap),
  };
}

async function data(fetch, path, params) {
  const body = await fetch(path, params);
  return body?.available === false ? null : body?.data ?? null;
}

function isoDate(value, fallback) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value) ? value.slice(0, 10) : fallback;
}

function positive(value) {
  return Number.isFinite(value) && value > 0;
}

function blockCode(value) {
  const key = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return /^\d{11}$/.test(key) ? key : null;
}

function byBlock(rows, field, meshBlock) {
  return meshBlock && Array.isArray(rows) ? rows.find((row) => blockCode(row?.[field]) === meshBlock) : null;
}

function marketType(dwellingType) {
  const type = typeof dwellingType === 'string' ? dwellingType.toLowerCase().trim() : '';
  if (['unit', 'apartment', 'flat', 'studio'].includes(type)) return 'unit';
  if (type === 'house') return 'house';
  return null;
}

function distanceKm(row, home) {
  if (Number.isFinite(row.dist_km) && row.dist_km >= 0) return row.dist_km;
  const lon = home?.lon ?? home?.lng;
  if (![home?.lat, lon, row.latitude, row.longitude].every(Number.isFinite)) return null;
  if (Math.abs(row.latitude) > 90 || Math.abs(row.longitude) > 180) return null;
  return haversineM(home.lat, lon, row.latitude, row.longitude) / 1000;
}

function averageClosestSales(rows, matched, home) {
  if (!Array.isArray(rows)) return null;
  const valid = [];
  for (const row of rows) {
    if (!positive(row?.price)) continue;
    const name = String(row.address ?? row.street ?? '').trim().toLowerCase();
    const id = row.gnaf_pid ?? row.gnaf_id;
    if (id === matched.gnaf_id || (name && name === matched.display_name?.toLowerCase())) continue;
    const key = id || name;
    const distance = distanceKm(row, home);
    if (!key || distance === null) continue;
    valid.push({ key, distance, price: row.price, date: isoDate(row.date_sold, '') });
  }
  valid.sort((a, b) => a.distance - b.distance || b.date.localeCompare(a.date));
  const unique = new Map();
  for (const row of valid) if (!unique.has(row.key)) unique.set(row.key, row.price);
  const prices = [...unique.values()].slice(0, 3);
  return prices.length === 3 ? prices.reduce((sum, price) => sum + price, 0) / 3 : null;
}

async function comparableSignal({ matched, coordinates, property, avm }) {
  if (!positive(avm?.predicted_price)) return null;
  let source = recentSales;
  let mean = averageClosestSales(await data(property, source), matched, coordinates);
  if (mean === null && coordinates) {
    source = cmaSales;
    mean = averageClosestSales(await data(property, source), matched, coordinates);
  }
  if (mean === null) return null;
  const percent = (avm.predicted_price / mean - 1) * 100;
  return { value: Math.round(percent * 10) / 10, source: PROPERTY + source };
}

async function rentSignal({ rent, type, meshBlock, suburb, asOf }) {
  const [blockData, medianData] = await Promise.all([
    type && meshBlock ? data(suburb, rentMap, { property_type: type }) : null,
    type ? data(suburb, medianRent) : null,
  ]);
  const localRent = byBlock(blockData?.microburbs, 'mb', meshBlock)?.weekly_rent;
  const suburbRent = medianData?.[type];
  const benchmark = positive(localRent) ? localRent : suburbRent;
  // The feed may contain monthly ads. A rent several times the matching area median
  // is ambiguous, so use the published weekly estimate instead of converting it.
  if (positive(rent?.price) && (!positive(benchmark) || rent.price < 3 * benchmark)) {
    return { value: rent.price, label: 'Latest advertised rent (weekly basis assumed)', asOf: isoDate(rent.date, asOf) };
  }
  if (positive(localRent)) {
    return {
      value: localRent, source: SUBURB + rentMap,
      label: `Estimated median weekly ${type} rent in this mesh block`, asOf: isoDate(blockData.as_of, asOf),
    };
  }
  if (positive(suburbRent)) {
    return {
      value: suburbRent, source: SUBURB + medianRent,
      label: `Median weekly ${type} rent in this suburb`, asOf: isoDate(medianData.as_of, asOf),
    };
  }
  return null;
}

async function costSignal({ suburb, type, asOf }) {
  if (type === 'unit') {
    const levies = await data(suburb, strataLevies);
    if (positive(levies?.median_levy_annual)) return {
      value: levies.median_levy_annual, source: SUBURB + strataLevies,
      label: 'Suburb median annual strata levy (estimate)', asOf: isoDate(levies.as_of, asOf),
    };
  }
  const council = await data(suburb, councilRates);
  return positive(council?.avg_rate_aud_yr) ? {
    value: council.avg_rate_aud_yr, source: SUBURB + councilRates,
    label: 'Local government area average annual residential council rates', asOf: isoDate(council.as_of, asOf),
  } : null;
}

async function developmentSignal({ meshBlock, suburb, asOf }) {
  if (!meshBlock) return null;
  const activity = await data(suburb, construction);
  const row = byBlock(activity?.mesh_blocks, 'mb_code', meshBlock);
  return Number.isFinite(row?.construction_score) ? {
    value: row.construction_score,
    label: 'Satellite construction change score in this mesh block (2019–2023)',
    asOf: isoDate(row.as_of ?? activity.as_of, asOf),
  } : null;
}

async function negotiationSignal({ meshBlock, type, suburb, asOf }) {
  if (meshBlock) {
    const vacancy = await data(suburb, vacancyMap);
    const row = byBlock(vacancy?.mbs, 'mb', meshBlock);
    if (Number.isFinite(row?.vacancy_pct) && row.vacancy_pct >= 0 && row.vacancy_pct <= 100) {
      return { value: row.vacancy_pct, asOf: isoDate(row.as_of ?? vacancy.as_of, asOf) };
    }
  }
  if (!type) return null;
  const listingDays = await data(suburb, daysOnMarket);
  const days = listingDays?.[type];
  return Number.isFinite(days) && days >= 0 ? {
    value: days, unit: 'days', source: SUBURB + daysOnMarket,
    label: `Median days on market for current ${type} listings in this suburb`, asOf: isoDate(listingDays.as_of, asOf),
  } : null;
}

export default async function price({ matched, coordinates, asOf, property, suburb }) {
  const signals = missing(asOf);
  if (!matched?.suburb) return signals;
  const exact = matched.gnaf_id && matched.confidence === 'exact';
  const [rent, avm, profile, dwelling] = await Promise.all(exact ? [
    data(property, rentHistory), data(property, valuation), data(property, '/profile'), data(property, '/basics/dwelling-type'),
  ] : []);
  const meshBlock = blockCode(profile?.mesh_block);
  const type = marketType(dwelling?.dwelling_type);
  const context = { matched, coordinates, asOf, property, suburb, type, meshBlock, rent, avm };
  const results = await Promise.all([
    rentSignal(context),
    positive(avm?.predicted_price) ? { value: avm.predicted_price, asOf: isoDate(avm.prediction_date, asOf) } : null,
    comparableSignal(context),
    costSignal(context),
    developmentSignal(context),
    negotiationSignal(context),
  ]);
  Object.values(signals).forEach((signal, i) => {
    if (results[i]) Object.assign(signal, results[i], { available: true });
  });
  return signals;
}

price.missing = missing;
