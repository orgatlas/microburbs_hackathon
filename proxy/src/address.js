// Address text helpers: parse a listing address, compare it with a geocoder candidate, build a clean retry query.
import { key as suburbKey, coverageList, label as suburbLabel } from './suburbs.js';

const STREET_TYPES = {
  st: 'street', street: 'street',
  rd: 'road', road: 'road',
  ave: 'avenue', av: 'avenue', avenue: 'avenue',
  pl: 'place', place: 'place',
  ln: 'lane', lane: 'lane',
  pde: 'parade', parade: 'parade',
  tce: 'terrace', terrace: 'terrace',
  cres: 'crescent', cr: 'crescent', crescent: 'crescent',
  dr: 'drive', drive: 'drive',
  hwy: 'highway', highway: 'highway',
  sq: 'square', square: 'square',
  cct: 'circuit', circuit: 'circuit',
  cl: 'close', close: 'close',
  ct: 'court', court: 'court',
  gr: 'grove', grove: 'grove',
  bvd: 'boulevard', blvd: 'boulevard', boulevard: 'boulevard',
  esp: 'esplanade', esplanade: 'esplanade',
  wy: 'way', way: 'way',
  cir: 'circle', circle: 'circle',
};

const ABBREVIATIONS = {
  street: 'St', road: 'Rd', avenue: 'Ave', place: 'Pl', lane: 'Ln', parade: 'Pde', terrace: 'Tce',
  crescent: 'Cres', drive: 'Dr', highway: 'Hwy', square: 'Sq', circuit: 'Cct', close: 'Cl', court: 'Ct',
  grove: 'Gr', boulevard: 'Bvd', esplanade: 'Esp', way: 'Wy', circle: 'Cir',
};

const STATES = {
  nsw: 'NSW', vic: 'VIC', qld: 'QLD', sa: 'SA', wa: 'WA', tas: 'TAS', nt: 'NT', act: 'ACT',
  'new south wales': 'NSW', victoria: 'VIC', queensland: 'QLD',
};

const POSTCODE_RE = /(?:^|[,\s])(\d{4})\s*$/;
const STATE_RE = /(?:^|[,\s])(nsw|vic|qld|sa|wa|tas|nt|act|new south wales|victoria|queensland)\.?\s*$/i;
const LEVEL_RE = /^(?:(?:level|lvl|floor|fl)\.?\s*\d+[a-z]?|ground\s+floor|penthouse)\b\s*/i;
const UNIT_RE = /^(?:unit|units|apartment|apt|flat|suite|ste|shop|villa|townhouse|studio|office|u)\.?\s*#?\s*([a-z]?\d+[a-z]?)(?:\s*\/\s*|\s+|$)/i;
const LOT_RE = /^lot\s*(\d+[a-z]?)(?:\s+|$)/i;
const NUMBER_RE = /^(?:([a-z]?\d+[a-z]?)\s*\/\s*)?(\d+[a-z]?(?:\s*-\s*\d+[a-z]?)?)(?![\w/])\s*(.*)$/i;

