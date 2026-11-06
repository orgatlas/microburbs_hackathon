import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAddress, checkMatch, cleanQuery, streetKey, abbreviateStreetType } from '../src/address.js';

const pick = (p) => ({ unit: p.unit, number: p.number, street: p.street, suburb: p.suburb, state: p.state, postcode: p.postcode });

test('parseAddress handles the listing formats we see', () => {
  const cases = [
    ['5/12 Smith St, Surry Hills NSW 2010', { unit: '5', number: '12', street: 'Smith Street', suburb: 'Surry Hills', state: 'NSW', postcode: '2010' }],
    ['Unit 5, 12 Smith Street, Surry Hills, NSW 2010', { unit: '5', number: '12', street: 'Smith Street', suburb: 'Surry Hills', state: 'NSW', postcode: '2010' }],
    ['Apartment 5/12 Smith St, Surry Hills', { unit: '5', number: '12', street: 'Smith Street', suburb: 'Surry Hills', state: null, postcode: null }],
    ['Level 3, 5/12 Smith St, Surry Hills NSW 2010', { unit: '5', number: '12', street: 'Smith Street', suburb: 'Surry Hills', state: 'NSW', postcode: '2010' }],
    ['12-14 Smith St, Glebe NSW 2037', { unit: null, number: '12-14', street: 'Smith Street', suburb: 'Glebe', state: 'NSW', postcode: '2037' }],
    ['Shop 2, 12 Smith Rd, Ultimo', { unit: '2', number: '12', street: 'Smith Road', suburb: 'Ultimo', state: null, postcode: null }],
    ['Lot 3 Smith Ave, Zetland NSW 2017', { unit: null, number: null, street: 'Smith Avenue', suburb: 'Zetland', state: 'NSW', postcode: '2017' }],
    ['26 TUDOR STREET SURRY HILLS NSW 2010', { unit: null, number: '26', street: 'Tudor Street', suburb: 'Surry Hills', state: 'NSW', postcode: '2010' }],
    ['26 tudor st, surry hills, nsw 2010', { unit: null, number: '26', street: 'Tudor Street', suburb: 'Surry Hills', state: 'NSW', postcode: '2010' }],
    ['8 Bay Pde Waterloo NSW 2017', { unit: null, number: '8', street: 'Bay Parade', suburb: 'Waterloo', state: 'NSW', postcode: '2017' }],
  ];
  for (const [text, want] of cases) assert.deepEqual(pick(parseAddress(text)), want, text);
  assert.equal(parseAddress('Lot 3 Smith Ave, Zetland').lot, '3');
});

test('street types normalise both ways', () => {
  assert.equal(streetKey('Smith St'), streetKey('Smith Street'));
  assert.equal(streetKey('Foo Cres'), 'foo crescent');
  assert.equal(streetKey('Foo Bvd'), streetKey('Foo Boulevard'));
  assert.equal(streetKey('Foo Blvd'), streetKey('Foo Boulevard'));
  assert.equal(streetKey('St Johns Rd'), 'st johns road');
  assert.equal(abbreviateStreetType('Smith Street'), 'Smith St');
  assert.equal(abbreviateStreetType('Campbell Parade'), 'Campbell Pde');
});

test('cleanQuery drops unit words, state and postcode', () => {
  assert.equal(cleanQuery('Unit 5, 12 Smith St, Surry Hills NSW 2010'), '5/12 Smith Street, Surry Hills');
  assert.equal(cleanQuery('26 Tudor Street, Surry Hills NSW 2010'), '26 Tudor Street, Surry Hills');
  assert.equal(cleanQuery('zzzz'), 'zzzz');
});

test('checkMatch verdicts and notes', () => {
  const exact = checkMatch('26 Tudor St, Surry Hills NSW 2010', { display_name: '26 Tudor Street, Surry Hills' });
  assert.deepEqual(exact, { verdict: 'exact', number: true, street: true, suburb: true, notes: [] });

  const building = checkMatch('5/120 Crown Street, Surry Hills NSW 2010', { display_name: '120 Crown Street, Surry Hills' });
  assert.equal(building.verdict, 'partial');
  assert.equal(building.number, false);
  assert.ok(building.notes.includes('Unit 5 is not in the matched address'));

  const wrong = checkMatch('5/120 Crown Street, Surry Hills', { display_name: '26 Tudor Street, Surry Hills' });
  assert.equal(wrong.verdict, 'weak');
  assert.equal(wrong.street, false);

  const noNumber = checkMatch('Tudor Street, Surry Hills', { display_name: '26 Tudor Street, Surry Hills' });
  assert.equal(noNumber.number, null);
  assert.equal(noNumber.verdict, 'partial');
});
