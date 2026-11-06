// Dev-only sample states for preview.html. Every address and figure here is invented
// (Example / Sample / Placeholder streets): nothing is copied from a real listing or the API.
(function () {
  'use strict';

  var LISTING = '1 Example Street, Surry Hills NSW 2010';

  function unavailable(message) {
    return { available: false, reason: 'no_data', message: message };
  }

  var ok = {
    status: 'ok',
    mode: 'mock',
    query: '5/12 Example Street, Surry Hills NSW 2010',
    cached: false,
    fetched_at: '2026-11-07T10:15:00+11:00',
    match: {
      gnaf_id: 'GANSW000000012',
      display_name: '12 Example Street, Surry Hills NSW 2010',
      property_type: 'unit',
      suburb: 'Surry Hills',
      suburb_label: 'Surry Hills',
      rank: 2,
      check: {
        verdict: 'partial',
        number: false,
        street: true,
        suburb: true,
        notes: ['Unit 5 is not in the matched address']
      }
    },
    candidates: [
      { display_name: '12 Example Street, Redcliffe QLD 4020', gnaf_id: 'GAQLD000000012', in_coverage: false, why_skipped: 'QLD, outside the City of Sydney' },
      { display_name: '12 Example Street, Surry Hills NSW 2010', gnaf_id: 'GANSW000000012', in_coverage: true, why_skipped: null },
      { display_name: '12 Example Lane, Surry Hills NSW 2010', gnaf_id: 'GANSW000000013', in_coverage: true, why_skipped: null }
    ],
    sections: {
      valuation: { available: true, data: { predicted_price: 1130000, predicted_price_low: 985000, predicted_price_high: 1270000, prediction_date: '2026-10-19', confidence_score: 68 } },
      basics: { available: true, data: { bed_count: 2, bath_count: 1, parking_count: 1, dwelling_type: 'unit', land_area_sqm: null } },
      sales: {
        available: true,
        data: [
          { address: '3/40 Sample Road, Surry Hills NSW 2010', price: 1085000, date_sold: '2024-08-12', dist_km: 0.065, bedrooms: 2, bathrooms: 1, property_type: 'unit' },
          { address: 'Unit 1204, 100-104 Placeholder Avenue, Surry Hills NSW 2010', price: 948000, date_sold: '2024-06-03', dist_km: 0.21, bedrooms: 2, bathrooms: 2, property_type: 'unit' },
          { address: '7 Demo Lane, Surry Hills NSW 2010', price: 1420000, date_sold: '2024-03-21', dist_km: 0.38, bedrooms: 3, bathrooms: 2, property_type: 'house' }
        ]
      },
      rent: { available: true, data: { weekly_rent: 820, date: '2026-08-14', address: '5/12 Example Street, Surry Hills NSW 2010' } },
      da: {
        available: true,
        data: {
          address: '20 Example Street, Surry Hills NSW 2010',
          suburb: 'Surry Hills',
          date: '2026-09-02',
          category: 'Alterations and additions',
          description: 'Alterations and additions to an existing two-storey terrace, including a rear ground-floor extension, a new first-floor bathroom, a roof terrace with privacy screens, internal reconfiguration and landscaping of the rear courtyard.',
          distance_m: 120,
          basis: 'nearest'
        }
      }
    },
    error: null
  };

  var okLiveExact = {
    status: 'ok',
    mode: 'live',
    query: '8 Sample Street, Waterloo NSW 2017',
    cached: true,
    fetched_at: '2026-11-07T10:16:00+11:00',
    match: {
      gnaf_id: 'GANSW000000008',
      display_name: '8 Sample Street, Waterloo NSW 2017',
      property_type: 'house',
      suburb: 'Waterloo (NSW)',
      suburb_label: 'Waterloo',
      rank: 1,
      check: { verdict: 'exact', number: true, street: true, suburb: true, notes: [] }
    },
    candidates: [
      { display_name: '8 Sample Street, Waterloo NSW 2017', gnaf_id: 'GANSW000000008', in_coverage: true, why_skipped: null }
    ],
    sections: {
      valuation: { available: true, data: { predicted_price: 2450000, predicted_price_low: 2100000, predicted_price_high: 2800000, prediction_date: '2026-10-05', confidence_score: 82 } },
      basics: { available: true, data: { bed_count: 3, bath_count: 2, parking_count: 0, dwelling_type: 'HOUSE', land_area_sqm: 214 } },
      sales: {
        available: true,
        data: [
          { address: '14 Sample Street, Waterloo NSW 2017', price: 2310000, date_sold: '2025-02-11', dist_km: 0.04, bedrooms: 3, bathrooms: 2, property_type: 'house' },
          { address: '2 Demo Place, Waterloo NSW 2017', price: 1995000, date_sold: '2024-11-30', dist_km: 0.62, bedrooms: null, bathrooms: null, property_type: 'house' },
          { address: '51 Placeholder Road, Waterloo NSW 2017', price: 2600000, date_sold: '2024-09-07', dist_km: 1.24, bedrooms: 4, bathrooms: 2, property_type: 'house' }
        ]
      },
      rent: { available: true, data: { weekly_rent: 1250, date: '2026-07-01', address: '8 Sample Street, Waterloo NSW 2017' } },
      da: {
        available: true,
        data: {
          address: '30 Sample Street, Waterloo NSW 2017',
          suburb: 'Waterloo (NSW)',
          date: '2026-08-21',
          category: 'Demolition',
          description: 'Demolition of a rear garage.',
          distance_m: 95,
          basis: 'same_street'
        }
      }
    },
    error: null
  };

  var okSparse = {
    status: 'ok',
    mode: 'live',
    query: '9 Placeholder Lane, Ultimo NSW 2007',
    cached: false,
    fetched_at: '2026-11-07T10:17:00+11:00',
    match: {
      gnaf_id: 'GANSW000000009',
      display_name: '9 Placeholder Lane, Ultimo NSW 2007',
      property_type: null,
      suburb: 'Ultimo',
      suburb_label: 'Ultimo',
      rank: 1,
      check: { verdict: 'weak', number: null, street: true, suburb: false, notes: ['The listing text had no street number', 'Suburb on the listing differs from the matched suburb'] }
    },
    candidates: [
      { display_name: '9 Placeholder Lane, Ultimo NSW 2007', gnaf_id: 'GANSW000000009', in_coverage: true, why_skipped: null }
    ],
    sections: {
      valuation: unavailable('No automated valuation for this property.'),
      basics: { available: true, data: { bed_count: null, bath_count: null, parking_count: null, dwelling_type: null, land_area_sqm: null } },
      sales: unavailable('No comparable sales returned for this property.'),
      rent: unavailable('No rent adverts on record for this property.'),
      da: unavailable('No development applications listed for Ultimo.')
    },
    error: null
  };

  var okThin = {
    status: 'ok',
    mode: 'live',
    query: '4 Demo Street, Glebe NSW 2037',
    cached: false,
    fetched_at: '2026-11-07T10:18:00+11:00',
    match: {
      gnaf_id: 'GANSW000000004',
      display_name: '4 Demo Street, Glebe NSW 2037',
      property_type: 'house',
      suburb: 'Glebe',
      suburb_label: 'Glebe',
      rank: 1,
      check: { verdict: 'exact', number: true, street: true, suburb: true, notes: [] }
    },
    candidates: [
      { display_name: '4 Demo Street, Glebe NSW 2037', gnaf_id: 'GANSW000000004', in_coverage: true, why_skipped: null }
    ],
    sections: {
      valuation: { available: true, data: { predicted_price: 875000, predicted_price_low: 790000, predicted_price_high: 1010000, prediction_date: null, confidence_score: null } },
      basics: { available: true, data: { bed_count: 1, bath_count: null, parking_count: 1, dwelling_type: 'terrace', land_area_sqm: null } },
      sales: { available: true, data: [] },
      rent: { available: true, data: { weekly_rent: null, date: '2026-05-09', address: null } },
      da: { available: true, data: { address: null, suburb: 'Glebe', date: '2026-10-28', category: 'Change of use', description: null, distance_m: null, basis: 'latest_in_suburb' } }
    },
    error: null
  };

  var noMatch = {
    status: 'no_match', mode: 'mock', query: 'Flat 3, Nowhere Plaza', cached: false,
    fetched_at: '2026-11-07T10:19:00+11:00', match: null, candidates: [], sections: null, error: null
  };

  var outside = {
    status: 'outside_coverage', mode: 'live', query: '12 Example Street, Parramatta NSW 2150', cached: false,
    fetched_at: '2026-11-07T10:20:00+11:00', match: null,
    candidates: [
      { display_name: '12 Example Street, Parramatta NSW 2150', gnaf_id: 'GANSW000000120', in_coverage: false, why_skipped: 'Parramatta is outside the City of Sydney' },
      { display_name: '12 Example Street, Redcliffe QLD 4020', gnaf_id: 'GAQLD000000012', in_coverage: false, why_skipped: 'QLD, outside the City of Sydney' },
      { display_name: '12 Example Avenue, Penrith NSW 2750', gnaf_id: 'GANSW000000121', in_coverage: false, why_skipped: 'Penrith is outside the City of Sydney' },
      { display_name: '12 Example Road, Hobart TAS 7000', gnaf_id: 'GATAS000000012', in_coverage: false, why_skipped: 'TAS, outside the City of Sydney' }
    ],
    sections: null, error: null
  };

  var upstreamError = {
    status: 'error', mode: 'live', query: LISTING, cached: false,
    fetched_at: '2026-11-07T10:21:00+11:00', match: null, candidates: [], sections: null,
    error: { code: 'upstream_unavailable', message: 'Microburbs did not respond. Try again in a minute.', request_id: 'req_7f3a9c21' }
  };

  window.MBX_FIXTURES = {
    listing: LISTING,
    states: {
      'ok': { kind: 'result', address: '5/12 Example Street, Surry Hills NSW 2010', source: 'json-ld', blob: ok },
      'ok-live-exact': { kind: 'result', address: '8 Sample Street, Waterloo NSW 2017', source: 'h1', blob: okLiveExact },
      'ok-sparse': { kind: 'result', address: 'Placeholder Lane, Ultimo', source: 'title', blob: okSparse },
      'ok-thin': { kind: 'result', address: '4 Demo Street, Glebe NSW 2037', source: 'typed', blob: okThin },
      'no_match': { kind: 'result', address: 'Flat 3, Nowhere Plaza', source: 'typed', blob: noMatch },
      'outside_coverage': { kind: 'result', address: '12 Example Street, Parramatta NSW 2150', source: 'json-ld', blob: outside },
      'error': { kind: 'result', address: LISTING, source: 'h1', blob: upstreamError },
      'detecting': { kind: 'detecting' },
      'need_address': { kind: 'need_address', reason: 'not_found' },
      'loading': { kind: 'loading', address: LISTING, source: 'h1' },
      'transport_error': {
        kind: 'error', address: LISTING, source: 'h1',
        message: 'Could not reach the Listing Check proxy.',
        detail: 'Is it running? TypeError: Failed to fetch'
      }
    }
  };
})();
