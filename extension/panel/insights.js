globalThis.MBX = globalThis.MBX || {};

(function (MBX) {
  'use strict';

  var money = new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD', maximumFractionDigits: 0
  });

  function dimension(score, key) {
    return score && Array.isArray(score.dimensions)
      ? score.dimensions.find(function (item) { return item.key === key; }) : null;
  }

  function average(items) {
    var available = items.filter(function (item) { return item && Number.isFinite(item.score); });
    var weight = available.reduce(function (sum, item) { return sum + item.weight; }, 0);
    return weight ? {
      score: Math.round(available.reduce(function (sum, item) { return sum + item.score * item.weight; }, 0) / weight),
      weight: Math.max.apply(null, available.map(function (item) { return item.weight; }))
    } : { score: null, weight: 0 };
  }

  function factText(item) {
    return item && item.fact ? item.fact.display : '';
  }

  function amenityText(facts) {
    var counts = facts.amenities && facts.amenities.counts;
    if (!counts) return '';
    var places = [['supermarket', 'supermarket'], ['green_spaces', 'park'], ['restaurant', 'food and drink venue']];
    if (!places.some(function (place) { return Number.isFinite(counts[place[0]]) && counts[place[0]] >= 0; })) return '';
    var present = places.filter(function (place) { return Number.isFinite(counts[place[0]]) && counts[place[0]] > 0; });
    if (!present.length) return 'No amenities in the surveyed categories';
    return present.slice(0, 2).map(function (place) {
      var count = counts[place[0]];
      return count + ' ' + place[1] + (count === 1 ? '' : 's');
    }).join(' · ');
  }

  function distance(value) {
    if (!Number.isFinite(value) || value < 0) return '';
    return value >= 1000 ? (value / 1000).toLocaleString('en-AU', { maximumFractionDigits: 1 }) + ' km'
      : Math.round(value).toLocaleString('en-AU') + ' m';
  }

  function sectionData(sections, key) {
    var section = sections && sections[key];
    return section && section.available === true && section.data ? section.data : {};
  }

  function summarize(score, facts, profile, trusted, sections) {
    facts = facts || {};
    var commute = dimension(score, 'commute');
    var safety = dimension(score, 'safety');
    var amenities = dimension(score, 'liveliness');
    var quiet = dimension(score, 'quiet');
    var price = dimension(score, 'affordability');
    if (!trusted) return { total: null, coverage: { scored: 0, of: 4 }, pillars: [], pros: [], cons: [] };

    var buying = score && score.mode === 'buy';
    var budget = profile && profile.budget;
    var maximum = budget && (buying ? budget.max_price : budget.max_rent_week);
    var priceValue = price && price.fact && price.fact.value;
    var suffix = buying ? '' : '/wk';
    var gap = Number.isFinite(priceValue) && Number.isFinite(maximum) && maximum > 0 ? priceValue - maximum : null;
    var priceLabel = buying ? 'Estimated value' : (price && price.via.some(function (source) {
      return source.indexOf('/rent-history') !== -1;
    }) ? 'Recorded rent' : 'Estimated rent');
    var priceText = Number.isFinite(priceValue) ? priceLabel + ' ' + money.format(priceValue) + suffix : '';
    var budgetText = gap === null ? '' : gap === 0 ? 'At your budget'
      : money.format(Math.abs(gap)) + suffix + (gap > 0 ? ' over budget' : ' under budget');

    var flood = facts.flood && facts.flood.on_property === true;
    var crime = facts.crime;
    var crimeRate = crime && (crime.basis === 'mesh_block' ? crime.rate : crime.suburb_median);
    var safetyText = '';
    if (crime && Number.isFinite(crimeRate) && Number.isFinite(crime.national_median) && crime.national_median > 0) {
      var ratio = crimeRate / crime.national_median;
      safetyText = 'Modelled crime ' + (ratio < 0.9 ? 'below' : ratio > 1.1 ? 'above' : 'near') + ' national benchmark';
    }
    var nearbyAmenities = amenityText(facts);
    if (!nearbyAmenities) amenities = null;
    var roadDistance = facts.busy_road && facts.busy_road.nearest_m;
    var roadText = Number.isFinite(roadDistance) && roadDistance >= 0
      ? 'Busy road ' + Math.round(roadDistance).toLocaleString('en-AU') + ' m away' : factText(quiet);
    var commuteText = factText(commute);
    if (commute && commute.fact && commute.fact.unit === 'km') commuteText += ' (straight-line)';

    var commuteRows = [], safetyRows = [], lifestyleRows = [], priceRows = [];
    function add(rows, label, value) { if (value) rows.push({ label: label, value: value }); }
    if (commute && commute.fact && commute.fact.unit === 'km') {
      add(commuteRows, 'Your destination', factText(commute).split(' · ')[0] + ' (straight-line)');
    }
    var stops = facts.transport && facts.transport.nearest;
    [['train', 'Train'], ['tram', 'Light rail'], ['bus', 'Bus'], ['ferry', 'Ferry']].forEach(function (mode) {
      var stop = stops && stops[mode[0]];
      var metres = stop && distance(stop.distance_m);
      if (metres) add(commuteRows, mode[1], [stop.label || stop.name, metres + ' away'].filter(Boolean).join(' · '));
    });
    var basics = sectionData(sections, 'basics');
    if (Number.isFinite(basics.parking_count) && basics.parking_count >= 0) {
      add(commuteRows, 'Parking', basics.parking_count + ' recorded space' + (basics.parking_count === 1 ? '' : 's'));
    }
    add(safetyRows, 'Crime model', safetyText);
    if (safetyText) add(safetyRows, 'Model period', typeof crime.as_of === 'string' ? crime.as_of : '');
    if (facts.flood && typeof facts.flood.on_property === 'boolean') {
      add(safetyRows, 'Flood overlay', flood ? 'Intersects this address' : 'No intersection recorded at this address');
    }
    var counts = facts.amenities && facts.amenities.counts;
    var radius = facts.amenities && distance(facts.amenities.radius_m);
    [['supermarket', 'Supermarkets'], ['green_spaces', 'Parks'], ['restaurant', 'Food and drink']].forEach(function (place) {
      var count = counts && counts[place[0]];
      if (Number.isFinite(count) && count >= 0) add(lifestyleRows, place[1], count + ' recorded' + (radius ? ' within ' + radius : ''));
    });
    add(lifestyleRows, 'Busy road', roadText);
    add(priceRows, priceLabel, Number.isFinite(priceValue) ? money.format(priceValue) + suffix : '');
    if (priceText && price.as_of) add(priceRows, 'Recorded date', price.as_of);
    if (Number.isFinite(maximum) && maximum > 0) add(priceRows, 'Your budget', money.format(maximum) + suffix);
    add(priceRows, 'Budget comparison', budgetText);
    var avm = facts.avm;
    if (buying && avm && Number.isFinite(avm.predicted_price_low) && avm.predicted_price_low > 0
        && Number.isFinite(avm.predicted_price_high) && avm.predicted_price_high >= avm.predicted_price_low) {
      add(priceRows, 'Estimated range', money.format(avm.predicted_price_low) + ' – ' + money.format(avm.predicted_price_high));
    }
    var da = sectionData(sections, 'da');
    if (typeof da.description === 'string' && da.description.trim()) {
      add(priceRows, da.basis === 'latest_in_suburb' ? 'Development in suburb' : 'Nearby development application',
        [da.address, da.description, da.date].filter(Boolean).join(' · '));
    }
    var pillars = [
      Object.assign({ label: 'Commute', rows: commuteRows }, average([commute])),
      Object.assign({ label: 'Safety', rows: safetyRows }, average([safety])),
      Object.assign({ label: 'Lifestyle', rows: lifestyleRows }, average([amenities, quiet])),
      Object.assign({ label: 'Price', rows: priceRows }, average([price]))
    ];
    var pros = [], cons = [];
    if (gap !== null && gap > 0) cons.push(budgetText);
    if (flood) cons.push('Flood overlay at this address');
    if (gap !== null && gap <= 0) pros.push(budgetText);
    if (commute && commute.score >= 70 && commuteText) pros.push(commuteText.split(' · ')[0]);
    if (amenities && amenities.score >= 70) pros.push(nearbyAmenities + ' nearby');
    if (commute && Number.isFinite(commute.score) && commute.score < 40 && commuteText) cons.push(commuteText);
    if (quiet && Number.isFinite(quiet.score) && quiet.score < 40 && roadText) cons.push(roadText);
    if (safety && Number.isFinite(safety.score) && safety.score < 40 && safetyText) cons.push(safetyText);
    if (price && Number.isFinite(price.score) && price.score < 40 && gap === null && priceText) cons.push(priceText);

    return {
      total: average(pillars).score,
      coverage: { scored: pillars.filter(function (item) { return item.score !== null; }).length, of: pillars.length },
      pillars: pillars, pros: pros.slice(0, 2), cons: cons.slice(0, 2)
    };
  }

  function render(container, summary) {
    var doc = container.ownerDocument;
    var opened = container.querySelector('.mbx-fit__pillar[open]');
    var openPillar = opened && opened.dataset.pillar;
    var positions = Object.create(null);
    container.querySelectorAll('.mbx-fit__track').forEach(function (track) {
      var width = track.getBoundingClientRect().width;
      var left = parseFloat(doc.defaultView.getComputedStyle(track, '::after').left);
      if (width > 0 && Number.isFinite(left)) {
        positions[track.getAttribute('aria-label')] = Math.max(0, Math.min(100, left / width * 100));
      }
    });
    function element(tag, className, text) {
      var node = doc.createElement(tag);
      if (className) node.className = className;
      if (text) node.textContent = text;
      return node;
    }
    var content = doc.createDocumentFragment();
    if (summary.pros.length || summary.cons.length) {
      var columns = element('div', 'mbx-fit__columns');
      [ ['Pros', summary.pros], ['Cons', summary.cons] ].forEach(function (group) {
        var section = element('section', 'mbx-fit__column');
        section.appendChild(element('h3', '', group[0]));
        if (group[1].length) {
          var list = element('ul');
          group[1].forEach(function (text) { list.appendChild(element('li', '', text)); });
          section.appendChild(list);
        } else section.appendChild(element('p', 'mbx-fit__muted', 'None flagged'));
        columns.appendChild(section);
      });
      content.appendChild(columns);
    }

    var pillars = element('div', 'mbx-fit__pillars');
    summary.pillars.forEach(function (item) {
      var row = element('details', 'mbx-fit__pillar');
      row.dataset.pillar = item.label;
      row.setAttribute('name', 'mbx-fit-pillars');
      row.open = item.label === openPillar;
      var heading = element('summary', 'mbx-fit__toggle');
      heading.appendChild(element('span', 'mbx-fit__title', item.label));
      var chevron = element('span', 'mbx-fit__chevron');
      chevron.setAttribute('aria-hidden', 'true');
      heading.appendChild(chevron);
      if (item.score !== null) {
        var track = element('div', 'mbx-fit__track');
        track.setAttribute('role', 'meter');
        track.setAttribute('aria-label', item.label + ' fit');
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.setAttribute('aria-valuenow', String(item.score));
        track.style.setProperty('--mbx-from', (positions[item.label + ' fit'] || 0) + '%');
        track.style.setProperty('--mbx-position', item.score + '%');
        heading.appendChild(track);
      } else {
        heading.appendChild(element('span', 'mbx-fit__muted', 'Not rated'));
      }
      row.appendChild(heading);
      var detail = element('div', 'mbx-fit__detail');
      if (item.rows && item.rows.length) {
        var list = element('dl', 'mbx-fit__facts');
        item.rows.forEach(function (fact) {
          var entry = element('div', 'mbx-fit__fact');
          entry.appendChild(element('dt', '', fact.label));
          entry.appendChild(element('dd', '', fact.value));
          list.appendChild(entry);
        });
        detail.appendChild(list);
      } else detail.appendChild(element('p', 'mbx-fit__muted', 'No data available'));
      row.appendChild(detail);
      pillars.appendChild(row);
    });
    if (summary.pillars.length) content.appendChild(pillars);
    container.replaceChildren(content);
  }

  MBX.insights = { summarize: summarize, render: render };
})(globalThis.MBX);
