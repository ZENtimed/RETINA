// Start the RETINA STT relay on 127.0.0.1. The Google credentials stay here (Application Default Credentials).
const path = require('node:path');
const { createServer } = require('./server');
const { parseLanguages, buildStreamingRequest, createGoogleStream, createRotatingStream, makeClient } = require('./google');

const project = process.env.GOOGLE_CLOUD_PROJECT;
if (!project) { console.error('Set GOOGLE_CLOUD_PROJECT'); process.exit(1); }
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

server.listen(port, '127.0.0.1', () => {
  console.log(`languages=${JSON.stringify(languages)} location=${location}`);
  console.log(`RETINA STT relay on http://localhost:${port}/#Intake`);
});
