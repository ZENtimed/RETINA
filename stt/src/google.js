// Google Cloud Speech-to-Text V2 (Chirp 3) streaming adapter. One stream per microphone.
const { v2 } = require('@google-cloud/speech');

function parseLanguages(value) {
  const list = String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : ['auto'];
}

function buildStreamingRequest({ project, location, languages }) {
  return {
    recognizer: `projects/${project}/locations/${location}/recognizers/_`,
    streamingConfig: {
      config: {
        explicitDecodingConfig: { encoding: 'LINEAR16', sampleRateHertz: 16000, audioChannelCount: 1 },
        languageCodes: languages,
        model: 'chirp_3'
      },
      streamingFeatures: { interimResults: true }
    }
  };
}

const textOf = result => ((result.alternatives && result.alternatives[0] && result.alternatives[0].transcript) || '');

/* Finals first, one per final result; then every non-final result joined into one partial. */
function mapResponse(resp) {
  const results = (resp && resp.results) || [];
  const out = [];
  let partial = '';
  for (const result of results) {
    if (result.isFinal) {
      const text = textOf(result).trim();
      if (text) out.push({ kind: 'final', text, lang: result.languageCode });
    } else {
      partial += textOf(result);
    }
  }
  partial = partial.trim();
  if (partial) out.push({ kind: 'partial', text: partial });
  return out;
}

function createGoogleStream({ client, request, onPartial, onFinal, onError }) {
  const stream = client._streamingRecognize();
  let ended = false;
  stream.on('data', resp => {
    for (const ev of mapResponse(resp)) {
      if (ev.kind === 'final') onFinal(ev.text, ev.lang);
      else onPartial(ev.text);
    }
  });
  // Errors after end() are the cancel of a stream we closed ourselves.
  stream.on('error', err => { if (!ended) onError(err); });
  // Google closing the stream on its own leaves nothing to transcribe with: treat it as an error.
  stream.on('end', () => { if (!ended) { ended = true; onError(new Error('Google stream ended')); } });
  stream.write(request);
  return {
    write(buf) { if (!ended) stream.write({ audio: buf }); },
    end() { if (!ended) { ended = true; stream.end(); } }
  };
}

/* A Speech V2 stream takes about 5 minutes of audio at most. Before that, open a fresh stream, switch
   writes to it, and half-close the old one so Google still sends the finals for audio it already has. */
function createRotatingStream({ open, maxMs = 270000, setTimeout: set = setTimeout, clearTimeout: clear = clearTimeout }) {
  let current = open(), timer = null, ended = false;
  const schedule = () => { timer = set(rotate, maxMs); };
  function rotate() {
    const old = current;
    current = open();
    old.end();
    schedule();
  }
  schedule();
  return {
    write(buf) { if (!ended) current.write(buf); },
    end() { if (ended) return; ended = true; clear(timer); timer = null; current.end(); }
  };
}

function makeClient(location, env = process.env) {
  return new v2.SpeechClient(require('./config').clientOptions(location, env));
}

module.exports = { parseLanguages, buildStreamingRequest, mapResponse, createGoogleStream, createRotatingStream, makeClient };
