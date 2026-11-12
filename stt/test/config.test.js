const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { clientOptions, loadEnvFiles } = require('../src/config');

test('clientOptions: regional endpoint, no key when none is set', () => {
  assert.deepEqual(clientOptions('us', {}), { apiEndpoint: 'us-speech.googleapis.com' });
});

test('clientOptions: GOOGLE_API_KEY is passed as apiKey', () => {
  assert.deepEqual(clientOptions('eu', { GOOGLE_API_KEY: ' k123 ' }), { apiEndpoint: 'eu-speech.googleapis.com', apiKey: 'k123' });
});

test('clientOptions: a key file wins over an API key (Google refuses both at once)', () => {
  assert.deepEqual(clientOptions('us', { GOOGLE_API_KEY: 'k', GOOGLE_APPLICATION_CREDENTIALS: 'C:\\keys\\a.json' }), { apiEndpoint: 'us-speech.googleapis.com' });
});

test('loadEnvFiles: reads existing files in order, skips missing ones, never overrides the shell', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retina-env-'));
  const a = path.join(dir, 'a.env'), b = path.join(dir, 'b.env');
  fs.writeFileSync(a, 'ONE=from-a\nTWO=from-a\n');
  fs.writeFileSync(b, 'TWO=from-b\nTHREE=from-b\n');
  const env = { ONE: 'from-shell' };
  const loaded = loadEnvFiles([path.join(dir, 'missing.env'), a, b], env);
  assert.deepEqual(loaded, [a, b]);
  assert.deepEqual(env, { ONE: 'from-shell', TWO: 'from-a', THREE: 'from-b' });
});
