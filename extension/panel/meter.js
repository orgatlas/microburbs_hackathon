globalThis.MBX = globalThis.MBX || {};

(function (MBX) {
  'use strict';

  var nextId = 0;
  var spectrum = [
    ['0%', 'var(--mbx-spectrum-low, #e27470)'],
    ['48%', 'var(--mbx-spectrum-mid, #edbd64)'],
    ['100%', 'var(--mbx-spectrum-high, #44ae91)']
  ];

  function render(container, props) {
    var doc = container.ownerDocument;
    var root = doc.createElement('div');
    root.className = 'mbx-meter';
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

  MBX.meter = { render: render };
})(globalThis.MBX);
