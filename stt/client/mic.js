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
        var resampler = pcmLib().createResampler(ctx.sampleRate);
        node.port.onmessage = function (e) {
          var pcm = resampler.push(e.data);
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
        /* A muted path to the speakers keeps the graph pulled, so the worklet always runs. */
        var mute = ctx.createGain();
        mute.gain.value = 0;
        node.connect(mute).connect(ctx.destination);
        /* Chrome may create the context suspended until the page gets a click or key press.
           Try now, and again on the first gesture; the transcript source falls back to Replay if audio never flows. */
        var events = ['pointerdown', 'keydown'];
        var resume = function () { if (ctx.state === 'suspended') ctx.resume(); };
        var unlisten = function () { events.forEach(function (ev) { root.document.removeEventListener(ev, resume, true); }); };
        if (ctx.state === 'suspended') {
          events.forEach(function (ev) { root.document.addEventListener(ev, resume, true); });
          ctx.onstatechange = function () { if (ctx.state === 'running') unlisten(); };
          ctx.resume();
        }
        return {
          onChunk: function (fn) { listeners.push(fn); },
          close: function () {
            unlisten();
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
