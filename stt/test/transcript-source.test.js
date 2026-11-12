const test = require('node:test');
const assert = require('node:assert/strict');
const { createTranscriptSource, upsertLine, chipsFor, sttMode, relayUrlFor, isNearBottom } = require('../client/transcript-source');

test('isNearBottom: within 24 px of the end counts as following', () => {
  assert.equal(isNearBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 }), true);
  assert.equal(isNearBottom({ scrollTop: 580, scrollHeight: 1000, clientHeight: 400 }), true);
  assert.equal(isNearBottom({ scrollTop: 570, scrollHeight: 1000, clientHeight: 400 }), false);
  assert.equal(isNearBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 }), true, 'no overflow');
});

const REPLAY = [
  ['14:19:51', 'Operator', '1669 emergency. What is your emergency?'],
  ['14:19:55', 'Caller', 'There is an accident in front of Building A, Soi Lat Phrao 1.'],
  ['14:20:02', 'Caller', 'Motorcycle hit a pole.'],
  ['14:20:06', 'Caller', 'The victim is unconscious and not breathing.'],
  ['14:20:11', 'Operator', 'Is anyone with you able to start CPR?'],
  ['14:20:15', 'Caller', 'A man is starting CPR now. There is a lot of bleeding from his head.'],
  ['14:20:21', 'Operator', 'Stay on the line. Help is being arranged.'],
  ['14:20:30', 'Caller', 'He is about thirty. No helmet.']
];
const RELAY = 'ws://localhost:8787/stt';
const flush = () => new Promise(r => setImmediate(r));

/* Hand-driven clock, sockets and microphones. */
function makeEnv({ mics = [{ deviceId: 'a', label: 'Mic A' }, { deviceId: 'b', label: 'Mic B' }], openFails = false, listDelay = 0 } = {}) {
  let now = 0, seq = 0;
  const timers = new Map();
  const sockets = [], opened = {}, closedMics = [];
  class FakeWebSocket {
    constructor(url) { this.url = url; this.sent = []; this.closed = false; sockets.push(this); }
    send(x) { this.sent.push(x); }
    close() { this.closed = true; }
    emitMessage(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
    emitClose() { this.onclose && this.onclose({ code: 1006 }); }
  }
  const env = {
    WebSocket: FakeWebSocket,
    listMics: () => listDelay ? new Promise(res => env.setTimeout(() => res(mics), listDelay)) : Promise.resolve(mics),
    openMic: (id) => openFails ? Promise.reject(new Error('denied')) : Promise.resolve({
      onChunk(fn) { opened[id] = fn; },
      close() { closedMics.push(id); }
    }),
    workletSrc: 'w',
    now: () => new Date(2026, 10, 12, 14, 20, 2),
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: id => { timers.delete(id); }
  };
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].at; due[1].fn();
    }
    now = end;
  }
  return { env, advance, sockets, opened, closedMics, timers };
}

function collect(src) {
  const lines = [], modes = [];
  src.on('line', l => lines.push(l));
  src.on('mode', m => modes.push(m));
  return { lines, modes };
}

test('replay: line 0 at once, then one line every 1500 ms, with chips', () => {
  const { env, advance } = makeEnv();
  const src = createTranscriptSource({ mode: 'replay', replayLines: REPLAY, relayUrl: RELAY, env });
  const { lines, modes } = collect(src);
  src.start();
  assert.deepEqual(modes, ['replay']);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], { id: 'replay-0', time: '14:19:51', speaker: 'Operator', text: REPLAY[0][2], partial: false, chips: [] });
  advance(1499); assert.equal(lines.length, 1);
  advance(1); assert.equal(lines.length, 2);
  advance(1500);
  assert.deepEqual(lines[2].chips, [{ chip: 'Motorcycle vs pole', type: 'moi' }]);
  advance(10 * 1500); assert.equal(lines.length, 8);
});

async function goLive(opts) {
  const h = makeEnv(opts);
  const src = createTranscriptSource({ mode: 'live', replayLines: REPLAY, relayUrl: RELAY, env: h.env, micLabels: opts && opts.micLabels });
  const c = collect(src);
  src.start();
  await flush(); await flush();
  return Object.assign(h, c, { src });
}
const ready = h => h.sockets.forEach((s, i) => s.emitMessage({ type: 'ready', speaker: i ? 'Caller' : 'Operator' }));
const audio = h => { h.opened.a(new ArrayBuffer(2)); h.opened.b(new ArrayBuffer(2)); };
async function goLiveFlowing(opts) { const h = await goLive(opts); ready(h); audio(h); return h; }

