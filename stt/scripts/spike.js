// Two-stream Chirp 3 spike (ADR 0002): stream two WAV files to Google at the same time, in real time.
// Usage: GOOGLE_CLOUD_PROJECT=<id> [STT_LANGUAGES=th-TH,en-US] [STT_LOCATION=us] node scripts/spike.js a.wav b.wav
const fs = require('node:fs');
const path = require('node:path');
require('../src/config').loadEnvFiles([path.join(__dirname, '../.env'), path.join(__dirname, '../../.env')]);
const { parseLanguages, buildStreamingRequest, createGoogleStream, makeClient } = require('../src/google');

function readPcm(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let fmt = null, data = null;
  for (let off = 12; off + 8 <= buf.length;) {
    const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') data = buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.channels !== 1 || fmt.rate !== 16000 || fmt.bits !== 16) return null;
  return data;
}

const files = process.argv.slice(2);
if (files.length !== 2) { console.error('usage: node scripts/spike.js a.wav b.wav'); process.exit(2); }
const project = process.env.GOOGLE_CLOUD_PROJECT;
if (!project) { console.error('Set GOOGLE_CLOUD_PROJECT'); process.exit(1); }
const pcms = files.map(readPcm);
if (pcms.some(p => !p)) { console.error('need 16 kHz mono 16-bit WAV'); process.exit(1); }

const location = process.env.STT_LOCATION || 'us';
const languages = parseLanguages(process.env.STT_LANGUAGES);
const client = makeClient(location);
const request = buildStreamingRequest({ project, location, languages });
console.log(`languages=${JSON.stringify(languages)} location=${location}`);

let pending = pcms.length;
pcms.forEach((pcm, i) => {
  const tag = i === 0 ? '[A]' : '[B]';
  const s = createGoogleStream({
    client, request,
    onPartial: t => console.log(`${tag} partial: ${t}`),
    onFinal: (t, lang) => console.log(`${tag} final (${lang}): ${t}`),
    onError: e => { console.error(`${tag} error: ${e.message}`); process.exitCode = 1; }
  });
  let off = 0;
  const timer = setInterval(() => {
    if (off >= pcm.length) {
      clearInterval(timer);
      setTimeout(() => { s.end(); if (--pending === 0) setTimeout(() => process.exit(), 2000); }, 3000);
      return;
    }
    s.write(pcm.subarray(off, off + 3200));
    off += 3200;
  }, 100);
});
