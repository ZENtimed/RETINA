const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { createServer } = require('../src/server');

const harnessPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'retina-stt-')), 'harness.html');
fs.writeFileSync(harnessPath, '<!doctype html><title>h</title>');

/* A fake Google stream per connection, recording what the relay does with it. */
function start() {
  const streams = [];
  const openStream = (opts) => {
    const s = { opts, writes: [], ends: 0, write(b) { s.writes.push(b); }, end() { s.ends++; } };
    streams.push(s);
    return s;
  };
  const server = createServer({ openStream, harnessPath });
  return new Promise(res => server.listen(0, '127.0.0.1', () => res({ server, streams, port: server.address().port })));
}

function connect(port, speaker) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/stt?speaker=${speaker}`);
  const messages = [];
  const waiters = [];
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    messages.push(JSON.parse(data.toString()));
    waiters.splice(0).forEach(w => w());
  });
  const next = (n) => new Promise(res => { const check = () => messages.length >= n ? res(messages[n - 1]) : waiters.push(check); check(); });
  const closed = new Promise(res => ws.on('close', (code) => res(code)));
  return { ws, messages, next, closed };
}

const tick = () => new Promise(r => setTimeout(r, 30));

test('ready, then binary frames reach the stream unchanged', async () => {
  const { server, streams, port } = await start();
  const c = connect(port, 'Caller');
  assert.deepEqual(await c.next(1), { type: 'ready', speaker: 'Caller' });
  c.ws.send(Buffer.from([1, 2, 3]));
  await tick();
  assert.deepEqual([...streams[0].writes[0]], [1, 2, 3]);
  assert.equal(streams[0].opts.speaker, 'Caller');
  c.ws.close(); await c.closed; server.close();
});

test('partial and final from the stream are sent with the speaker', async () => {
  const { server, streams, port } = await start();
  const c = connect(port, 'Caller');
  await c.next(1);
  streams[0].opts.onPartial('มอเตอร์');
  streams[0].opts.onFinal('Motorcycle hit a pole.', 'en-us');
  assert.deepEqual(await c.next(2), { type: 'partial', speaker: 'Caller', text: 'มอเตอร์' });
  assert.deepEqual(await c.next(3), { type: 'final', speaker: 'Caller', text: 'Motorcycle hit a pole.', lang: 'en-us' });
  c.ws.close(); await c.closed; server.close();
});

test('a stream error is reported, then the socket closes with 1011', async () => {
  const { server, streams, port } = await start();
  const c = connect(port, 'Operator');
  await c.next(1);
  streams[0].opts.onError(new Error('quota'));
  assert.deepEqual(await c.next(2), { type: 'error', message: 'quota' });
  assert.equal(await c.closed, 1011);
  server.close();
});

test('client close ends the stream exactly once', async () => {
  const { server, streams, port } = await start();
  const c = connect(port, 'Operator');
  await c.next(1);
  c.ws.close();
  await c.closed; await tick();
  assert.equal(streams[0].ends, 1);
  server.close();
});

test('the text "stop" ends the stream exactly once, even after close', async () => {
  const { server, streams, port } = await start();
  const c = connect(port, 'Operator');
  await c.next(1);
  c.ws.send('stop');
  await tick();
  c.ws.close();
  await c.closed; await tick();
  assert.equal(streams[0].ends, 1);
  server.close();
});

test('an unknown speaker is closed with 1008 and opens no stream', async () => {
  const { server, streams, port } = await start();
  const c = connect(port, 'Boss');
  assert.equal(await c.closed, 1008);
  assert.equal(streams.length, 0);
  server.close();
});

test('a page from another origin is closed with 1008 and opens no stream', async () => {
  const { server, streams, port } = await start();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/stt?speaker=Caller`, { origin: 'https://evil.example' });
  const code = await Promise.race([new Promise(res => ws.on('close', res)), new Promise(res => setTimeout(() => res('still open after 2 s'), 2000))]);
  if (code !== 1008) ws.terminate();
  assert.equal(code, 1008);
  assert.equal(streams.length, 0);
  const ok = new WebSocket(`ws://127.0.0.1:${port}/stt?speaker=Caller`, { origin: `http://localhost:${port}` });
  const first = await new Promise(res => ok.on('message', d => res(JSON.parse(d.toString()))));
  assert.equal(first.type, 'ready');
  ok.close(); await new Promise(res => ok.on('close', res));
  server.close();
});

test('listens on 127.0.0.1 only', async () => {
  const { server } = await start();
  assert.equal(server.address().address, '127.0.0.1');
  server.close();
});

test('GET / serves the harness; anything else is 404', async () => {
  const { server, port } = await start();
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html/);
  assert.equal(await res.text(), fs.readFileSync(harnessPath, 'utf8'));
  assert.equal((await fetch(`http://127.0.0.1:${port}/x`)).status, 404);
  server.close();
});
