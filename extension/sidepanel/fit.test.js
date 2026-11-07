import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFit } from './fit.js';

test('uncertain address matches expose neither ratings nor property evidence', () => {
  const hidden = summarizeFit({ fit: 100, dimensions: [{ key: 'safety', label: 'Safety', score: 100 }] }, false);
  assert.equal(hidden.total, null);
  assert.deepEqual(hidden.pillars, []);
});

test('absent evidence stays unrated and does not generate dropdown facts', () => {
  const result = summarizeFit({ fit: null, dimensions: [{ key: 'price', label: 'Price', score: null, signals: [
    { available: false, label: 'Rent', display: 'No data', value: null },
  ] }] });
  assert.equal(result.total, null);
  assert.equal(result.pillars[0].score, null);
  assert.deepEqual(result.pillars[0].rows, []);
});

test('dropdown evidence retains real zero values, sources, dates and the rent used by the scorer', () => {
  const result = summarizeFit({ fit: 50, dimensions: [
    { key: 'commute', label: 'Commute', score: 0, signals: [
      { available: true, label: 'Parking', display: 'No parking', value: 0, source: '/basics', asOf: '2026-11-07' },
    ] },
    { key: 'price', label: 'Price', score: 100, signals: [
      { available: true, label: 'Affordability', display: '25% of income', inputs: { rentWeekly: 420 }, source: '/rent' },
    ] },
  ] });
  assert.equal(result.pillars[0].score, 0);
  assert.equal(result.pillars[0].rows[0].value, 'No parking');
  assert.equal(result.pillars[0].rows[0].source, '/basics');
  assert.equal(result.pillars[0].rows[0].asOf, '2026-11-07');
  assert.match(result.pillars[1].rows[0].value, /\$420\/wk/);
});
