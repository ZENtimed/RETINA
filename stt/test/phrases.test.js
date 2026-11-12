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

test('common English negations are not suggested', () => {
  assert.deepEqual(chips('no chest pain'), []);
  assert.deepEqual(chips("he wasn't unconscious"), []);
  assert.deepEqual(chips('he wasn’t unconscious'), []);
  assert.deepEqual(chips("she isn't bleeding from her head"), []);
  assert.deepEqual(chips('never unconscious'), []);
  assert.deepEqual(chips('denies chest pain'), []);
});

test('common Thai negations are not suggested', () => {
  assert.deepEqual(chips('ไม่ได้หมดสติ'), []);
  assert.deepEqual(chips('ไม่ได้หยุดหายใจ'), []);
  assert.deepEqual(chips('ไม่มีเลือดออกที่หัว'), []);
  assert.deepEqual(chips('ยังไม่หมดสติ'), []);
  assert.deepEqual(chips('ไม่ได้มีเจ็บหน้าอก'), []);
});

test('negation of one phrase does not hide a later positive one', () => {
  assert.deepEqual(chips('No chest pain, but he is unconscious'), ['Unconscious']);
});

test('over-broad phrases are gone', () => {
  assert.deepEqual(chips('He is allergic to penicillin'), []);
  assert.deepEqual(chips('Please come very fast'), []);
  assert.deepEqual(chips('She is allergic to seafood'), ['Food allergy']);
  assert.deepEqual(chips('แพ้อาหารทะเล'), ['Food allergy']);
});

test('case-insensitive, deduped, typed', () => {
  assert.deepEqual(suggestChips('NO HELMET, no helmet'), [{ chip: 'No helmet', type: 'moi' }]);
});

test('unknown wording gives nothing', () => {
  assert.deepEqual(chips('He fell down the stairs'), []);
});
