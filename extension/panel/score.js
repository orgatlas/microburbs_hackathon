/*
 * extension/panel/score.js: renter/buyer fit score (SCORING TABLE v1, see docs/SCORING.md).
 *
 * Pure functions only: no DOM, no chrome.*, no network. Date.now() is only the default for
 * opts.now. Every threshold, anchor, modifier, label and weight lives in the exported TABLE,
 * so the docs and the tests can cite it and it can be swapped in one place.
 *
 * Rules that matter:
 *  - A dimension whose facts are absent scores null (blank) with a blank_reason. Absent is never 0.
 *  - Nothing here ever returns NaN: every division is guarded.
 *  - We never read the listing's price or channel: the profile's budget mode decides rent vs buy.
 *
 * Works in the extension (window.MBX.score) and in Node (module.exports) via the UMD wrapper.
 */
(function (root, factory) { var api = factory(); if (typeof module === 'object' && module.exports) module.exports = api; root.MBX = root.MBX || {}; root.MBX.score = api; })(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ======================= SCORING TABLE v1 (single source of truth) ======================= */

  var TABLE = {
    version: 1,
    name: 'SCORING TABLE v1',
    scale: { min: 0, max: 100, rounding: 'Math.round' },
    // failo 0-39, meh 40-69, halo 70-100 (>= 70 halo, < 40 failo). Same bands for dimensions and total.
    bands: { failo: [0, 39], meh: [40, 69], halo: [70, 100], halo_min: 70, failo_below: 40 },
    // 1 per dimension, 2 for each dimension whose priority the profile picked (at most 3 picked).
    weights: { base: 1, picked: 2, max_picked: 3 },
    priorities: {
      cheap:         { label: 'Cheap',         dimension: 'affordability' },
      close_to_work: { label: 'Close to work', dimension: 'commute' },
      safe:          { label: 'Safe',          dimension: 'safety' },
      lively:        { label: 'Lively',        dimension: 'liveliness' },
      quiet:         { label: 'Quiet',         dimension: 'quiet' },
      negotiable:    { label: 'Negotiable',    dimension: 'negotiability' }
    },
    dimensions: {
      affordability: {
        label: 'Affordability', priority: 'cheap',
        labels: { halo: 'Affordable', failo: 'Unaffordable' },
        rent: {
          // R = rent advert if dated within 18 months, else rent estimate, else the older advert.
          advert_max_age_months: 18,
          income_share: [[0.25, 100], [0.30, 80], [0.40, 45], [0.50, 20], [0.70, 0]],   // R / income_week
          budget_ratio: [[0.90, 100], [1.00, 70], [1.15, 35], [1.40, 0]],               // R / max_rent_week
          combine: 'min'
        },
        buy: {
          budget_ratio: [[0.90, 100], [1.00, 70], [1.15, 35], [1.40, 0]],               // P / max_price
          income_multiple: [[4, 100], [6, 75], [9, 40], [12, 10], [15, 0]],             // P / (income_week * 52)
          weeks_per_year: 52,
          combine: 'min'
        },
        blank: { no_rent: 'No rent data', no_valuation: 'No valuation', no_inputs: 'Set a budget or income' }
      },
      commute: {
        label: 'Commute', priority: 'close_to_work',
        labels: { halo: 'Close to work', failo: 'Long commute' },
        labels_no_work: { halo: 'Good transit', failo: 'Poor transit' },
        // With facts.work and facts.location: haversine km from the property to work.
        work_distance_km: [[1.5, 100], [3, 85], [6, 60], [10, 35], [20, 10], [30, 0]],
        fast_modes: ['train', 'tram', 'ferry'],
        // +10 if the nearest train/tram/ferry is <= 800 m, else +5 if the nearest bus is <= 300 m; cap 100.
        bonus: { fast_stop_within_m: 800, fast_stop_points: 10, bus_within_m: 300, bus_points: 5, cap: 100 },
        // Without work: nearest train/tram/ferry in metres.
        transit_only: {
          fast_stop_m: [[300, 90], [800, 75], [1500, 50], [3000, 25]],
          bus_within_m: 300, bus_only_score: 45,   // no fast stop but a bus stop <= 300 m
          no_stop_score: 20                        // transport present but no qualifying stop
        },
        blank: { no_data: 'No transport data' }
      },
      safety: {
        label: 'Safety', priority: 'safe',
        labels: { halo: 'Lower crime', failo: 'Higher crime' },
        // c = rate / national_median (rate = mesh-block rate, else suburb median).
        vs_national: [[0.5, 100], [1.0, 80], [2.0, 55], [4.0, 25], [8.0, 0]],
        // Only when the mesh-block rate and the suburb median are both known.
        within_suburb: { low_ratio: 0.8, low_points: 10, high_ratio: 1.25, high_points: -10 },
        flood_on_property_points: -20,
        clamp: [0, 100],
        blank: { no_crime: 'No crime data', no_benchmark: 'No national crime benchmark' }
      },
      liveliness: {
        label: 'Liveliness', priority: 'lively',
        labels: { halo: 'Lively', failo: 'Few amenities' },
        // A = restaurant + 3*supermarket + 2*green_spaces (missing category in a present counts object = 0).
        points: { restaurant: 1, supermarket: 3, green_spaces: 2 },
        amenity_points: [[0, 0], [5, 25], [15, 55], [30, 80], [50, 100]],
        blank: { no_amenities: 'No amenity data' }
      },
      quiet: {
        label: 'Quiet', priority: 'quiet',
        labels: { halo: 'Quiet street', failo: 'Busy road nearby' },
        // D = metres to the nearest busy-road segment.
        busy_road_m: [[0, 0], [25, 10], [50, 30], [100, 55], [200, 80], [400, 100]],
        major_road: { classes: ['motorway', 'trunk'], within_m: 150, points: -10 },
        no_segments_score: 90,
        no_segments_display: 'No busy road mapped in the suburb',
        clamp: [0, 100],
        blank: { no_roads: 'No busy-road data', no_distance: 'Busy-road distance unknown' }
      },
      negotiability: {
        label: 'Negotiability', priority: 'negotiable',
        labels: { halo: 'Room to negotiate', failo: 'Tight market' },
        // V = rental vacancy % for the mesh block, else the suburb.
        vacancy_pct: [[0.5, 10], [1.0, 30], [2.0, 55], [3.0, 75], [5.0, 100]],
        vs_suburb: { high_ratio: 1.25, high_points: 10, low_ratio: 0.75, low_points: -10 },
        buy_mode_note: 'Same metric in buy mode: rental slack means softer investor competition',
        clamp: [0, 100],
        blank: { no_vacancy: 'No vacancy data' }
      }
    },
    // Extra failo appended whenever facts.flood.on_property === true.
    flood_failo: { key: 'flood', label: 'Flood overlay on property', number: 'Yes', via: '/v1/properties/{gnaf_id}/risks/flood' }
  };

  var DIMENSIONS = ['affordability', 'commute', 'safety', 'liveliness', 'quiet', 'negotiability'];
  var PRIORITIES = ['cheap', 'close_to_work', 'safe', 'lively', 'quiet', 'negotiable'];
  var PRIORITY_LABELS = {};
  var DIMENSION_LABELS = {};
  PRIORITIES.forEach(function (k) { PRIORITY_LABELS[k] = TABLE.priorities[k].label; });
  DIMENSIONS.forEach(function (k) { DIMENSION_LABELS[k] = TABLE.dimensions[k].label; });

  /* ======================= small null-safe helpers ======================= */

  var hasOwn = Object.prototype.hasOwnProperty;
  function own(o, k) { return o !== null && typeof o === 'object' && hasOwn.call(o, k); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' && v.trim() !== '' ? v.trim() : null; }
  // Finite number, or a plain numeric string (a form may store "600"); anything else -> null.
  function num(v) {
    if (isNum(v)) return v;
    if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return parseFloat(v);
    return null;
  }
  function nonNeg(v) { var n = num(v); return n !== null && n >= 0 ? n : null; }
  function pos(v) { var n = num(v); return n !== null && n > 0 ? n : null; }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function r2(x) { return Math.round(x * 100) / 100; }
  // Strings (or arrays of strings) -> de-duplicated array of non-empty strings.
  function list(v) {
    var out = [];
    [].concat(v === undefined || v === null ? [] : v).forEach(function (s) {
      if (typeof s === 'string' && s.trim() !== '' && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }

  /* ---------- formatting ---------- */

  function trimZeros(s) { return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s; }
  // Compact money: $985k, $1.13m, $2m (same rule as the panel).
  function money(n) {
    var a = Math.abs(n), out;
    if (a >= 999500) out = '$' + trimZeros((a / 1e6).toFixed(2)) + 'm';
    else if (a >= 1000) out = '$' + Math.round(a / 1000) + 'k';
    else out = '$' + Math.round(a);
    return n < 0 ? '-' + out : out;
  }
  function wholeMoney(n) { return '$' + Math.round(n).toLocaleString('en-AU'); }
  // Metres -> "640 m" / "2.1 km".
  function dist(m) {
    var r = Math.round(m);
    if (r < 1000) return r + ' m';
    return trimZeros((m / 1000).toFixed(1)) + ' km';
  }
  function km(k) { return dist(k * 1000); }
  // "188 Pitt Street, Sydney NSW 2000" -> "188 Pitt St": names the matched workplace in the commute fact.
  var STREET_ABBR = { street: 'St', road: 'Rd', avenue: 'Ave', place: 'Pl', lane: 'Ln', drive: 'Dr', parade: 'Pde', highway: 'Hwy', square: 'Sq', terrace: 'Tce' };
  function shortPlace(name) {
    var first = str(name) ? String(name).split(',')[0].trim() : '';
    if (!first) return null;
    return first.replace(/\b(Street|Road|Avenue|Place|Lane|Drive|Parade|Highway|Square|Terrace)\b$/i, function (w) {
      return STREET_ABBR[w.toLowerCase()] || w;
    });
  }
  function pctOf(ratio) { return Math.round(ratio * 100) + '%'; }   // 1.3 -> "130%"
  function pct1(p) { return p.toFixed(1) + '%'; }                   // 2.4 -> "2.4%" (already a percent)
  function times(x) { return x.toFixed(1) + 'x'; }                  // 1.8 -> "1.8x"
  function multiple(x) { return (x >= 10 ? String(Math.round(x)) : trimZeros(x.toFixed(1))) + 'x'; }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function capFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- dates (YYYY-MM-DD parsed by hand: no timezone shifts) ---------- */

  function ymd(v) {
    if (v instanceof Date) {
      if (!isFinite(v.getTime())) return null;
      return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
    }
    if (typeof v !== 'string') return null;
    var m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(v.trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = m[3] ? +m[3] : 1;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y: y, m: mo, d: d };
  }
  function dayNumber(p) { return Date.UTC(p.y, p.m - 1, p.d) / 86400000; }
  function addMonths(p, n) {
    var t = p.m - 1 + n;
    var y = p.y + Math.floor(t / 12);
    var mo = ((t % 12) + 12) % 12 + 1;
    var last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return { y: y, m: mo, d: Math.min(p.d, last) };
  }
  // True when `date` is no more than `months` before `now` (future dates count as recent).
  function withinMonths(date, now, months) { return dayNumber(addMonths(date, months)) >= dayNumber(now); }

  /* ---------- geometry ---------- */

  function latLng(o) {
    if (!isObj(o)) return null;
    var lat = num(o.lat), lng = num(o.lng);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }
  function haversineKm(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /* ======================= public primitives ======================= */

  // anchors: [x, score] pairs, x ascending. Linear between anchors; clamps to the end scores.
  function interpolate(anchors, x) {
    if (!Array.isArray(anchors) || !anchors.length || !isNum(x)) return null;
    var first = anchors[0], last = anchors[anchors.length - 1];
    if (x <= first[0]) return first[1];
    if (x >= last[0]) return last[1];
    for (var i = 1; i < anchors.length; i++) {
      var a = anchors[i - 1], b = anchors[i];
      if (x <= b[0]) {
        var span = b[0] - a[0];
        return span > 0 ? a[1] + ((x - a[0]) / span) * (b[1] - a[1]) : b[1];
      }
    }
    return last[1];
  }

  function bandFor(score) {
    if (!isNum(score)) return null;
    if (score >= TABLE.bands.halo_min) return 'halo';
    if (score < TABLE.bands.failo_below) return 'failo';
    return 'meh';
  }

  /* ======================= context ======================= */

  function normProfile(profile) {
    var p = isObj(profile) ? profile : {};
    var b = isObj(p.budget) ? p.budget : {};
    var picked = [];
    (Array.isArray(p.priorities) ? p.priorities : []).forEach(function (k) {
      if (typeof k === 'string' && own(TABLE.priorities, k) && picked.indexOf(k) < 0 &&
          picked.length < TABLE.weights.max_picked) picked.push(k);
    });
    return {
      mode: b.mode === 'buy' ? 'buy' : 'rent',
      income_week: pos(p.income_week),
      max_rent_week: pos(b.max_rent_week),
      max_price: pos(b.max_price),
      priorities: picked,
      has_work_address: !!str(p.work_address)
    };
  }

  function makeCtx(facts, profile, opts) {
    var f = isObj(facts) ? facts : {};
    var p = normProfile(profile);
    var now = (isObj(opts) && ymd(opts.now)) || ymd(new Date());
    return { f: f, p: p, mode: p.mode, now: now, missing: isObj(f.missing) ? f.missing : {}, no_facts: !isObj(facts) };
  }

  function start(key, ctx) {
    var spec = TABLE.dimensions[key];
    var picked = ctx.p.priorities.some(function (k) { return TABLE.priorities[k].dimension === key; });
    return {
      key: key, priority: spec.priority, label: spec.label,
      score: null, band: null,
      weight: picked ? TABLE.weights.picked : TABLE.weights.base, picked: picked,
      fact: null, via: [], as_of: null, blank_reason: null, notes: [],
      labels: { halo: spec.labels.halo, failo: spec.labels.failo }   // short halo/failo labels used by Items
    };
  }

  function blank(d, reason) { d.score = null; d.band = null; d.blank_reason = reason || 'No data'; return d; }
  function done(d, raw) {
    if (!isNum(raw)) return blank(d, d.blank_reason);
    d.score = Math.round(clamp(raw, TABLE.scale.min, TABLE.scale.max));
    d.band = bandFor(d.score);
    d.blank_reason = null;
    return d;
  }
  // Copies the proxy's own reason for an absent fact into the notes (e.g. "rent_advert: no_data:...").
  function noteMissing(d, ctx, keys) {
    if (ctx.no_facts) { d.notes.push('no facts for this listing'); return; }
    keys.forEach(function (k) { if (own(ctx.missing, k)) d.notes.push(k + ': ' + String(ctx.missing[k])); });
  }

  /* ======================= the six dimensions ======================= */

  function pickRent(f, now, maxAgeMonths) {
    var adv = isObj(f.rent_advert) && pos(f.rent_advert.weekly_rent) !== null ? f.rent_advert : null;
    var est = isObj(f.rent_estimate) && pos(f.rent_estimate.weekly_rent) !== null ? f.rent_estimate : null;
    var advWhen = adv ? (str(adv.date) || str(adv.as_of)) : null;
    var advDate = advWhen ? ymd(advWhen) : null;
    if (adv && advDate && withinMonths(advDate, now, maxAgeMonths)) {
      return { R: pos(adv.weekly_rent), fact: adv, as_of: str(adv.as_of) || str(adv.date), note: 'latest rent advert (' + advWhen + ')' };
    }
    var stale = adv ? (advDate ? 'rent advert older than ' + maxAgeMonths + ' months (' + advWhen + ')' : 'rent advert has no date') : null;
    if (est) {
      var basis = [str(est.basis), str(est.property_type)].filter(Boolean).join(', ');
      return { R: pos(est.weekly_rent), fact: est, as_of: str(est.as_of),
        note: 'rent estimate' + (basis ? ' (' + basis + ')' : '') + (stale ? '; ' + stale : '') };
    }
    if (adv) return { R: pos(adv.weekly_rent), fact: adv, as_of: str(adv.as_of) || str(adv.date), note: stale + '; no rent estimate' };
    return null;
  }

  function affordability(d, ctx) {
    var spec = TABLE.dimensions.affordability, f = ctx.f, p = ctx.p;
    var subs = [], parts, s, b, m;

    if (ctx.mode === 'buy') {
      var avm = isObj(f.avm) ? f.avm : null;
      var P = avm ? pos(avm.predicted_price) : null;
      if (P === null) { noteMissing(d, ctx, ['avm']); return blank(d, spec.blank.no_valuation); }
      d.via = list(avm.via);
      d.as_of = str(avm.as_of);
      parts = ['Est. ' + money(P)];
      if (p.income_week !== null) {
        m = P / (p.income_week * spec.buy.weeks_per_year);
        s = interpolate(spec.buy.income_multiple, m);
        subs.push(s);
        parts.push(multiple(m) + ' income');
        d.notes.push('income multiple ' + multiple(m) + ' -> ' + Math.round(s));
      }
      if (p.max_price !== null) {
        b = P / p.max_price;
        s = interpolate(spec.buy.budget_ratio, b);
        subs.push(s);
        if (p.income_week === null) parts.push(pctOf(b) + ' of budget');
        d.notes.push('price vs budget ' + pctOf(b) + ' -> ' + Math.round(s));
      }
      d.fact = { display: parts.join(' · '), value: P, unit: '$' };
      if (!subs.length) return blank(d, spec.blank.no_inputs);
      return done(d, Math.min.apply(null, subs));
    }

    var rent = pickRent(f, ctx.now, spec.rent.advert_max_age_months);
    if (!rent) { noteMissing(d, ctx, ['rent_advert', 'rent_estimate']); return blank(d, spec.blank.no_rent); }
    var R = rent.R;
    d.via = list(rent.fact.via);
    d.as_of = rent.as_of || null;
    d.notes.push(rent.note);
    parts = [wholeMoney(R) + '/wk'];
    if (p.income_week !== null) {
      s = interpolate(spec.rent.income_share, R / p.income_week);
      subs.push(s);
      parts.push(pctOf(R / p.income_week) + ' of income');
      d.notes.push('rent is ' + pctOf(R / p.income_week) + ' of income -> ' + Math.round(s));
    }
    if (p.max_rent_week !== null) {
      b = R / p.max_rent_week;
      s = interpolate(spec.rent.budget_ratio, b);
      subs.push(s);
      if (p.income_week === null) parts.push(pctOf(b) + ' of budget');
      d.notes.push('rent is ' + pctOf(b) + ' of budget -> ' + Math.round(s));
    }
    d.fact = { display: parts.join(' · '), value: R, unit: '$/wk' };
    if (!subs.length) return blank(d, spec.blank.no_inputs);
    return done(d, Math.min.apply(null, subs));
  }

  function commute(d, ctx) {
    var spec = TABLE.dimensions.commute, f = ctx.f;
    var loc = latLng(f.location);
    var work = latLng(f.work);
    var tr = isObj(f.transport) ? f.transport : null;
    var nearest = tr && isObj(tr.nearest) ? tr.nearest : {};
    var fast = null;
    spec.fast_modes.forEach(function (mode) {
      var m = isObj(nearest[mode]) ? nonNeg(nearest[mode].distance_m) : null;
      if (m !== null && (!fast || m < fast.m)) fast = { mode: mode, m: m };
    });
    var bus = isObj(nearest.bus) ? nonNeg(nearest.bus.distance_m) : null;
    var parts = [];

    if (work && loc) {
      var k = haversineKm(loc, work);
      var base = interpolate(spec.work_distance_km, k);
      var bo = spec.bonus, bonus = 0;
      if (fast && fast.m <= bo.fast_stop_within_m) bonus = bo.fast_stop_points;
      else if (bus !== null && bus <= bo.bus_within_m) bonus = bo.bus_points;
      parts.push(km(k) + ' to ' + (shortPlace(f.work.display_name) || 'work'));
      if (fast) parts.push(fast.mode + ' ' + dist(fast.m));
      else if (bus !== null) parts.push('bus ' + dist(bus));
      d.fact = { display: parts.join(' · '), value: r2(k), unit: 'km' };
      d.via = list([].concat(list(f.work.via), list(f.location.via), tr ? list(tr.via) : []));
      d.notes.push('straight-line distance to ' + (str(f.work.display_name) || 'work') + ' -> ' + Math.round(base));
      if (bonus) d.notes.push('transit bonus +' + bonus);
      if (!tr) { d.notes.push('no transport data: no transit bonus'); noteMissing(d, ctx, ['transport']); }
      return done(d, Math.min(bo.cap, base + bonus));
    }

    d.labels = { halo: spec.labels_no_work.halo, failo: spec.labels_no_work.failo };
    if (work && !loc) d.notes.push('property location unknown: scored on transit only');
    else if (ctx.p.has_work_address) { d.notes.push('work address not located: scored on transit only'); noteMissing(d, ctx, ['work']); }
    else d.notes.push('no work address in profile: scored on transit only');
    if (!tr) { noteMissing(d, ctx, ['transport']); return blank(d, spec.blank.no_data); }

    var t = spec.transit_only, score, value = null;
    d.via = list(tr.via);
    if (fast) {
      score = interpolate(t.fast_stop_m, fast.m);
      value = fast.m;
      parts.push(capFirst(fast.mode) + ' ' + dist(fast.m));
      if (bus !== null) parts.push('bus ' + dist(bus));
    } else if (bus !== null) {
      score = bus <= t.bus_within_m ? t.bus_only_score : t.no_stop_score;
      value = bus;
      parts.push('Bus ' + dist(bus));
      d.notes.push(bus <= t.bus_within_m ? 'no train, tram or ferry: bus stop within ' + t.bus_within_m + ' m'
        : 'no train, tram or ferry, and no bus within ' + t.bus_within_m + ' m');
    } else {
      score = t.no_stop_score;
      var radius = pos(tr.radius_m);
      parts.push(radius ? 'No stop within ' + dist(radius) : 'No stop nearby');
    }
    d.fact = { display: parts.join(' · '), value: value === null ? null : Math.round(value), unit: 'm' };
    return done(d, score);
  }

  function safety(d, ctx) {
    var spec = TABLE.dimensions.safety, f = ctx.f;
    var c = isObj(f.crime) ? f.crime : null;
    if (!c) { noteMissing(d, ctx, ['crime']); return blank(d, spec.blank.no_crime); }
    var block = nonNeg(c.rate), sub = pos(c.suburb_median), nat = pos(c.national_median);
    var rate = block !== null ? block : sub;
    if (rate === null) { noteMissing(d, ctx, ['crime']); return blank(d, spec.blank.no_crime); }
    var unit = str(c.unit) || 'predicted incidents per 100,000 residents per year';
    d.via = list(c.via);
    d.as_of = str(c.as_of);
    if (block === null) d.notes.push('mesh block not in the crime data: suburb median used');
    if (nat === null) {
      d.fact = { display: 'Crime ' + Math.round(rate).toLocaleString('en-AU') + ' per 100k', value: rate, unit: unit };
      return blank(d, spec.blank.no_benchmark);
    }
    var ratio = rate / nat;
    var score = interpolate(spec.vs_national, ratio);
    var parts = ['Crime ' + times(ratio) + ' national'];
    d.notes.push((block !== null ? 'mesh-block' : 'suburb') + ' rate ' + times(ratio) + ' national median -> ' + Math.round(score));
    if (block !== null && sub !== null) {
      var w = spec.within_suburb, rs = block / sub;
      parts.push(times(rs) + ' suburb');
      if (rs <= w.low_ratio) { score += w.low_points; d.notes.push('below the suburb median: ' + w.low_points); }
      else if (rs >= w.high_ratio) { score += w.high_points; d.notes.push('above the suburb median: ' + w.high_points); }
    } else if (block === null) {
      parts[0] += ' (suburb median)';
    }
    if (isObj(f.flood) && f.flood.on_property === true) {
      score += spec.flood_on_property_points;
      d.notes.push('flood overlay on property: ' + spec.flood_on_property_points);
      d.via = list(d.via.concat(list(f.flood.via)));
    }
    d.fact = { display: parts.join(' · '), value: r2(ratio), unit: 'x national median' };
    return done(d, clamp(score, spec.clamp[0], spec.clamp[1]));
  }

  function liveliness(d, ctx) {
    var spec = TABLE.dimensions.liveliness;
    var a = isObj(ctx.f.amenities) ? ctx.f.amenities : null;
    if (!a || !isObj(a.counts)) { noteMissing(d, ctx, ['amenities']); return blank(d, spec.blank.no_amenities); }
    var counts = {}, A = 0;
    Object.keys(spec.points).forEach(function (k) {
      var n = nonNeg(a.counts[k]);
      if (n === null) { n = 0; d.notes.push(k + ' count missing: counted as 0'); }
      counts[k] = n;
      A += spec.points[k] * n;
    });
    var radius = pos(a.radius_m);
    var display = [counts.restaurant + ' food & drink', plural(counts.supermarket, 'supermarket'),
      plural(counts.green_spaces, 'park')].join(' · ') + (radius ? ' in ' + dist(radius) : '');
    d.fact = { display: display, value: A, unit: 'amenity points' };
    d.via = list(a.via);
    d.notes.push('amenity points ' + A + ' (food & drink x1, supermarkets x3, parks x2)');
    return done(d, interpolate(spec.amenity_points, A));
  }

  function quiet(d, ctx) {
    var spec = TABLE.dimensions.quiet;
    var br = isObj(ctx.f.busy_road) ? ctx.f.busy_road : null;
    if (!br) { noteMissing(d, ctx, ['busy_road']); return blank(d, spec.blank.no_roads); }
    d.via = list(br.via);
    if (num(br.segments) === 0) {
      d.fact = { display: spec.no_segments_display, value: null, unit: 'm' };
      return done(d, spec.no_segments_score);
    }
    var D = nonNeg(br.nearest_m);
    if (D === null) { noteMissing(d, ctx, ['busy_road', 'location']); return blank(d, spec.blank.no_distance); }
    var score = interpolate(spec.busy_road_m, D);
    var cls = str(br.road_class);
    var mr = spec.major_road;
    if (cls && D < mr.within_m && mr.classes.some(function (c) {
      var l = cls.toLowerCase(); return l === c || l === c + '_link';
    })) {
      score += mr.points;
      d.notes.push(cls + ' within ' + mr.within_m + ' m: ' + mr.points);
    }
    d.fact = { display: 'Busy road ' + dist(D) + (cls ? ' (' + cls + ')' : ''), value: Math.round(D), unit: 'm' };
    return done(d, clamp(score, spec.clamp[0], spec.clamp[1]));
  }

  function negotiability(d, ctx) {
    var spec = TABLE.dimensions.negotiability;
    var v = isObj(ctx.f.vacancy) ? ctx.f.vacancy : null;
    if (!v) { noteMissing(d, ctx, ['vacancy']); return blank(d, spec.blank.no_vacancy); }
    var blk = nonNeg(v.block_pct), sub = nonNeg(v.suburb_pct);
    var V = blk !== null ? blk : sub;
    if (V === null) { noteMissing(d, ctx, ['vacancy']); return blank(d, spec.blank.no_vacancy); }
    var score = interpolate(spec.vacancy_pct, V);
    if (blk !== null && sub !== null && sub > 0) {
      var r = blk / sub, m = spec.vs_suburb;
      if (r >= m.high_ratio) { score += m.high_points; d.notes.push('block vacancy well above the suburb: +' + m.high_points); }
      else if (r <= m.low_ratio) { score += m.low_points; d.notes.push('block vacancy well below the suburb: ' + m.low_points); }
    }
    d.fact = {
      display: blk !== null ? 'Vacancy ' + pct1(blk) + ' here' + (sub !== null ? ' · ' + pct1(sub) + ' suburb' : '')
        : 'Vacancy ' + pct1(sub) + ' (suburb)',
      value: V, unit: '%'
    };
    d.via = list(v.via);
    d.as_of = str(v.as_of);
    if (blk === null) d.notes.push('mesh-block vacancy unknown: suburb figure used');
    if (str(v.property_type)) d.notes.push('vacancy for ' + str(v.property_type) + 's');
    if (ctx.mode === 'buy') d.notes.push(spec.buy_mode_note);
    return done(d, clamp(score, spec.clamp[0], spec.clamp[1]));
  }

  var SCORERS = {
    affordability: affordability, commute: commute, safety: safety,
    liveliness: liveliness, quiet: quiet, negotiability: negotiability
  };

  /* ======================= public API ======================= */

  function scoreDimension(key, facts, profile, opts) {
    if (typeof key !== 'string' || !own(SCORERS, key)) return null;
    var ctx = makeCtx(facts, profile, opts);
    return SCORERS[key](start(key, ctx), ctx);
  }

  function toItem(d, kind) {
    return {
      key: d.key, kind: kind, label: d.labels[kind],
      number: d.fact ? d.fact.display : '',
      score: d.score, via: d.via.slice(), as_of: d.as_of, picked: d.picked
    };
  }

  function scoreListing(facts, profile, opts) {
    var ctx = makeCtx(facts, profile, opts);
    var dims = DIMENSIONS.map(function (k) { return SCORERS[k](start(k, ctx), ctx); });

    var sumW = 0, sumWS = 0, scored = 0;
    dims.forEach(function (d) {
      if (isNum(d.score)) { sumW += d.weight; sumWS += d.weight * d.score; scored++; }
    });
    var total = sumW > 0 ? Math.round(sumWS / sumW) : null;

    var order = {};
    DIMENSIONS.forEach(function (k, i) { order[k] = i; });
    function byPicked(a, b) { return (b.picked ? 1 : 0) - (a.picked ? 1 : 0); }

    var halos = dims.filter(function (d) { return isNum(d.score) && d.score >= TABLE.bands.halo_min; })
      .sort(function (a, b) { return byPicked(a, b) || (b.score - a.score) || (order[a.key] - order[b.key]); })
      .map(function (d) { return toItem(d, 'halo'); });

    var failos = dims.filter(function (d) { return isNum(d.score) && d.score < TABLE.bands.failo_below; })
      .sort(function (a, b) { return byPicked(a, b) || (a.score - b.score) || (order[a.key] - order[b.key]); })
      .map(function (d) { return toItem(d, 'failo'); });

    var flood = ctx.f.flood;
    if (isObj(flood) && flood.on_property === true) {
      var via = list(flood.via);
      failos.push({
        key: TABLE.flood_failo.key, kind: 'failo', label: TABLE.flood_failo.label,
        number: TABLE.flood_failo.number, score: null,
        via: via.length ? via : [TABLE.flood_failo.via], as_of: null, picked: false
      });
    }

    return {
      total: total,
      band: bandFor(total),
      mode: ctx.mode,
      coverage: { scored: scored, of: DIMENSIONS.length },
      dimensions: dims,
      halos: halos,
      failos: failos,
      blank: dims.filter(function (d) { return d.score === null; }).map(function (d) { return d.key; })
    };
  }

  var api = {
    TABLE: TABLE,
    PRIORITIES: PRIORITIES,
    DIMENSIONS: DIMENSIONS,
    PRIORITY_LABELS: PRIORITY_LABELS,
    DIMENSION_LABELS: DIMENSION_LABELS,
    interpolate: interpolate,
    bandFor: bandFor,
    scoreDimension: scoreDimension,
    scoreListing: scoreListing,
    haversineKm: haversineKm
  };
  return api;
});
