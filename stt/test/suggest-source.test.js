const test = require('node:test');
const assert = require('node:assert/strict');
const { createSuggestSource, suggestionStep } = require('../client/suggest-source');

const URL = 'http://localhost:8787/suggest';
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
const line = (i, extra = {}) => ({ id: 'L' + i, time: '14:20:' + String(i % 60).padStart(2, '0'), speaker: 'Caller', text: 'line ' + i, partial: false, chips: [], ...extra });
const lines = n => Array.from({ length: n }, (_, i) => line(i));

/* Hand-driven clock and a fetch whose answers the test releases one by one. */
function makeEnv() {
  let now = 0, seq = 0;
  const timers = new Map(), requests = [];
  const env = {
    fetch: (url, init) => new Promise((resolve, reject) => {
      requests.push({ url, init, body: JSON.parse(init.body), answer(status, obj) { resolve({ status, json: async () => obj }); }, fail(err) { reject(err || new TypeError('network')); } });
    }),
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: id => { timers.delete(id); }
  };
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].at; due[1].fn();
    }
    now = end;
  }
  return { env, advance, requests, timers };
}
function start() {
  const h = makeEnv();
  const src = createSuggestSource({ url: URL, env: h.env });
  const fields = [], status = [];
  src.on('fields', f => fields.push(f));
  src.on('status', s => status.push(s));
  return Object.assign(h, { src, fields, status });
}
const FIELDS = { address: { value: 'Soi Lat Phrao 1', quote: 'Soi Lat Phrao 1', lineId: 'L1' } };

test('waits 800 ms after the last finished line, then posts all finished lines', async () => {
  const h = start();
  h.src.update([line(0), line(1, { partial: true })]);
  h.advance(500);
  h.src.update([line(0), line(1)]);
  h.advance(799); assert.equal(h.requests.length, 0);
  h.advance(1); assert.equal(h.requests.length, 1);
  const r = h.requests[0];
  assert.equal(r.url, URL);
  assert.equal(r.init.method, 'POST');
  assert.match(r.init.headers['content-type'], /application\/json/);
  assert.deepEqual(r.body, { lines: [0, 1].map(i => ({ id: 'L' + i, time: line(i).time, speaker: 'Caller', text: 'line ' + i })) });
  r.answer(200, { fields: FIELDS }); await flush();
  assert.deepEqual(h.fields, [FIELDS]);
});

test('a partial-only change sends nothing', () => {
  const h = start();
  h.src.update([line(0, { partial: true })]);
  h.advance(5000);
  assert.equal(h.requests.length, 0);
});

test('one request in flight; lines that arrive meanwhile give exactly one follow-up', async () => {
  const h = start();
  h.src.update(lines(1)); h.advance(800);
  h.src.update(lines(2)); h.advance(800);
  h.src.update(lines(3)); h.advance(800);
  assert.equal(h.requests.length, 1);
  h.requests[0].answer(200, { fields: {} }); await flush();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].body.lines.length, 3);
  h.requests[1].answer(200, { fields: FIELDS }); await flush();
  h.advance(5000);
  assert.equal(h.requests.length, 2);
});

test('sends at most the last 200 finished lines (Review Focus 2)', () => {
  const h = start();
  h.src.update(lines(450)); h.advance(800);
  const sent = h.requests[0].body.lines;
  assert.equal(sent.length, 200);
  assert.equal(sent[0].id, 'L250');
  assert.equal(sent.at(-1).id, 'L449');
});

test('a request that never answers is abandoned after 12 s, and the next one goes out (Review Focus 4)', async () => {
  const h = start();
  h.src.update(lines(1)); h.advance(800);
  h.src.update(lines(2)); h.advance(800);
  assert.equal(h.requests.length, 1);
  h.advance(12000); await flush();
  assert.equal(h.requests.length, 2, 'the follow-up goes out once the first is abandoned');
  assert.deepEqual(h.status, ['off']);
  h.requests[1].answer(200, { fields: FIELDS }); await flush();
  assert.deepEqual(h.status, ['off', 'on']);
});

test('newest wins: a late response to an older request is ignored', async () => {
  const h = start();
  h.src.update(lines(1)); h.advance(800);
  h.advance(12000); await flush();
  h.src.update(lines(2)); h.advance(800);
  h.requests[1].answer(200, { fields: FIELDS }); await flush();
  h.requests[0].answer(200, { fields: { callerName: { value: 'Old', quote: 'line 0', lineId: 'L0' } } }); await flush();
  assert.deepEqual(h.fields, [FIELDS]);
});

test('503 turns suggestions off for good: status off, no more requests', async () => {
  const h = start();
  h.src.update(lines(1)); h.advance(800);
  h.requests[0].answer(503, { off: true }); await flush();
  assert.deepEqual(h.status, ['off']);
  h.src.update(lines(5)); h.advance(5000);
  assert.equal(h.requests.length, 1);
});

test('502 or a network error: status off, the next update still tries; a 200 sets status on again', async () => {
  const h = start();
  h.src.update(lines(1)); h.advance(800);
  h.requests[0].answer(502, { error: 'timeout' }); await flush();
  assert.deepEqual(h.status, ['off']);
  h.src.update(lines(2)); h.advance(800);
  h.requests[1].fail(); await flush();
  assert.deepEqual(h.status, ['off'], 'off is reported once');
  h.src.update(lines(3)); h.advance(800);
  h.requests[2].answer(200, { fields: FIELDS }); await flush();
  assert.deepEqual(h.status, ['off', 'on']);
  assert.deepEqual(h.fields, [FIELDS]);
});

