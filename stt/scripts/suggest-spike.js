// Send the EM-104 replay call to Claude once and print what the Intake form would be offered.
// Usage: node scripts/suggest-spike.js   (needs ANTHROPIC_API_KEY in stt/.env; optional SUGGEST_MODEL)
const path = require('node:path');
const config = require('../src/config');
config.loadEnvFiles([path.join(__dirname, '../.env'), path.join(__dirname, '../../.env')]);
const { FIELDS, createSuggester } = require('../src/suggest');

/* Own copy of the EM-104 replay: the 8 lines of REPLAY_LINES in the Design System bundle plus the 4 added for suggestions. */
const LINES = [
  ['14:19:51', 'Operator', '1669 emergency. What is your emergency?'],
  ['14:19:55', 'Caller', 'There is an accident in front of Building A, Soi Lat Phrao 1.'],
  ['14:20:02', 'Caller', 'Motorcycle hit a pole.'],
  ['14:20:06', 'Caller', 'The victim is unconscious and not breathing.'],
  ['14:20:11', 'Operator', 'Is anyone with you able to start CPR?'],
  ['14:20:15', 'Caller', 'A man is starting CPR now. There is a lot of bleeding from his head.'],
  ['14:20:21', 'Operator', 'Stay on the line. Help is being arranged.'],
  ['14:20:30', 'Caller', 'He is about thirty. No helmet.'],
  ['14:20:33', 'Operator', 'Can I have your name and a number to call you back?'],
  ['14:20:37', 'Caller', 'Somchai Jaidee. My number is 081 234 5678.'],
  ['14:20:42', 'Operator', 'Does he have any medical conditions you know of?'],
  ['14:20:45', 'Caller', "I don't know him, I have no idea."]
].map(([time, speaker, text], i) => ({ id: 'replay-' + i, time, speaker, text }));

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('No ANTHROPIC_API_KEY. Add it to stt/.env (see docs/claude-suggest-setup.md) and run this again.');
    process.exit(1);
  }
  const Anthropic = require('@anthropic-ai/sdk');
  const model = config.suggestModel();
  const { suggest } = createSuggester({ client: new Anthropic({ timeout: 10000, maxRetries: 0 }), model, log: msg => console.error(msg) });
  console.log(`model=${model} lines=${LINES.length}`);
  const started = Date.now();
  const r = await suggest(LINES);
  console.log(`took ${Date.now() - started} ms`);
  if (!r.ok) { console.error(`failed: ${r.reason}`); process.exit(1); }
  for (const key of FIELDS) {
    const f = r.fields[key];
    console.log(f ? `${key}: ${f.value}   [${f.lineId}: "${f.quote}"]` : `${key}: (none)`);
  }
  console.log(`kept ${Object.keys(r.fields).length} of ${FIELDS.length}`);
}

main();
