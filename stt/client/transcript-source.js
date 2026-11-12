/* RETINA STT: the Call Transcript source. Live = two mics through the relay; Replay = the scripted EM-104 call.
   Live falls back to Replay, one way, when anything on the live path fails (ADR 0002). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EMS = root.EMS || {}; Object.assign(root.EMS, api); }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  var SPEAKERS = ['Operator', 'Caller'];
  /* READY_TIMEOUT counts from the sockets opening (not from the mic permission prompt).
     AUDIO_TIMEOUT gives Chrome time to start a suspended AudioContext on the first click. */
  var READY_TIMEOUT = 3000, AUDIO_TIMEOUT = 10000, REPLAY_GAP = 1500, RELAY_PORT = '8787';

  function phrases() { return (typeof module === 'object' && module.exports) ? require('./phrases') : root.EMS; }
  /* The relay serves the page itself, on whatever port it runs (STT_PORT), and only on this machine. */
  function servedByRelay(loc) { return (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') && !!loc.port; }

  function sttMode(loc) { return servedByRelay(loc) || /[?&]stt=live(&|$)/.test(loc.search || '') ? 'live' : 'replay'; }
  function relayUrlFor(loc) { return servedByRelay(loc) ? 'ws://' + loc.host + '/stt' : 'ws://localhost:' + RELAY_PORT + '/stt'; }
  /* Form suggestions run only on the relay's own page: it posts to that relay's /suggest. */
  function suggestUrlFor(loc) { return servedByRelay(loc) ? 'http://' + loc.host + '/suggest' : null; }

  /* True when a scroll box is showing its end (within 24 px), so new lines should keep it pinned there. */
  function isNearBottom(el) { return el.scrollHeight - el.scrollTop - el.clientHeight <= 24; }

  function upsertLine(lines, line) {
    if (line.removed) return lines.filter(function (l) { return l.id !== line.id; });
    var i = lines.findIndex(function (l) { return l.id === line.id; });
    if (i < 0) return lines.concat([line]);
    var next = lines.slice(); next[i] = line; return next;
  }

  function chipsFor(lines, type) {
    if (!type) return [];
    var out = [];
    lines.forEach(function (l) {
      if (l.partial) return;
      (l.chips || []).forEach(function (c) { if (c.type === type && out.indexOf(c.chip) < 0) out.push(c.chip); });
    });
    return out;
  }

  /* ?mics=1 is a test mode for a machine with one microphone: it is the Caller, and the Operator is not transcribed.
     Without it, Live needs two inputs so each line is labelled by its microphone, never guessed (ADR 0002). */
  function sttSpeakers(loc) { return /[?&]mics=1(&|$)/.test(loc.search || '') ? ['Caller'] : SPEAKERS.slice(); }

  /* ?op=<label part> and ?caller=<label part> name each microphone (for example ?caller=CABLE for a
     Telegram call routed through VB-Audio Virtual Cable). They override window.RETINA_STT.micLabels. */
  function urlParam(search, name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(search || '');
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim(); } catch (e) { return ''; }
  }
  function sttMicLabels(loc, cfg) {
    var out = Object.assign({}, cfg && cfg.micLabels);
    var op = urlParam(loc.search, 'op'), caller = urlParam(loc.search, 'caller');
    if (op) out.Operator = op;
    if (caller) out.Caller = caller;
    return Object.keys(out).length ? out : undefined;
  }

  /* A named speaker gets the first mic whose label contains its name; a speaker with no name gets the first
     mic not taken yet, in order. Null when a named mic is missing or a speaker is left without a mic. */
  function pickMics(mics, labels, speakers) {
    var picked = {}, used = [];
    var free = function (m) { return m && used.indexOf(m.deviceId) < 0; };
    for (var i = 0; i < speakers.length; i++) {
      var want = labels && labels[speakers[i]];
      if (!want) continue;
      var m = mics.find(function (x) { return (x.label || '').toLowerCase().indexOf(want.toLowerCase()) >= 0; });
      if (!free(m)) return null;
      picked[speakers[i]] = m; used.push(m.deviceId);
    }
    for (var j = 0; j < speakers.length; j++) {
      if (picked[speakers[j]]) continue;
      var next = mics.find(free);
      if (!next) return null;
      picked[speakers[j]] = next; used.push(next.deviceId);
    }
    return picked;
  }

  function createTranscriptSource(opts) {
    var env = opts.env, handlers = { line: [], mode: [] };
    var stopped = false, failed = false, live = false, readyTimer = null, audioTimer = null, replayTimer = null;
    var speakers = opts.speakers || SPEAKERS;
    var sockets = {}, mics = {}, ready = {}, heard = {}, counter = {}, pending = {};
    speakers.forEach(function (s) { counter[s] = 0; pending[s] = null; });

    function emit(ev, v) { handlers[ev].forEach(function (fn) { fn(v); }); }
    function clock() { return env.now().toLocaleTimeString('en-GB', { hour12: false }); }

    function startReplay() {
      var i = 0;
      (function next() {
        if (stopped || i >= opts.replayLines.length) return;
        var l = opts.replayLines[i];
        emit('line', { id: 'replay-' + i, time: l[0], speaker: l[1], text: l[2], partial: false, chips: phrases().suggestChips(l[2]) });
        i++;
        if (i < opts.replayLines.length) replayTimer = env.setTimeout(next, REPLAY_GAP);
      })();
    }

    function closeLive() {
      if (readyTimer !== null) { env.clearTimeout(readyTimer); readyTimer = null; }
      if (audioTimer !== null) { env.clearTimeout(audioTimer); audioTimer = null; }
      speakers.forEach(function (s) {
        var ws = sockets[s];
        if (ws) { ws.onmessage = ws.onclose = ws.onerror = null; ws.close(); }
        if (mics[s]) mics[s].close();
      });
      sockets = {}; mics = {};
    }

    function fail() {
      if (failed || stopped) return;
      failed = true;
      speakers.forEach(function (s) { if (pending[s]) emit('line', { id: pending[s].id, removed: true }); pending[s] = null; });
      closeLive();
      emit('mode', 'replay');
      startReplay();
    }

    function onMessage(speaker, msg) {
      if (msg.type === 'ready') {
        ready[speaker] = true;
        if (speakers.every(function (s) { return ready[s]; }) && readyTimer !== null) {
          env.clearTimeout(readyTimer); readyTimer = null;
          audioTimer = env.setTimeout(function () { audioTimer = null; fail(); }, AUDIO_TIMEOUT);
          checkLive();
        }
      } else if (msg.type === 'partial' || msg.type === 'final') {
        if (!pending[speaker]) pending[speaker] = { id: speaker + '-' + counter[speaker], time: clock() };
        var p = pending[speaker], final = msg.type === 'final';
        emit('line', { id: p.id, time: p.time, speaker: speaker, text: msg.text, partial: !final, chips: final ? phrases().suggestChips(msg.text) : [] });
        if (final) { pending[speaker] = null; counter[speaker]++; }
      } else if (msg.type === 'error') {
        fail();
      }
    }

    /* Live only once both relays are ready and audio is actually reaching them from both mics. */
    function checkLive() {
      if (live || failed || stopped) return;
      if (!speakers.every(function (s) { return ready[s] && heard[s]; })) return;
      live = true;
      if (audioTimer !== null) { env.clearTimeout(audioTimer); audioTimer = null; }
      emit('mode', 'live');
    }

    function openSocket(speaker) {
      var ws = new env.WebSocket(opts.relayUrl + '?speaker=' + speaker);
      ws.binaryType = 'arraybuffer';
      ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (err) { return; } onMessage(speaker, m); };
      ws.onclose = ws.onerror = fail;
      sockets[speaker] = ws;
      mics[speaker].onChunk(function (chunk) {
        if (!ready[speaker] || sockets[speaker] !== ws) return;
        ws.send(chunk);
        if (!heard[speaker]) { heard[speaker] = true; checkLive(); }
      });
    }

    function startLive() {
      emit('mode', 'connecting');
      Promise.resolve().then(env.listMics).then(function (list) {
        var picked = pickMics(list || [], opts.micLabels, speakers);
        if (!picked) throw new Error('need two microphones');
        return Promise.allSettled(speakers.map(function (s) { return env.openMic(picked[s].deviceId, env.workletSrc); }));
      }).then(function (results) {
        var opened = results.filter(function (r) { return r.status === 'fulfilled'; }).map(function (r) { return r.value; });
        if (stopped || failed || opened.length < speakers.length) {
          opened.forEach(function (m) { m.close(); });
          if (opened.length < speakers.length) throw new Error('microphone unavailable');
          return;
        }
        speakers.forEach(function (s, i) { mics[s] = opened[i]; });
        speakers.forEach(openSocket);
        if (!failed) readyTimer = env.setTimeout(function () { readyTimer = null; fail(); }, READY_TIMEOUT);
      }).catch(fail);
    }

    return {
      on: function (ev, fn) { handlers[ev].push(fn); },
      start: function () {
        if (opts.mode === 'live') startLive();
        else { emit('mode', 'replay'); startReplay(); }
      },
      stop: function () {
        stopped = true;
        if (replayTimer !== null) env.clearTimeout(replayTimer);
        closeLive();
      }
    };
  }

  return { createTranscriptSource: createTranscriptSource, upsertLine: upsertLine, chipsFor: chipsFor, sttMode: sttMode, sttSpeakers: sttSpeakers, sttMicLabels: sttMicLabels, relayUrlFor: relayUrlFor, suggestUrlFor: suggestUrlFor, isNearBottom: isNearBottom };
});
