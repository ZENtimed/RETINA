/* RETINA STT: convert Web Audio Float32 samples to 16 kHz mono LINEAR16 for Google Chirp 3. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EMS = root.EMS || {}; Object.assign(root.EMS, api); }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var OUT_RATE = 16000;

  /* Each output sample is the average of the input samples in its window. */
  function toPcm16k(input, inRate) {
    var n = input.length, outLen = Math.floor(n * OUT_RATE / inRate), out = new Int16Array(outLen);
    for (var i = 0; i < outLen; i++) {
      var start = Math.floor(i * inRate / OUT_RATE), end = Math.max(start + 1, Math.min(n, Math.floor((i + 1) * inRate / OUT_RATE)));
      var sum = 0;
      for (var j = start; j < end; j++) sum += input[j];
      var x = Math.max(-1, Math.min(1, sum / (end - start)));
      out[i] = x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
    }
    return out;
  }

  return { toPcm16k: toPcm16k };
});