function titleCase(s) {
  return String(s)
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

function cleanToken(t) {
  return String(t).toLowerCase().replace(/[.,]/g, '');
}

/** "Smith St" -> "Smith Street" (only the last word is treated as a street type). */
export function expandStreetType(street) {
  const words = String(street ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return '';
  const last = cleanToken(words[words.length - 1]);
  if (words.length > 1 && STREET_TYPES[last]) words[words.length - 1] = titleCase(STREET_TYPES[last]);
  return words.join(' ');
}

/** "Smith Street" -> "Smith St" (the other direction, for building short queries). */
export function abbreviateStreetType(street) {
  const words = String(street ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length < 2) return words.join(' ');
  const full = STREET_TYPES[cleanToken(words[words.length - 1])];
  if (full) words[words.length - 1] = ABBREVIATIONS[full];
  return words.join(' ');
}

/** Comparison key for a street name: lowercase, punctuation removed, street type expanded. */
export function streetKey(street) {
  if (!street) return null;
  const words = String(street).toLowerCase().replace(/[.'’]/g, '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return null;
  const last = words[words.length - 1];
  if (words.length > 1 && STREET_TYPES[last]) words[words.length - 1] = STREET_TYPES[last];
  return words.join(' ');
}

function stripStatePostcode(s) {
  let out = String(s ?? '').replace(/\s+/g, ' ').trim().replace(/,?\s*australia\s*$/i, '');
  let postcode = null;
  let state = null;
  let m = out.match(POSTCODE_RE);
  if (m) {
    postcode = m[1];
    out = out.slice(0, m.index).replace(/[\s,]+$/, '');
  }
  m = out.match(STATE_RE);
  if (m) {
    state = STATES[m[1].toLowerCase()];
    out = out.slice(0, m.index).replace(/[\s,]+$/, '');
  }
  return { rest: out.replace(/[\s,]+$/, '').trim(), state, postcode };
}

/** The suburb part of a geocoder display_name: text after the last comma, minus any state/postcode. */
export function suburbFromDisplayName(displayName) {
  const { rest } = stripStatePostcode(displayName);
  const parts = rest.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  // No comma ("26 Tudor Street Surry Hills"): take the suburb off the end instead of the whole string.
  if (parts.length === 1) return splitStreetSuburb(parts[0]).suburb || parts[0];
  return parts[parts.length - 1];
}

// "Tudor Street Surry Hills" (no comma) -> street + suburb.
function splitStreetSuburb(rest) {
  const lower = rest.toLowerCase();
  const labels = coverageList().map((n) => suburbLabel(n)).sort((a, b) => b.length - a.length);
  for (const lab of labels) {
    const l = lab.toLowerCase();
    if (lower.endsWith(' ' + l) && lower.length > l.length + 1) {
      return { street: rest.slice(0, rest.length - l.length).trim(), suburb: rest.slice(rest.length - l.length) };
    }
  }
  const words = rest.split(' ').filter(Boolean);
  for (let i = 1; i < words.length - 1; i++) {
    if (STREET_TYPES[cleanToken(words[i])]) {
      return { street: words.slice(0, i + 1).join(' '), suburb: words.slice(i + 1).join(' ') };
    }
  }
  return { street: rest, suburb: null };
}

/**
 * parseAddress("Unit 5, 12 Smith St, Surry Hills NSW 2010")
 *   -> { unit: "5", number: "12", street: "Smith Street", suburb: "Surry Hills", state: "NSW", postcode: "2010" }
 * Every field is null when it is not in the text. "lot" is also returned for "Lot 3 ..." addresses.
 */
export function parseAddress(text) {
  const out = { unit: null, number: null, street: null, suburb: null, state: null, postcode: null, lot: null };
  const { rest, state, postcode } = stripStatePostcode(text);
  out.state = state;
  out.postcode = postcode;
  if (!rest) return out;

  const segs = rest.split(',').map((s) => s.trim()).filter(Boolean);
  let streetRest = null;
  let streetIndex = -1;

  for (let i = 0; i < segs.length && streetIndex < 0; i++) {
    let seg = segs[i].replace(LEVEL_RE, '').trim();
    if (!seg) continue;
    const um = seg.match(UNIT_RE);
    if (um) {
      if (!out.unit) out.unit = um[1].toUpperCase();
      seg = seg.slice(um[0].length).trim();
      if (!seg) continue;
    }
    const lm = seg.match(LOT_RE);
    if (lm) {
      out.lot = lm[1].toUpperCase();
      seg = seg.slice(lm[0].length).trim();
      if (!seg) continue;
    }
    const nm = seg.match(NUMBER_RE);
    if (nm && /^[a-z]/i.test(nm[3])) {
      if (nm[1]) out.unit = nm[1].toUpperCase();
      out.number = nm[2].replace(/\s+/g, '').toUpperCase();
      streetRest = nm[3].trim();
      streetIndex = i;
    } else if (out.lot && /^[a-z]/i.test(seg)) {
      streetRest = seg;
      streetIndex = i;
    }
  }

  if (streetIndex < 0) {
    // No street number anywhere: "Tudor Street, Surry Hills" or just "Tudor Street".
    const first = segs[0].replace(LEVEL_RE, '').trim();
    if (segs.length > 1) {
      out.street = expandStreetType(titleCase(first));
      out.suburb = titleCase(segs[segs.length - 1]);
    } else {
      const split = splitStreetSuburb(first);
      if (split.suburb || STREET_TYPES[cleanToken(first.split(' ').pop())]) {
        out.street = expandStreetType(titleCase(split.street));
        out.suburb = split.suburb ? titleCase(split.suburb) : null;
      }
    }
    return out;
  }

  if (streetIndex < segs.length - 1) {
    out.street = expandStreetType(titleCase(streetRest));
    out.suburb = titleCase(segs[segs.length - 1]);
  } else {
    const split = splitStreetSuburb(streetRest);
    out.street = expandStreetType(titleCase(split.street));
    out.suburb = split.suburb ? titleCase(split.suburb) : null;
  }
  return out;
}

function numbersAgree(a, b) {
  const A = String(a).toUpperCase();
  const B = String(b).toUpperCase();
  if (A === B) return 'same';
  const ra = A.split('-');
  const rb = B.split('-');
  if (ra.length === 2 && (ra[0] === B || ra[1] === B)) return 'range';
  if (rb.length === 2 && (rb[0] === A || rb[1] === A)) return 'range';
  return null;
}

/**
 * Our own check of a geocoder pick against the listing text.
 * listing: text or parseAddress() result; candidate: geocoder row ({display_name}), text, or parsed.
 */
export function checkMatch(listing, candidate) {
  const L = typeof listing === 'string' ? parseAddress(listing) : listing || parseAddress('');
  const cText = typeof candidate === 'string' ? candidate : candidate && candidate.display_name;
  const C = cText !== undefined && cText !== null ? parseAddress(cText) : candidate || parseAddress('');
  const notes = [];

  let number = null;
  if (L.number) {
    const agree = C.number ? numbersAgree(L.number, C.number) : null;
    if (!agree) notes.push(`Street number ${L.number} differs from matched ${C.number || '(none)'}`);
    else if (agree === 'range') notes.push(`Number ${L.number} matched as ${C.number}`);
    let unitOk = true;
    if (L.unit && !C.unit) {
      unitOk = false;
      notes.push(`Unit ${L.unit} is not in the matched address`);
    } else if (L.unit && C.unit && L.unit !== C.unit) {
      unitOk = false;
      notes.push(`Unit ${L.unit} differs from matched unit ${C.unit}`);
    } else if (!L.unit && C.unit) {
      unitOk = false;
      notes.push(`Matched address is unit ${C.unit}; the listing shows no unit`);
    }
    number = Boolean(agree) && unitOk;
  } else {
    notes.push('No street number in the listing text');
  }

  let street = null;
  if (L.street) {
    street = streetKey(L.street) === streetKey(C.street);
    if (!street) notes.push(`Street "${L.street}" differs from matched "${C.street || '(none)'}"`);
  }

  let suburb = null;
  if (L.suburb) {
    suburb = suburbKey(L.suburb) === suburbKey(C.suburb);
    if (!suburb) notes.push(`Suburb ${L.suburb} differs from matched ${C.suburb || '(none)'}`);
  }

  let verdict = 'weak';
  if (number === true && street === true && suburb === true) verdict = 'exact';
  else if (street === true && (suburb === true || number === true)) verdict = 'partial';

  return { verdict, number, street, suburb, notes };
}

/** "Unit 5, 12 Smith St, Surry Hills NSW 2010" -> "5/12 Smith Street, Surry Hills" (one retry query). */
export function cleanQuery(text) {
  const p = parseAddress(text);
  if (!p.street) return stripStatePostcode(text).rest;
  let num = '';
  if (p.number) num = p.unit ? `${p.unit}/${p.number}` : p.number;
  else if (p.lot) num = `Lot ${p.lot}`;
  const first = `${num} ${p.street}`.trim();
  return p.suburb ? `${first}, ${p.suburb}` : first;
}