test('live: connecting first; live only when both sockets are ready and audio flows from both mics', async () => {
  const h = await goLive();
  assert.deepEqual(h.sockets.map(s => s.url), [RELAY + '?speaker=Operator', RELAY + '?speaker=Caller']);
  assert.deepEqual(h.modes, ['connecting']);
  ready(h);
  assert.deepEqual(h.modes, ['connecting'], 'ready alone is not live: no audio yet');
  h.opened.a(new ArrayBuffer(2));
  assert.deepEqual(h.modes, ['connecting'], 'one mic is not enough');
  h.opened.b(new ArrayBuffer(2));
  assert.deepEqual(h.modes, ['connecting', 'live']);
  h.advance(60000);
  assert.deepEqual(h.modes, ['connecting', 'live'], 'both timers are cleared');
});

test('live: partials and the final share one id; chips only on the final', async () => {
  const h = await goLiveFlowing();
  const caller = h.sockets[1];
  caller.emitMessage({ type: 'partial', speaker: 'Caller', text: 'Motorcycle' });
  caller.emitMessage({ type: 'partial', speaker: 'Caller', text: 'Motorcycle hit a' });
  caller.emitMessage({ type: 'final', speaker: 'Caller', text: 'Motorcycle hit a pole.', lang: 'en-us' });
  assert.deepEqual(h.lines.map(l => [l.id, l.partial, l.chips.length]), [['Caller-0', true, 0], ['Caller-0', true, 0], ['Caller-0', false, 1]]);
  assert.equal(h.lines[2].time, '14:20:02');
  assert.equal(h.lines[2].speaker, 'Caller');
  caller.emitMessage({ type: 'partial', speaker: 'Caller', text: 'No' });
  assert.equal(h.lines[3].id, 'Caller-1');
});

test('live: mic chunks go to their own speaker socket, only after that socket is ready', async () => {
  const h = await goLive();
  h.opened.b(new ArrayBuffer(1));
  ready(h);
  const chunk = new ArrayBuffer(4);
  h.opened.b(chunk);
  assert.deepEqual(h.sockets[1].sent, [chunk]);
  assert.deepEqual(h.sockets[0].sent, []);
});

test('the permission prompt does not count against the 3 s ready timeout', async () => {
  const h = await goLive({ listDelay: 5000 });
  assert.deepEqual(h.modes, ['connecting']);
  h.advance(5000); await flush(); await flush();
  assert.equal(h.sockets.length, 2);
  assert.deepEqual(h.modes, ['connecting'], 'still connecting after a 5 s prompt');
  ready(h); audio(h);
  assert.deepEqual(h.modes, ['connecting', 'live']);
});

test('fallback at start: no ready within 3000 ms of the sockets opening', async () => {
  const h = await goLive();
  h.advance(2999); assert.deepEqual(h.modes, ['connecting']);
  h.advance(1);
  assert.deepEqual(h.modes, ['connecting', 'replay']);
  assert.equal(h.lines[0].id, 'replay-0');
  assert.ok(h.sockets.every(s => s.closed));
  assert.deepEqual(h.closedMics.sort(), ['a', 'b']);
});

test('fallback at start: ready but no audio within 10 s (audio context never started)', async () => {
  const h = await goLive();
  ready(h);
  h.opened.a(new ArrayBuffer(2));
  h.advance(9999); assert.deepEqual(h.modes, ['connecting']);
  h.advance(1);
  assert.deepEqual(h.modes, ['connecting', 'replay']);
  assert.equal(h.lines[0].id, 'replay-0');
});

test('fallback at start: only one microphone', async () => {
  const h = await goLive({ mics: [{ deviceId: 'a', label: 'Mic A' }] });
  assert.deepEqual(h.modes, ['connecting', 'replay']);
  assert.equal(h.sockets.length, 0);
  assert.equal(h.lines[0].id, 'replay-0');
});

test('fallback at start: microphone denied', async () => {
  const h = await goLive({ openFails: true });
  assert.deepEqual(h.modes, ['connecting', 'replay']);
  assert.equal(h.sockets.length, 0);
});

