/* RETINA STT: browser microphone capture. One openMic() per speaker; chunks are 100 ms of 16 kHz PCM16. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EMS = root.EMS || {}; Object.assign(root.EMS, api); }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  var CHUNK = 1600; // 100 ms at 16 kHz

  function pcmLib() { return (typeof module === 'object' && module.exports) ? require('./pcm') : root.EMS; }

  /* Real audio inputs only: Chrome's 'default' and 'communications' entries alias a physical mic. */
  function listMics() {
    var md = root.navigator.mediaDevices;
    return md.getUserMedia({ audio: true }).then(function (s) {
      s.getTracks().forEach(function (t) { t.stop(); });
      return md.enumerateDevices();
    }).then(function (devs) {
      return devs.filter(function (d) { return d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'; })
        .map(function (d) { return { deviceId: d.deviceId, label: d.label }; });
    });
  }

  function openMic(deviceId, workletSrc) {
    var listeners = [], buf = new Int16Array(CHUNK), fill = 0, stream, ctx, url;
    return root.navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId }, channelCount: 1, echoCancellation: false, noiseSuppression: false } })
      .then(function (s) {
        stream = s;
        ctx = new root.AudioContext();
        url = root.URL.createObjectURL(new root.Blob([workletSrc], { type: 'text/javascript' }));
        return ctx.audioWorklet.addModule(url);
      })
      .then(function () {
        var node = new root.AudioWorkletNode(ctx, 'retina-pcm');
        node.port.onmessage = function (e) {
          var pcm = pcmLib().toPcm16k(e.data, ctx.sampleRate);
          for (var i = 0; i < pcm.length; i++) {
            buf[fill++] = pcm[i];
            if (fill === CHUNK) {
              var out = buf.buffer.slice(0);
              listeners.forEach(function (fn) { fn(out); });
              fill = 0;
            }
          }
        };
        ctx.createMediaStreamSource(stream).connect(node);
        return {
          onChunk: function (fn) { listeners.push(fn); },
          close: function () {
            stream.getTracks().forEach(function (t) { t.stop(); });
            ctx.close();
            root.URL.revokeObjectURL(url);
          }
        };
      })
      .catch(function (err) {
        if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
        if (ctx) ctx.close();
        throw err;
      });
  }

  return { listMics: listMics, openMic: openMic };
});
