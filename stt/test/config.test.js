const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { clientOptions, loadEnvFiles, credentialProblem } = require('../src/config');

test('clientOptions: regional endpoint only (API keys are not accepted by Speech V2)', () => {
  assert.deepEqual(clientOptions('us', {}), { apiEndpoint: 'us-speech.googleapis.com' });
  assert.deepEqual(clientOptions('eu', { GOOGLE_API_KEY: 'k' }), { apiEndpoint: 'eu-speech.googleapis.com' });
});

test('credentialProblem: an existing key file is fine', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retina-cred-'));
  const key = path.join(dir, 'k.json'); fs.writeFileSync(key, '{}');
  assert.equal(credentialProblem({ GOOGLE_APPLICATION_CREDENTIALS: key }, () => false), null);
});

test('credentialProblem: a key file path that does not exist is named', () => {
  assert.match(credentialProblem({ GOOGLE_APPLICATION_CREDENTIALS: 'C:\\nope\\k.json' }, () => false), /Key file not found: C:\\nope\\k\.json/);
});

test('credentialProblem: a gcloud login is fine', () => {
  assert.equal(credentialProblem({}, () => true), null);
});

test('credentialProblem: only an API key explains that API keys do not work', () => {
  assert.match(credentialProblem({ GOOGLE_API_KEY: 'AIza' }, () => false), /does not accept API keys/);
});

test('credentialProblem: nothing at all says how to sign in', () => {
  assert.match(credentialProblem({}, () => false), /No Google credentials/);
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
