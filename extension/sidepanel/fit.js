// Simple fit display for the native side panel. Facts and scores come from the existing adapter/scorer.

  var nextId = 0;
  var spectrum = [
    ['0%', 'var(--mbx-spectrum-low, #e27470)'],
    ['48%', 'var(--mbx-spectrum-mid, #edbd64)'],
    ['100%', 'var(--mbx-spectrum-high, #44ae91)']
  ];

  function renderMeter(container, props) {
    var doc = container.ownerDocument;
    var root = doc.createElement('div');
    root.className = 'mbx-meter mm-speedo';
    root.setAttribute('aria-live', 'polite');

    function svgElement(tag, attrs, parent) {
      var element = doc.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.keys(attrs).forEach(function (key) { element.setAttribute(key, attrs[key]); });
      parent.appendChild(element);
      return element;
    }

    var svg = svgElement('svg', {
      viewBox: '0 0 216 108', class: 'mbx-meter__gauge', 'aria-hidden': 'true', focusable: 'false'
    }, root);
    var gradientId = 'mbx-fit-spectrum-' + (++nextId);
    var defs = svgElement('defs', {}, svg);
    var gradient = svgElement('linearGradient', { id: gradientId }, defs);
    spectrum.forEach(function (stop) {
      var element = svgElement('stop', { offset: stop[0] }, gradient);
      element.style.stopColor = stop[1];
    });
    svgElement('path', {
      d: 'M18 99 A90 90 0 0 1 198 99', class: 'mbx-meter__arc',
      fill: 'none', stroke: 'url(#' + gradientId + ')', 'stroke-width': 12, 'stroke-linecap': 'round'
    }, svg);
    var needle = svgElement('g', { class: 'mbx-meter__needle' }, svg);
    svgElement('path', { d: 'M40 99 L108 96 L113 99 L108 102 Z' }, needle);
    svgElement('circle', { cx: 108, cy: 99, r: 5 }, needle);

    var readout = doc.createElement('p');
    readout.className = 'mbx-meter__readout';
    var value = doc.createElement('strong');
    value.className = 'mbx-meter__value';
    var scale = doc.createElement('span');
    scale.textContent = ' / 100';
    readout.append(value, scale);
    var note = doc.createElement('p');
    note.className = 'mbx-meter__note';
    root.append(readout, note);
    container.replaceChildren(root);
    var sweep = null;

    function update(next) {
      var from = doc.defaultView.getComputedStyle(needle).transform;
      if (sweep) sweep.cancel();
      var total = next && next.total;
      var hasScore = Number.isFinite(total) && total >= 0 && total <= 100;
      var coverage = next && next.coverage;
      root.dataset.total = hasScore ? String(total) : '';
      root.dataset.fit = root.dataset.total;
      svg.style.visibility = hasScore ? '' : 'hidden';
      readout.hidden = !hasScore;
      if (hasScore) {
        value.textContent = String(total);
        needle.style.transform = 'rotate(' + (total * 1.8) + 'deg)';
        if (!doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          sweep = needle.animate([
            { transform: from === 'none' ? 'rotate(0deg)' : from },
            { transform: needle.style.transform }
          ], { duration: 900, easing: 'cubic-bezier(.22,.8,.26,1)' });
        }
      }
      note.textContent = !hasScore ? 'Not enough data to rate this home'
        : coverage && coverage.scored < coverage.of ? 'Based on ' + coverage.scored + ' of ' + coverage.of + ' pillars' : '';
      svg.hidden = !hasScore;
    }

    update(props);
    return { update: update, el: root, destroy: function () { if (sweep) sweep.cancel(); root.remove(); } };
  }


  function renderInsights(container, summary) {
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
      row.classList.add('mm-slider');
      row.dataset.pillar = item.label;
      row.dataset.dim = item.key;
      row.dataset.score = item.score === null ? '' : String(item.score);
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
          if (fact.source || fact.asOf) entry.appendChild(element('dd', 'mbx-fit__source',
            [fact.source, fact.asOf].filter(Boolean).join(' · ')));
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

// Only reported evidence is shown; unavailable signals do not become placeholder numbers.
export function summarizeFit(result, trusted = true) {
  if (!trusted) return { total: null, coverage: { scored: 0, of: 4 }, pillars: [], pros: [], cons: [] };
  const dimensions = result?.dimensions || [];
  const pillars = dimensions.map(dimension => ({
    key: dimension.key,
    label: dimension.label,
    score: Number.isFinite(dimension.score) ? dimension.score : null,
    rows: (dimension.signals || []).filter(signal => signal.available === true &&
      typeof signal.display === 'string' && signal.display !== 'No data').map(signal => ({
        label: signal.label,
        value: signal.inputs?.rentWeekly > 0 ? `$${signal.inputs.rentWeekly.toLocaleString('en-AU')}/wk · ${signal.display}` :
          signal.key === 'work_distance' || signal.key === 'cbd_distance' ? `${signal.display} (straight-line)` : signal.display,
        source: signal.source,
        asOf: signal.asOf,
      })),
  }));
  const itemText = item => [item.label, item.display].filter(Boolean).join(' · ');
  return {
    total: Number.isFinite(result?.fit) ? result.fit : null,
    coverage: { scored: pillars.filter(pillar => pillar.score !== null).length, of: pillars.length },
    pillars,
    pros: (result?.halos || []).slice(0, 2).map(itemText),
    cons: (result?.failos || []).slice(0, 2).map(itemText),
  };
}

export function renderFit(container, result, options = {}) {
  const root = container.ownerDocument.createElement('div');
  root.className = 'mbx-body';
  const gauge = container.ownerDocument.createElement('div');
  gauge.className = 'mm-score';
  const label = container.ownerDocument.createElement('p');
  label.className = 'mm-label';
  label.textContent = 'Your fit score';
  const meterSlot = container.ownerDocument.createElement('div');
  gauge.append(label, meterSlot);
  const insights = container.ownerDocument.createElement('div');
  insights.className = 'mbx-insights-slot';
  const confirm = container.ownerDocument.createElement('p');
  confirm.className = 'mbx-fit__empty';
  confirm.textContent = 'Confirm the address to see this home’s fit.';
  root.append(gauge, insights, confirm);
  container.replaceChildren(root);
  let meter = null;
  let identity = null;
  function update(next, opts = {}) {
    const trusted = opts.trusted !== false;
    const summary = summarizeFit(next, trusted);
    if (identity !== opts.identity) insights.replaceChildren();
    identity = opts.identity;
    gauge.hidden = !trusted;
    confirm.hidden = trusted;
    if (trusted) {
      if (meter) meter.update(summary);
      else meter = renderMeter(meterSlot, summary);
    }
    renderInsights(insights, summary);
  }
  update(result, options);
  return { update, el: root };
}
