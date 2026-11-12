// Start the RETINA STT relay on 127.0.0.1. The Google credentials stay here (Application Default Credentials).
const path = require('node:path');
const { loadEnvFiles } = require('./config');
const envFiles = loadEnvFiles([path.join(__dirname, '../.env'), path.join(__dirname, '../../.env')]);
const { createServer } = require('./server');
const { parseLanguages, buildStreamingRequest, createGoogleStream, createRotatingStream, makeClient } = require('./google');

const problem = require('./config').credentialProblem();
if (problem) { console.error(problem); process.exit(1); }
const project = require('./config').projectId();
if (!project) { console.error('Set GOOGLE_CLOUD_PROJECT (in stt/.env or this window)'); process.exit(1); }
const location = process.env.STT_LOCATION || 'us';
const languages = parseLanguages(process.env.STT_LANGUAGES);
const port = Number(process.env.STT_PORT || 8787);

const client = makeClient(location);
const request = buildStreamingRequest({ project, location, languages });

const server = createServer({
  harnessPath: path.join(__dirname, '../../preview-harness.html'),
  openStream: ({ speaker, onPartial, onFinal, onError }) => {
    return createRotatingStream({
      open: () => {
        console.log(`${speaker}: Google stream open`);
        return createGoogleStream({
          client, request, onPartial, onFinal,
          onError: err => { console.error(`${speaker}: ${err.message}`); onError(err); }
        });
      }
    });
  }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${port} is already in use: another relay is probably still running. Close that window (or press Ctrl+C in it), or set STT_PORT to another port.`);
  else console.error(err.message);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  const auth = process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'key file' : 'gcloud login';
  console.log(`env files: ${envFiles.length ? envFiles.map(f => path.relative(process.cwd(), f) || f).join(', ') : 'none'} · auth: ${auth}`);
  console.log(`languages=${JSON.stringify(languages)} location=${location}`);
  console.log(`RETINA STT relay on http://localhost:${port}/#Intake`);
});