test('fallback at start: relay down closes the socket at once', async () => {
  const h = await goLive();
  h.sockets[0].emitClose();
  assert.deepEqual(h.modes, ['connecting', 'replay']);
});

test('fallback mid-call: grey partial removed, finals kept, nothing re-emitted', async () => {
  const h = await goLiveFlowing();
  const caller = h.sockets[1];
  caller.emitMessage({ type: 'final', speaker: 'Caller', text: 'Motorcycle hit a pole.', lang: 'en-us' });
  caller.emitMessage({ type: 'partial', speaker: 'Caller', text: 'No hel' });
  const before = h.lines.length;
  caller.emitClose();
  assert.deepEqual(h.lines[before], { id: 'Caller-1', removed: true });
  assert.deepEqual(h.modes, ['connecting', 'live', 'replay']);
  assert.ok(h.sockets.every(s => s.closed));
  assert.deepEqual(h.closedMics.sort(), ['a', 'b']);
  assert.equal(h.lines[before + 1].id, 'replay-0');
  assert.equal(h.lines.filter(l => l.id === 'Caller-0').length, 1);
  h.sockets[0].emitClose();
  assert.deepEqual(h.modes, ['connecting', 'live', 'replay'], 'fallback is one-way');
});

test('fallback mid-call: relay error message', async () => {
  const h = await goLiveFlowing();
  h.sockets[0].emitMessage({ type: 'error', message: 'quota' });
  assert.deepEqual(h.modes, ['connecting', 'live', 'replay']);
});

test('micLabels pick devices by label substring, whatever the order', async () => {
  const h = await goLive({ mics: [{ deviceId: 'u', label: 'USB Audio' }, { deviceId: 'x', label: 'Laptop' }, { deviceId: 'hs', label: 'Headset Mic' }],
    micLabels: { Operator: 'Headset', Caller: 'USB' } });
  ready(h);
  h.opened.hs(new ArrayBuffer(1));
  h.opened.u(new ArrayBuffer(2));
  assert.equal(h.sockets[0].sent[0].byteLength, 1);
  assert.equal(h.sockets[1].sent[0].byteLength, 2);
  assert.equal(h.opened.x, undefined);
});

test('stop() clears timers and closes sockets and mics', async () => {
  const h = await goLive();
  h.src.stop();
  assert.equal(h.timers.size, 0);
  assert.ok(h.sockets.every(s => s.closed));
  assert.deepEqual(h.closedMics.sort(), ['a', 'b']);
  h.advance(20000);
  assert.deepEqual(h.modes, ['connecting']);
});

test('upsertLine replaces, appends and removes', () => {
  const a = { id: 'a', text: '1' }, b = { id: 'b', text: '2' };
  assert.deepEqual(upsertLine([a], b), [a, b]);
  assert.deepEqual(upsertLine([a, b], { id: 'a', text: '3' }), [{ id: 'a', text: '3' }, b]);
  assert.deepEqual(upsertLine([a, b], { id: 'a', removed: true }), [b]);
});

test('chipsFor: finals only, filtered by Case Type, none before a type', () => {
  const lines = [
    { id: '1', partial: false, chips: [{ chip: 'Motorcycle vs pole', type: 'moi' }, { chip: 'Unconscious', type: 'noi' }] },
    { id: '2', partial: true, chips: [{ chip: 'No helmet', type: 'moi' }] },
    { id: '3', partial: false, chips: [{ chip: 'Motorcycle vs pole', type: 'moi' }] }
  ];
  assert.deepEqual(chipsFor(lines, 'moi'), ['Motorcycle vs pole']);
  assert.deepEqual(chipsFor(lines, 'noi'), ['Unconscious']);
  assert.deepEqual(chipsFor(lines, null), []);
});

test('sttMode and relayUrlFor', () => {
  assert.equal(sttMode({ hostname: 'localhost', port: '8787', search: '' }), 'live');
  assert.equal(sttMode({ hostname: 'claude.ai', port: '', search: '?stt=live' }), 'live');
  assert.equal(sttMode({ hostname: 'claude.ai', port: '', search: '' }), 'replay');
  assert.equal(relayUrlFor({ host: '127.0.0.1:8787', hostname: '127.0.0.1', port: '8787' }), 'ws://127.0.0.1:8787/stt');
  assert.equal(relayUrlFor({ host: 'claude.ai', hostname: 'claude.ai', port: '' }), 'ws://localhost:8787/stt');
});
