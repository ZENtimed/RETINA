// Intake form suggestions: ask Claude for six fields from the transcript, keep only values backed by words said on the call.
// The transcript is never logged. Spec: docs/superpowers/specs/2026-11-13-intake-form-suggestions-design.md
const Anthropic = require('@anthropic-ai/sdk');

const FIELDS = ['callerName', 'contactNumber', 'patient', 'underlyingDisease', 'symptoms', 'address'];

const DESCRIPTIONS = {
  callerName: "The caller's own name, as they said it.",
  contactNumber: 'A phone number to call the caller back on, written as digits with dashes (for example 081-234-5678).',
  patient: 'Sex and age of the patient, for example "Male, about 30". A pronoun (he, she) counts as the sex. Leave out what was not said.',
  underlyingDisease: 'A medical condition the patient has, as named on the call, or "Unknown" when the caller says they do not know.',
  symptoms: 'One or two short factual sentences on what happened and what the patient shows. No diagnosis and no triage words.',
  address: 'Where the patient is, as said on the call (street, soi, building, landmark).'
};

const SYSTEM = [
  'You help an emergency call taker fill an intake form while the call is still going.',
  'Read the call transcript and fill each field only with facts the caller or the operator actually said.',
  'Write in English and keep every value short.',
  'For each value, set quote to words copied exactly from one transcript line, and lineId to the id shown at the start of that line, without the brackets.',
  'The quote must contain the fact the value states. For a phone number, the quote must contain every digit of it.',
  'Symptoms is a factual summary: no diagnosis, and no triage words such as critical, urgent or Code Red, because Dispatch sets triage.',
  'If the call has not covered a field yet, set it to null. Never guess.'
].join('\n');

function fieldSchema(key) {
  return {
    description: DESCRIPTIONS[key],
    anyOf: [
      {
        type: 'object',
        properties: { value: { type: 'string' }, quote: { type: 'string' }, lineId: { type: 'string' } },
        required: ['value', 'quote', 'lineId'],
        additionalProperties: false
      },
      { type: 'null' }
    ]
  };
}

const SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(FIELDS.map(k => [k, fieldSchema(k)])),
  required: FIELDS.slice(),
  additionalProperties: false
};

function buildSuggestRequest({ model, lines }) {
  const transcript = lines.map(l => `[${l.id}] ${l.time} ${l.speaker}: ${l.text}`).join('\n');
  return {
    model,
    max_tokens: 2048,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `Call transcript so far:\n${transcript}` }]
  };
}

/* Lower-case, drop sentence punctuation, collapse whitespace. */
function norm(s) { return String(s).toLowerCase().replace(/[.,!?;:'"]/g, '').replace(/\s+/g, ' ').trim(); }
const digits = s => String(s).replace(/\D/g, '');
/* A model may echo the id with its brackets: [replay-9] -> replay-9. */
const bareId = id => id.trim().replace(/^\[(.*)\]$/, '$1').trim();
/* A Thai phone number: 9 (landline) or 10 (mobile) digits, starting with 0. */
const THAI_PHONE = /^0\d{8,9}$/;
/* Each run of digits in a line, allowing spaces and dashes between groups ("081 234 5678"). */
const digitRuns = text => (String(text).match(/\d[\d\s-]*\d|\d/g) || []).map(digits);

/* Keep a field only when its quote (4+ characters) appears as whole words in the line it names.
   A phone number must also be a whole Thai number, spoken as one run of digits in that line. */
function checkFields(raw, lines) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const byId = new Map(lines.map(l => [l.id, l]));
  for (const key of FIELDS) {
    const f = raw[key];
    if (!f || typeof f !== 'object') continue;
    const { value, quote, lineId } = f;
    if (typeof value !== 'string' || typeof quote !== 'string' || typeof lineId !== 'string') continue;
    const q = norm(quote);
    if (!value.trim() || q.length < 4) continue;
    const id = bareId(lineId), line = byId.get(id);
    if (!line || !(' ' + norm(line.text) + ' ').includes(' ' + q + ' ')) continue;
    if (key === 'contactNumber') {
      const d = digits(value);
      if (!THAI_PHONE.test(d) || digits(quote) !== d || !digitRuns(line.text).includes(d)) continue;
    }
    out[key] = { value, quote, lineId: id };
  }
  return out;
}

function failureReason(err) {
  if (err instanceof Anthropic.APIError) return `${err.constructor.name}${err.status ? ' ' + err.status : ''}`;
  return err && err.name ? err.name : 'error';
}

function createSuggester({ client, model, log = () => {} }) {
  async function suggest(lines) {
    let res;
    try {
      res = await client.messages.create(buildSuggestRequest({ model, lines }));
    } catch (err) {
      const reason = failureReason(err);
      log(`suggest: Anthropic request failed (${reason})`);
      return { ok: false, reason };
    }
    if (res.stop_reason !== 'end_turn') {
      const reason = `stop_reason ${res.stop_reason}`;
      log(`suggest: ${reason}`);
      return { ok: false, reason };
    }
    const block = (res.content || []).find(b => b.type === 'text');
    let raw;
    try { raw = JSON.parse(block ? block.text : ''); } catch (err) {
      log('suggest: the answer was not JSON');
      return { ok: false, reason: 'bad answer' };
    }
    return { ok: true, fields: checkFields(raw, lines) };
  }
  return { suggest };
}

module.exports = { FIELDS, buildSuggestRequest, checkFields, createSuggester };
