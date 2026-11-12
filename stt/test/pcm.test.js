const test = require('node:test');
const assert = require('node:assert/strict');
const { toPcm16k } = require('../client/pcm');

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
