const test = require('node:test');
const assert = require('node:assert/strict');
const Anthropic = require('@anthropic-ai/sdk');
const { FIELDS, buildSuggestRequest, checkFields, createSuggester } = require('../src/suggest');

const LINES = [
  { id: 'replay-1', time: '14:19:55', speaker: 'Caller', text: 'There is an accident in front of Building A, Soi Lat Phrao 1.' },
  { id: 'replay-7', time: '14:20:30', speaker: 'Caller', text: 'He is about thirty. No helmet.' },
  { id: 'replay-9', time: '14:20:37', speaker: 'Caller', text: 'Somchai Jaidee. My number is 081 234 5678.' }
];
const ALL_NULL = Object.fromEntries(FIELDS.map(k => [k, null]));

function fakeClient(respond) {
  const calls = [];
  return { calls, messages: { create: async (params) => { calls.push(params); return respond(params); } } };
}
const textResponse = (obj, extra = {}) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }], ...extra });

test('FIELDS are the six Intake keys, in order', () => {
  assert.deepEqual(FIELDS, ['callerName', 'contactNumber', 'patient', 'underlyingDisease', 'symptoms', 'address']);
});

test('request: haiku, low effort, json_schema with all six keys required and nullable', () => {
  const p = buildSuggestRequest({ model: 'claude-haiku-5-5', lines: LINES });
  assert.equal(p.model, 'claude-haiku-5-5');
  assert.equal(p.max_tokens, 2048);
  assert.equal(p.output_config.effort, 'low');
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.deepEqual(p.output_config.format.schema.required, FIELDS);
  assert.equal(p.output_config.format.schema.additionalProperties, false);
  for (const k of FIELDS) {
    const alts = p.output_config.format.schema.properties[k].anyOf;
    assert.deepEqual(alts.map(a => a.type), ['object', 'null'], k);
    assert.deepEqual(alts[0].required, ['value', 'quote', 'lineId'], k);
    assert.equal(alts[0].additionalProperties, false, k);
  }
  for (const k of ['thinking', 'temperature', 'top_p', 'top_k']) assert.equal(k in p, false, k);
  assert.equal(typeof p.system, 'string');
  assert.equal(p.messages.at(-1).role, 'user');
  assert.match(p.messages[0].content, /\[replay-9\] 14:20:37 Caller: Somchai Jaidee\. My number is 081 234 5678\./);
});

test('checkFields keeps a value whose quote is in its line (case, spacing, punctuation ignored)', () => {
  const f = checkFields({ callerName: { value: 'Somchai Jaidee', quote: 'somchai  jaidee', lineId: 'replay-9' } }, LINES);
  assert.deepEqual(f.callerName, { value: 'Somchai Jaidee', quote: 'somchai  jaidee', lineId: 'replay-9' });
  const g = checkFields({ address: { value: 'Front of Building A, Soi Lat Phrao 1', quote: 'in front of Building A Soi Lat Phrao 1', lineId: 'replay-1' } }, LINES);
  assert.equal(g.address.value, 'Front of Building A, Soi Lat Phrao 1');
});

test('checkFields drops a made-up quote, an unknown lineId, a quote from another line, and nulls', () => {
  const f = checkFields({
    callerName: { value: 'Somchai', quote: 'my name is Somchai', lineId: 'replay-9' },
    address: { value: 'Soi Lat Phrao 1', quote: 'Soi Lat Phrao 1', lineId: 'replay-404' },
    patient: { value: 'Male, about 30', quote: 'He is about thirty', lineId: 'replay-1' },
    symptoms: null
  }, LINES);
  assert.deepEqual(f, {});
});

test('checkFields ignores unknown keys, empty values and a null or non-object answer', () => {
  assert.deepEqual(checkFields({ triage: { value: 'Red', quote: 'He is about thirty', lineId: 'replay-7' } }, LINES), {});
  assert.deepEqual(checkFields({ patient: { value: '  ', quote: 'He is about thirty', lineId: 'replay-7' } }, LINES), {});
  assert.deepEqual(checkFields(null, LINES), {});
  assert.deepEqual(checkFields('x', LINES), {});
});

test('contact number: digits in the value must equal the digits in the quote', () => {
  const ok = checkFields({ contactNumber: { value: '081-234-5678', quote: '081 234 5678', lineId: 'replay-9' } }, LINES);
  assert.equal(ok.contactNumber.value, '081-234-5678');
  const bad = checkFields({ contactNumber: { value: '081-234-5679', quote: '081 234 5678', lineId: 'replay-9' } }, LINES);
  assert.deepEqual(bad, {});
});

test('contact number spoken as words is dropped, never guessed (Review Focus 1)', () => {
  const lines = [{ id: 'L1', time: '14:20:37', speaker: 'Caller', text: 'It is oh eight one two three four five six seven eight.' }];
  assert.deepEqual(checkFields({ contactNumber: { value: '081-234-5678', quote: 'oh eight one two three four five six seven eight', lineId: 'L1' } }, lines), {});
});

test('suggest: parses the text block (after any thinking block) and checks it', async () => {
  const answer = { ...ALL_NULL, address: { value: 'Front of Building A, Soi Lat Phrao 1', quote: 'in front of Building A, Soi Lat Phrao 1', lineId: 'replay-1' },
    callerName: { value: 'Made Up', quote: 'my name is Made Up', lineId: 'replay-9' } };
  const client = fakeClient(() => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(answer) }] }));
  const s = createSuggester({ client, model: 'claude-haiku-5-5', log: () => {} });
  const r = await s.suggest(LINES);
  assert.deepEqual(r, { ok: true, fields: { address: answer.address } });
  assert.equal(client.calls[0].model, 'claude-haiku-5-5');
});

test('suggest: refusal, max_tokens, bad JSON and a thrown Anthropic.APIError become { ok: false } with a short reason', async () => {
  const apiError = Object.assign(Object.create(Anthropic.RateLimitError.prototype), { status: 429, message: 'rate limited' });
  const cases = [
    () => textResponse(ALL_NULL, { stop_reason: 'refusal' }),
    () => textResponse(ALL_NULL, { stop_reason: 'max_tokens' }),
    () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{not json' }] }),
    () => { throw apiError; },
    () => { throw new Error('socket hang up'); }
  ];
  for (const respond of cases) {
    const logged = [];
    const s = createSuggester({ client: fakeClient(respond), model: 'm', log: (...a) => logged.push(a.join(' ')) });
    const r = await s.suggest(LINES);
    assert.equal(r.ok, false);
    assert.equal(typeof r.reason, 'string');
    assert.ok(r.reason.length > 0 && r.reason.length <= 80, r.reason);
    assert.equal(logged.length, 1);
    assert.doesNotMatch(logged.join('\n'), /Somchai|Lat Phrao/, 'the transcript never reaches the log');
  }
});
