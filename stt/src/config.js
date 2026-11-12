// Relay configuration: .env files and Google client options. Secrets stay on this machine and are never logged.
const fs = require('node:fs');
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

/* Credentials, in Google's order: a key file (GOOGLE_APPLICATION_CREDENTIALS) or your gcloud login are used
   automatically; a plain API key (GOOGLE_API_KEY) is used only when no key file is set, because Google
   refuses an API key and a key file together. */
function clientOptions(location, env = process.env) {
  const opts = { apiEndpoint: `${location}-speech.googleapis.com` };
  const key = (env.GOOGLE_API_KEY || '').trim();
  if (key && !env.GOOGLE_APPLICATION_CREDENTIALS) opts.apiKey = key;
  return opts;
}

module.exports = { loadEnvFiles, clientOptions };
