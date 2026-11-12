// Relay configuration: .env files, Google client options and a start-up credentials check.
// Secrets stay on this machine and are never logged.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseEnv } = require('node:util');

/* Read each existing file in order. A value already set (shell, or an earlier file) is never overridden. */
function loadEnvFiles(files, env = process.env) {
  const loaded = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const values = parseEnv(fs.readFileSync(file, 'utf8'));
    for (const [k, v] of Object.entries(values)) if (env[k] === undefined) env[k] = v;
    loaded.push(file);
  }
  return loaded;
}

/* Credentials are found by Google's library itself: a key file (GOOGLE_APPLICATION_CREDENTIALS) or a gcloud login. */
function clientOptions(location) {
  return { apiEndpoint: `${location}-speech.googleapis.com` };
}

/* Where `gcloud auth application-default login` stores its credentials. */
function gcloudLoginExists() {
  const dir = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'gcloud')
    : path.join(os.homedir(), '.config', 'gcloud');
  return fs.existsSync(path.join(dir, 'application_default_credentials.json'));
}

/* A plain-English reason the relay cannot sign in to Google, or null when it can. */
function credentialProblem(env = process.env, hasGcloudLogin = gcloudLoginExists) {
  const file = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (file) return fs.existsSync(file) ? null : `Key file not found: ${file}. Check GOOGLE_APPLICATION_CREDENTIALS.`;
  if (hasGcloudLogin()) return null;
  if (env.GOOGLE_API_KEY) {
    return 'Google Speech-to-Text V2 does not accept API keys. Use a service-account key file ' +
      '(GOOGLE_APPLICATION_CREDENTIALS=C:\\keys\\retina-stt.json in stt/.env) or run ' +
      '"gcloud auth application-default login". See docs/stt-google-setup.md, Step 3.';
  }
  return 'No Google credentials. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file in stt/.env, ' +
    'or run "gcloud auth application-default login". See docs/stt-google-setup.md, Step 3.';
}

/* The Google Cloud project: GOOGLE_CLOUD_PROJECT, or else the project_id inside the service-account key file. */
function projectId(env = process.env) {
  if (env.GOOGLE_CLOUD_PROJECT) return env.GOOGLE_CLOUD_PROJECT.trim();
  const file = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!file || !fs.existsSync(file)) return '';
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).project_id || ''; } catch (err) { return ''; }
}

module.exports = { loadEnvFiles, clientOptions, credentialProblem, projectId };
