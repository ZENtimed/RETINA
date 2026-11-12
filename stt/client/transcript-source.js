/* RETINA STT: the Call Transcript source. Live = two mics through the relay; Replay = the scripted EM-104 call.
   Live falls back to Replay, one way, when anything on the live path fails (ADR 0002). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EMS = root.EMS || {}; Object.assign(root.EMS, api); }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  var SPEAKERS = ['Operator', 'Caller'];
  var READY_TIMEOUT = 3000, REPLAY_GAP = 1500, RELAY_PORT = '8787';

  function phrases() { return (typeof module === 'object' && module.exports) ? require('./phrases') : root.EMS; }
  function servedByRelay(loc) { return (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') && String(loc.port) === RELAY_PORT; }

  function sttMode(loc) { return servedByRelay(loc) || /[?&]stt=live(&|$)/.test(loc.search || '') ? 'live' : 'replay'; }
  function relayUrlFor(loc) { return servedByRelay(loc) ? 'ws://' + loc.host + '/stt' : 'ws://localhost:' + RELAY_PORT + '/stt'; }

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

  /* Operator / Caller by label substring when given, else the first two inputs in order. Null when it can't label both. */
  function pickMics(mics, labels) {
    if (labels && labels.Operator && labels.Caller) {
      var find = function (s) { return mics.find(function (m) { return (m.label || '').toLowerCase().indexOf(s.toLowerCase()) >= 0; }); };
      var op = find(labels.Operator), ca = find(labels.Caller);
      return op && ca && op.deviceId !== ca.deviceId ? { Operator: op, Caller: ca } : null;
    }
    return mics.length >= 2 ? { Operator: mics[0], Caller: mics[1] } : null;
  }

  function createTranscriptSource(opts) {
    var env = opts.env, handlers = { line: [], mode: [] };
    var stopped = false, failed = false, readyTimer = null, replayTimer = null;
    var sockets = {}, mics = {}, ready = {}, counter = { Operator: 0, Caller: 0 }, pending = { Operator: null, Caller: null };

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
      SPEAKERS.forEach(function (s) {
        var ws = sockets[s];
        if (ws) { ws.onmessage = ws.onclose = ws.onerror = null; ws.close(); }
        if (mics[s]) mics[s].close();
      });
      sockets = {}; mics = {};
    }

    function fail() {
      if (failed || stopped) return;
      failed = true;
      SPEAKERS.forEach(function (s) { if (pending[s]) emit('line', { id: pending[s].id, removed: true }); pending[s] = null; });
      closeLive();
      emit('mode', 'replay');
      startReplay();
    }

    function onMessage(speaker, msg) {
      if (msg.type === 'ready') {
        ready[speaker] = true;
        if (SPEAKERS.every(function (s) { return ready[s]; })) {
          env.clearTimeout(readyTimer); readyTimer = null;
          emit('mode', 'live');
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

    function openSocket(speaker) {
      var ws = new env.WebSocket(opts.relayUrl + '?speaker=' + speaker);
      ws.binaryType = 'arraybuffer';
      ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (err) { return; } onMessage(speaker, m); };
      ws.onclose = ws.onerror = fail;
      sockets[speaker] = ws;
      mics[speaker].onChunk(function (chunk) { if (ready[speaker] && sockets[speaker] === ws) ws.send(chunk); });
    }

    function startLive() {
      readyTimer = env.setTimeout(function () { readyTimer = null; fail(); }, READY_TIMEOUT);
      Promise.resolve().then(env.listMics).then(function (list) {
        var picked = pickMics(list || [], opts.micLabels);
        if (!picked) throw new Error('need two microphones');
        return Promise.allSettled(SPEAKERS.map(function (s) { return env.openMic(picked[s].deviceId, env.workletSrc); }));
      }).then(function (results) {
        var opened = results.filter(function (r) { return r.status === 'fulfilled'; }).map(function (r) { return r.value; });
        if (stopped || failed || opened.length < SPEAKERS.length) {
          opened.forEach(function (m) { m.close(); });
          if (opened.length < SPEAKERS.length) throw new Error('microphone unavailable');
          return;
        }
        SPEAKERS.forEach(function (s, i) { mics[s] = opened[i]; });
        SPEAKERS.forEach(openSocket);
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

  return { createTranscriptSource: createTranscriptSource, upsertLine: upsertLine, chipsFor: chipsFor, sttMode: sttMode, relayUrlFor: relayUrlFor };
});
