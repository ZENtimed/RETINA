/* RETINA STT: convert Web Audio Float32 samples to 16 kHz mono LINEAR16 for Google Chirp 3. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EMS = root.EMS || {}; Object.assign(root.EMS, api); }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var OUT_RATE = 16000;

  function toInt16(x) {
    x = Math.max(-1, Math.min(1, x));
    return x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
  }

  /* Stateful 16 kHz resampler for a stream of blocks (the worklet delivers 128 samples at a time).
     Output sample k is the average of input samples [floor(k*in/16000), floor((k+1)*in/16000)), counted
     across the whole stream, so block edges never drop or duplicate samples. */
  function createResampler(inRate) {
    var pending = [], base = 0, total = 0, k = 0;
    return {
      push: function (input) {
        for (var i = 0; i < input.length; i++) pending.push(input[i]);
        total += input.length;
        var out = [];
        while ((k + 1) * inRate <= total * OUT_RATE) {
          var start = Math.floor(k * inRate / OUT_RATE), end = Math.max(start + 1, Math.floor((k + 1) * inRate / OUT_RATE));
          var sum = 0;
          for (var j = start; j < end; j++) sum += pending[j - base];
          out.push(toInt16(sum / (end - start)));
          k++;
        }
        var keepFrom = Math.floor(k * inRate / OUT_RATE);
        pending = pending.slice(keepFrom - base);
        base = keepFrom;
        return Int16Array.from(out);
      }
    };
  }

  /* One whole buffer at once. */
  function toPcm16k(input, inRate) { return createResampler(inRate).push(input); }

  return { toPcm16k: toPcm16k, createResampler: createResampler };
});
