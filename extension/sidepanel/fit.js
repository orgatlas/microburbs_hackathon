import { loadProfile } from './profile.js';

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
          group[1].forEach(function (line) {
            var li = element('li');
            li.appendChild(element('span', 'mbx-fit__fact-main', typeof line === 'string' ? line : line.main));
            if (line && line.src) li.appendChild(element('span', 'mbx-fit__fact-src', line.src));
            list.appendChild(li);
          });
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
          entry.appendChild(element('dt', 'mbx-fit__fact-main', fact.main || [fact.label, fact.value].filter(Boolean).join(' · ')));
          if (fact.src) entry.appendChild(element('dd', 'mbx-fit__fact-src', fact.src));
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

// The saved profile (chrome.storage.local.profile) when there is one; null otherwise (no default persona). Never blocks.
let cachedProfile = null;
try {
  if (globalThis.chrome?.storage?.local) {
    const refreshProfile = () => loadProfile().then(p => { cachedProfile = p || null; }).catch(() => {});
    refreshProfile();
    globalThis.chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === 'local' && changes && 'profile' in changes) refreshProfile();
    });
  }
} catch { /* no extension storage (tests, scratch pages): no profile */ }

// Straight-line speeds (km/h) for the estimated commute; always labelled "(est.)".
const SPEEDS = { walk: 5, cycle: 15, train: 25, bus: 25, 'light rail': 25, tram: 25, ferry: 25, drive: 20 };
const MODE_ALIASES = { walking: 'walk', foot: 'walk', bike: 'cycle', bicycle: 'cycle', cycling: 'cycle', car: 'drive',
  driving: 'drive', 'public transport': 'train', transit: 'train', rail: 'train', metro: 'train', lightrail: 'light rail' };

export function commuteMode(profile) {
  const p = profile || {};
  const raw = p.transportMode || p.commuteMode || (Array.isArray(p.commute_modes) ? p.commute_modes[0] : null) ||
    (p.hasCar ? 'drive' : 'train');
  const mode = String(raw).trim().toLowerCase();
  const known = MODE_ALIASES[mode] || mode;
  return SPEEDS[known] ? known : 'train';
}

export function commuteMinutes(km, mode) {
  const speed = SPEEDS[mode];
  return Number.isFinite(km) && km >= 0 && speed ? Math.round(km / speed * 60) : null;
}

export function shortSource(source) {
  if (typeof source !== 'string' || !source.trim()) return '';
  return source.trim().replace(/^[a-z]+:\/\/[^/]+/i, '').replace(/[?#].*$/, '').replace(/^\/v\d+(?=\/)/, '')
    .replace(/^\/(properties|suburbs)\/[^/]+(?=\/)/, '') || source.trim();
}

const RENT_SOURCES = [
  [/rent-history-latest/, 'latest advertised rent'],
  [/rent-map/, 'mesh-block median rent'],
  [/median-rent/, 'suburb median rent'],
];

function transitMode(label) {
  const text = String(label || '').toLowerCase();
  if (/light rail|tram/.test(text)) return 'Light rail';
  if (/ferry|wharf/.test(text)) return 'Ferry';
  if (/train|station|metro/.test(text)) return 'Train';
  if (/bus/.test(text)) return 'Bus';
  return 'Transport';
}

function signalKm(signal) {
  const n = signal?.value;
  if (!Number.isFinite(n)) return null;
  return signal.unit === 'm' ? n / 1000 : n;
}

function shortLabel(label) {
  return String(label || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
}

// One human line plus one grey source line for a scored signal. Only values the data carries are shown.
export function factLine(signal, profile) {
  const s = signal || {};
  const display = typeof s.display === 'string' ? s.display : '';
  const join = parts => parts.filter(part => part !== null && part !== undefined && part !== '').join(' · ');
  let main;
  let sourceNote = '';
  switch (s.key) {
    case 'transit_walk':
      main = join([transitMode(s.label), s.stopName || s.stop_name || s.name, display]);
      break;
    case 'work_distance': {
      const p = profile || {};
      const mode = commuteMode(p);
      const minutes = commuteMinutes(signalKm(s), mode);
      const work = typeof p.workAddress === 'string' && p.workAddress.trim() ? p.workAddress.trim() : '';
      main = join(['Your destination', work ? `${display} to ${work}` : display,
        minutes === null ? '' : `~${minutes} min by ${mode} (est.)`]);
      break;
    }
    case 'cbd_distance': main = join(['Town Hall', display]); break;
    case 'parking': main = join(['Parking', s.value === 0 ? 'none' : display]); break;
    case 'road_noise': main = join(['Busy road', ['none', 'nearby', 'fronting'][s.value] || display]); break;
    case 'crime_vs_benchmark': main = join(['Block crime', display]); break;
    case 'livability_vs_benchmark': main = join(['Livability', display]); break;
    case 'daily_needs': main = join(['Supermarket, gym, café', display]); break;
    case 'nightlife': {
      const within = /within .+$/i.exec(String(s.label || ''));
      main = join(['Nightlife', within ? `${display} ${shortLabel(within[0])}` : display]);
      break;
    }
    case 'green_space': main = join(['Green space', display]); break;
    case 'rent_affordability': {
      const rent = s.inputs?.rentWeekly > 0 ? `$${s.inputs.rentWeekly.toLocaleString('en-AU')}/wk` : '';
      main = join(['Rent', rent, display === rent ? '' : display]);
      const hit = RENT_SOURCES.find(([pattern]) => pattern.test(String(s.source || '')));
      sourceNote = hit ? hit[1] : '';
      break;
    }
    default: {
      const label = /vacancy/i.test(s.label || '') ? 'Vacancy' : /rates/i.test(s.label || '') ? 'Council rates' : shortLabel(s.label);
      main = join([label, display]);
    }
  }
  return { main, src: join([sourceNote, shortSource(s.source), s.asOf]) };
}

// Only reported evidence is shown; unavailable signals do not become placeholder numbers.
export function summarizeFit(result, trusted = true, profile = null) {
  if (!trusted) return { total: null, coverage: { scored: 0, of: 4 }, pillars: [], pros: [], cons: [] };
  const who = profile || result?.profile || cachedProfile || null;
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
        ...factLine(signal, who),
      })),
  }));
  const signals = dimensions.flatMap(dimension => dimension.signals || []);
  const full = item => signals.find(signal => signal.key === item.key && signal.dimension === item.dimension) || item;
  const line = item => { const fact = factLine(full(item), who); return { ...fact, text: fact.main }; };
  const cons = (result?.failos || []).slice(0, 2);
  // A rent failo (over 40% of income) is always pinned into Cons, even if the ranking drops it.
  const rentCon = signals.find(signal => signal.key === 'rent_affordability' && signal.available === true &&
    (Number.isFinite(signal.score) && signal.score <= 30 || Number.isFinite(signal.value) && signal.value > 40));
  if (rentCon && !cons.some(item => item.key === 'rent_affordability')) cons.push(rentCon);
  return {
    total: Number.isFinite(result?.fit) ? result.fit : null,
    coverage: { scored: pillars.filter(pillar => pillar.score !== null).length, of: pillars.length },
    pillars,
    pros: (result?.halos || []).slice(0, 2).map(line),
    cons: cons.map(line),
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
    const summary = summarizeFit(next, trusted, opts.profile || null);
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
