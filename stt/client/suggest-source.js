/* RETINA Intake form suggestions, browser side: sends finished transcript lines to the relay's POST /suggest
   and reports the checked fields. Timing: 800 ms after the last finished line, one request in flight,
   the newest answer wins. suggestionStep decides when a field's suggestion shows (spec 2026-11-13). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EMS = root.EMS || {}; Object.assign(root.EMS, api); }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var DEBOUNCE = 800, GUARD = 12000, MAX_LINES = 200;

  function createSuggestSource(opts) {
    var env = opts.env, handlers = { fields: [], status: [] };
    var pending = null, lastKey = '0|', debounceTimer = null, guardTimer = null; /* '0|' = no finished line yet: nothing to send */
    var inFlight = 0, seq = 0, queued = false, off = false, stopped = false, status = 'on';

    function emit(ev, v) { handlers[ev].forEach(function (fn) { fn(v); }); }
    function setStatus(s) { if (s !== status) { status = s; emit('status', s); } }
    function clear(t) { if (t !== null) env.clearTimeout(t); return null; }

    function settle(mine) {
      if (mine !== inFlight) return false;
      inFlight = 0; guardTimer = clear(guardTimer);
      return true;
    }
    function next() { if (queued && !off && !stopped) { queued = false; send(); } }

    function send() {
      var mine = ++seq;
      inFlight = mine;
      guardTimer = env.setTimeout(function () {
        guardTimer = null;
        if (mine !== inFlight || stopped) return;
        inFlight = 0; setStatus('off'); next();
      }, GUARD);
      env.fetch(opts.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines: pending }) })
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { status: r.status, body: j }; }); })
        .then(function (r) {
          if (stopped || !settle(mine)) return;
          if (r.status === 200 && r.body && r.body.fields) { setStatus('on'); emit('fields', r.body.fields); }
          else if (r.status === 503) { off = true; queued = false; setStatus('off'); }
          else setStatus('off');
          next();
        }, function () {
          if (stopped || !settle(mine)) return;
          setStatus('off'); next();
        });
    }

    function fire() {
      debounceTimer = null;
      if (off || stopped) return;
      if (inFlight) queued = true; else send();
    }

    return {
      on: function (ev, fn) { handlers[ev].push(fn); },
      update: function (lines) {
        if (off || stopped) return;
        var done = (lines || []).filter(function (l) { return !l.partial; });
        var last = done[done.length - 1];
        var key = done.length + '|' + (last ? last.id + '|' + last.text : '');
        if (key === lastKey) return;
        lastKey = key;
        pending = done.slice(-MAX_LINES).map(function (l) { return { id: l.id, time: l.time, speaker: l.speaker, text: l.text }; });
        debounceTimer = clear(debounceTimer);
        debounceTimer = env.setTimeout(fire, DEBOUNCE);
      },
      stop: function () {
        stopped = true;
        debounceTimer = clear(debounceTimer);
        guardTimer = clear(guardTimer);
      }
    };
  }

  /* One field's suggestion. It shows while it differs from the field. After Use, typing or dismiss it comes back only for a
     different value cited from a LATER line of the call (new information): a summary reworded from the same or an earlier
     line stays hidden, so it doesn't keep popping back. lineIndex is the cited line's position in the transcript. */
  function newerLine(st, ev) {
    if (typeof ev.lineIndex === 'number' && typeof st.lineIndex === 'number') return ev.lineIndex > st.lineIndex;
    return !(ev.lineId && ev.lineId === st.lineId);
  }
  function suggestionStep(st, ev) {
    if (ev.type === 'incoming') {
      if (ev.value === st.shown) return st;
      /* A summary (summary: true) cites later lines as it grows, so once acted on it stays the call taker's for the call. */
      if (!st.visible && st.shown !== null && (ev.summary || !newerLine(st, ev))) return st;
      var field = ev.fieldValue || '';
      var visible = ev.value !== field;
      var next = { shown: ev.value, visible: visible, updated: visible && field !== '', heardAt: ev.heardAt || '', lineId: ev.lineId || null };
      if (typeof ev.lineIndex === 'number') next.lineIndex = ev.lineIndex;
      return next;
    }
    if (ev.type === 'use' || ev.type === 'type' || ev.type === 'dismiss') return st.visible ? Object.assign({}, st, { visible: false }) : st;
    return st;
  }

  return { createSuggestSource: createSuggestSource, suggestionStep: suggestionStep };
});
