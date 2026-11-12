const test = require('node:test');
const assert = require('node:assert/strict');
const { toPcm16k, createResampler } = require('../client/pcm');

test('resampler: 375 worklet blocks of 128 at 48 kHz give exactly 16000 samples', () => {
  const r = createResampler(48000);
  let n = 0;
  for (let i = 0; i < 375; i++) n += r.push(new Float32Array(128)).length;
  assert.equal(n, 16000);
});

test('resampler: one second at 44.1 kHz in 128-sample blocks gives exactly 16000 samples', () => {
  const r = createResampler(44100);
  let n = 0;
  for (let off = 0; off < 44100; off += 128) n += r.push(new Float32Array(Math.min(128, 44100 - off))).length;
  assert.equal(n, 16000);
});

test('resampler: block-by-block output equals converting the whole buffer at once', () => {
  const input = Float32Array.from({ length: 128 * 30 }, (_, i) => Math.sin(i / 7) * 0.8);
  const r = createResampler(44100);
  const parts = [];
  for (let off = 0; off < input.length; off += 128) parts.push(...r.push(input.subarray(off, off + 128)));
  assert.deepEqual(parts, Array.from(toPcm16k(input, 44100)));
});

test('48 kHz downsamples to a third of the length', () => {
  assert.equal(toPcm16k(new Float32Array(480), 48000).length, 160);
});

test('44.1 kHz downsamples to floor(n * 16000 / 44100)', () => {
  assert.equal(toPcm16k(new Float32Array(441), 44100).length, 160);
});

test('16 kHz is identity with asymmetric int16 scaling', () => {
  assert.deepEqual(Array.from(toPcm16k(new Float32Array([0, 0.5, -0.5]), 16000)), [0, 16384, -16384]);
});

test('out-of-range samples clamp', () => {
  assert.deepEqual(Array.from(toPcm16k(new Float32Array([2, -2]), 16000)), [32767, -32768]);
});

test('48 kHz averages each group of three', () => {
  assert.deepEqual(Array.from(toPcm16k(new Float32Array([0.3, 0.3, 0.3]), 48000)), [Math.round(0.3 * 32767)]);
});
