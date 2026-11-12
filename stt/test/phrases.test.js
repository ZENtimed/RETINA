const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestChips } = require('../client/phrases');

const chips = t => suggestChips(t).map(c => c.chip);

test('english EM-104 lines', () => {
  assert.deepEqual(chips('Motorcycle hit a pole.'), ['Motorcycle vs pole']);
  assert.deepEqual(chips('The victim is unconscious and not breathing.'), ['Unconscious', 'Not breathing']);
  assert.deepEqual(chips('He is about thirty. No helmet.'), ['No helmet']);
  assert.deepEqual(chips('There is a lot of bleeding from his head.'), ['Head bleeding']);
});

test('thai maps to the same english chips', () => {
  assert.deepEqual(chips('มอเตอร์ไซค์ชนเสาค่ะ'), ['Motorcycle vs pole']);
  assert.deepEqual(chips('คนเจ็บหมดสติ ไม่หายใจ'), ['Unconscious', 'Not breathing']);
});

test('thai with spaces inserted by STT still matches', () => {
  assert.deepEqual(chips('มอเตอร์ไซค์ ชน เสา'), ['Motorcycle vs pole']);
});

test('negated phrases are not suggested', () => {
  assert.deepEqual(chips('ไม่หมดสติครับ'), []);
  assert.deepEqual(chips('He is not unconscious'), []);
});

test('case-insensitive, deduped, typed', () => {
  assert.deepEqual(suggestChips('NO HELMET, no helmet'), [{ chip: 'No helmet', type: 'moi' }]);
});

test('unknown wording gives nothing', () => {
  assert.deepEqual(chips('He fell down the stairs'), []);
});