test('stop() clears timers and ignores later responses', async () => {
  const h = start();
  h.src.update(lines(1)); h.advance(800);
  h.src.update(lines(2));
  h.src.stop();
  assert.equal(h.timers.size, 0);
  h.requests[0].answer(200, { fields: FIELDS }); await flush();
  h.advance(5000);
  assert.deepEqual(h.fields, []);
  assert.equal(h.requests.length, 1);
});

const EMPTY = { shown: null, visible: false, updated: false, heardAt: '', lineId: null };
const incoming = (value, fieldValue = '', heardAt = '14:20:37', lineId = 'L9') => ({ type: 'incoming', value, heardAt, fieldValue, lineId });

test('suggestionStep: first suggestion on an empty field shows; the same value again changes nothing', () => {
  const a = suggestionStep(EMPTY, incoming('Somchai Jaidee'));
  assert.deepEqual(a, { shown: 'Somchai Jaidee', visible: true, updated: false, heardAt: '14:20:37', lineId: 'L9' });
  assert.equal(suggestionStep(a, incoming('Somchai Jaidee', '', '14:20:50')), a);
});

test('suggestionStep: Use or typing hides it; a different value later shows again as Updated', () => {
  const a = suggestionStep(EMPTY, incoming('081-234-5678'));
  const used = suggestionStep(a, { type: 'use' });
  assert.equal(used.visible, false);
  assert.equal(suggestionStep(a, { type: 'type' }).visible, false);
  assert.equal(suggestionStep(used, incoming('081-234-5678', '081-234-5678')).visible, false);
  const b = suggestionStep(used, incoming('081-234-9999', '081-234-5678', '14:20:44', 'L12'));
  assert.deepEqual(b, { shown: '081-234-9999', visible: true, updated: true, heardAt: '14:20:44', lineId: 'L12' });
});

test('suggestionStep: a dismissed value stays hidden; a different one shows again', () => {
  const d = suggestionStep(suggestionStep(EMPTY, incoming('Male, about 30')), { type: 'dismiss' });
  assert.equal(d.visible, false);
  assert.equal(suggestionStep(d, incoming('Male, about 30')).visible, false);
  assert.equal(suggestionStep(d, incoming('Male, about 35', '', '14:20:50', 'L11')).visible, true);
});

test('suggestionStep: a suggestion equal to what the field already holds stays hidden', () => {
  const a = suggestionStep(EMPTY, incoming('Unknown', 'Unknown'));
  assert.equal(a.visible, false);
  assert.equal(a.shown, 'Unknown');
});

test('suggestionStep: a reworded value from the same line stays hidden after Use, typing or dismiss (review I3)', () => {
  const a = suggestionStep(EMPTY, incoming('Motorcycle hit a pole. Unconscious.', '', '14:20:06', 'L3'));
  for (const ev of ['use', 'type', 'dismiss']) {
    const acted = suggestionStep(a, { type: ev });
    const reworded = suggestionStep(acted, incoming('A motorcycle hit a pole; the victim is unconscious.', 'typed by the call taker', '14:20:06', 'L3'));
    assert.equal(reworded.visible, false, ev);
  }
});

test('suggestionStep: while still shown, a reworded value replaces the text in place (not marked Updated)', () => {
  const a = suggestionStep(EMPTY, incoming('Motorcycle hit a pole.', '', '14:20:02', 'L2'));
  const b = suggestionStep(a, incoming('Motorcycle hit a pole; unconscious.', '', '14:20:06', 'L3'));
  assert.equal(b.visible, true);
  assert.equal(b.updated, false);
  assert.equal(b.shown, 'Motorcycle hit a pole; unconscious.');
});

test('suggestionStep: after Use, typing or dismiss, only a value cited from a LATER line comes back (live check)', () => {
  const at = (value, lineIndex, fieldValue = '') => ({ type: 'incoming', value, heardAt: 't', fieldValue, lineId: 'replay-' + lineIndex, lineIndex });
  const dismissed = suggestionStep(suggestionStep(EMPTY, at('Motorcycle hit a pole; unconscious.', 3)), { type: 'dismiss' });
  assert.equal(suggestionStep(dismissed, at('Motorcycle hit a pole. Victim unconscious.', 2)).visible, false, 'earlier line: same facts reworded');
  assert.equal(suggestionStep(dismissed, at('Motorcycle hit a pole, victim unconscious, not breathing.', 3)).visible, false, 'same line');
  const later = suggestionStep(dismissed, at('081-234-9999', 9, '081-234-5678'));
  assert.equal(later.visible, true, 'a later line brings new information');
  assert.equal(later.updated, true);
  assert.equal(later.lineIndex, 9);
});

test('suggestionStep: a summary field (summary: true) never comes back once acted on, even from a later line (live check)', () => {
  const at = (value, lineIndex, fieldValue = '') => ({ type: 'incoming', value, heardAt: 't', fieldValue, lineId: 'replay-' + lineIndex, lineIndex, summary: true });
  const first = suggestionStep(EMPTY, at('Motorcycle hit a pole in front of Building A.', 1));
  assert.equal(first.visible, true);
  assert.equal(suggestionStep(first, at('Motorcycle hit a pole; unconscious.', 3)).visible, true, 'still shown: replaced in place');
  for (const ev of ['use', 'type', 'dismiss']) {
    const acted = suggestionStep(first, { type: ev });
    assert.equal(suggestionStep(acted, at('Motorcycle hit a pole. Unconscious, not breathing, CPR started.', 11, ev === 'dismiss' ? '' : 'x')).visible, false, ev);
  }
});
