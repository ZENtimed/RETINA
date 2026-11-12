const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { parseLanguages, buildStreamingRequest, mapResponse, createGoogleStream } = require('../src/google');

test('parseLanguages defaults to auto and splits a list', () => {
  assert.deepEqual(parseLanguages(undefined), ['auto']);
  assert.deepEqual(parseLanguages(''), ['auto']);
  assert.deepEqual(parseLanguages(' th-TH, en-US '), ['th-TH', 'en-US']);
});

test('buildStreamingRequest matches the Chirp 3 V2 streaming shape', () => {
  assert.deepEqual(buildStreamingRequest({ project: 'p', location: 'us', languages: ['auto'] }), {
    recognizer: 'projects/p/locations/us/recognizers/_',
    streamingConfig: {
      config: {
        explicitDecodingConfig: { encoding: 'LINEAR16', sampleRateHertz: 16000, audioChannelCount: 1 },
        languageCodes: ['auto'],
        model: 'chirp_3'
      },
      streamingFeatures: { interimResults: true }
    }
  });
});

const r = (transcript, extra) => Object.assign({ alternatives: [{ transcript }] }, extra);

test('mapResponse: nothing in, nothing out', () => {
  assert.deepEqual(mapResponse({}), []);
  assert.deepEqual(mapResponse({ results: [r('')] }), []);
});

test('mapResponse joins non-final results into one partial', () => {
  assert.deepEqual(mapResponse({ results: [r('Motorcycle'), r(' hit a')] }), [{ kind: 'partial', text: 'Motorcycle hit a' }]);
});

test('mapResponse maps a final with its language', () => {
  assert.deepEqual(mapResponse({ results: [r('มอเตอร์ไซค์ชนเสา', { isFinal: true, languageCode: 'th-th' })] }),
    [{ kind: 'final', text: 'มอเตอร์ไซค์ชนเสา', lang: 'th-th' }]);
});

test('mapResponse puts finals before the partial and trims', () => {
  assert.deepEqual(mapResponse({ results: [r(' Done. ', { isFinal: true, languageCode: 'en-us' }), r(' next ')] }),
    [{ kind: 'final', text: 'Done.', lang: 'en-us' }, { kind: 'partial', text: 'next' }]);
});

function fakeClient() {
  const stream = new PassThrough({ objectMode: true });
  const written = [];
  const origWrite = stream.write.bind(stream);
  stream.write = (obj) => { written.push(obj); return true; };
  stream.origWrite = origWrite;
  return { client: { _streamingRecognize: () => stream }, stream, written };
}

test('createGoogleStream writes the request first, then audio', () => {
  const { client, written } = fakeClient();
  const request = buildStreamingRequest({ project: 'p', location: 'us', languages: ['auto'] });
  const s = createGoogleStream({ client, request, onPartial() {}, onFinal() {}, onError() {} });
  const buf = Buffer.from([1, 2]);
  s.write(buf);
  assert.equal(written[0], request);
  assert.deepEqual(written[1], { audio: buf });
});

test('createGoogleStream routes data and errors, and end() ends the stream', async () => {
  const { client, stream } = fakeClient();
  const finals = [], partials = [], errors = [];
  const s = createGoogleStream({ client, request: {}, onPartial: t => partials.push(t), onFinal: (t, l) => finals.push([t, l]), onError: e => errors.push(e) });
  stream.emit('data', { results: [r('Motorcycle hit a pole.', { isFinal: true, languageCode: 'en-us' }), r('No')] });
  assert.deepEqual(finals, [['Motorcycle hit a pole.', 'en-us']]);
  assert.deepEqual(partials, ['No']);
  const err = new Error('quota');
  stream.emit('error', err);
  assert.deepEqual(errors, [err]);
  let ended = false;
  stream.end = () => { ended = true; };
  s.end();
  assert.equal(ended, true);
});
