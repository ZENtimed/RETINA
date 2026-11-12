// RETINA STT relay: serves the preview harness and bridges one WebSocket per microphone to one Google stream.
const http = require('node:http');
const fs = require('node:fs');
const { WebSocketServer } = require('ws');

const SPEAKERS = ['Operator', 'Caller'];

/* Only the relay's own page (or a non-browser client with no Origin) may use the Google key. */
function allowedOrigin(origin, host) {
  if (!origin) return true;
  const port = String(host || '').split(':')[1] || '80';
  return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
}

const MAX_BODY = 262144, MAX_LINES = 400;

function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/* Each line is { id, time, speaker, text }, all strings. */
function validLines(body) {
  const lines = body && body.lines;
  if (!Array.isArray(lines) || lines.length > MAX_LINES) return null;
  const ok = lines.every(l => l && ['id', 'time', 'speaker', 'text'].every(k => typeof l[k] === 'string'));
  return ok ? lines.map(l => ({ id: l.id, time: l.time, speaker: l.speaker, text: l.text })) : null;
}

/* POST /suggest {lines}: 200 {fields}, 503 {off} with no key, 502 {error} when Anthropic fails. */
function handleSuggest(req, res, suggest) {
  if (!allowedOrigin(req.headers.origin, req.headers.host)) { req.resume(); json(res, 403, { error: 'origin not allowed' }); return; }
  const chunks = [];
  let size = 0, done = false;
  req.on('data', c => {
    if (done) return;
    size += c.length;
    if (size > MAX_BODY) { done = true; json(res, 413, { error: 'body too large' }); req.resume(); return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    if (done) return;
    done = true;
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (err) { json(res, 400, { error: 'not JSON' }); return; }
    const lines = validLines(body);
    if (!lines) { json(res, 400, { error: 'expected {lines: [{id, time, speaker, text}]}' }); return; }
    if (!suggest) { json(res, 503, { off: true }); return; }
    const r = await suggest(lines);
    if (r && r.ok) json(res, 200, { fields: r.fields });
    else json(res, 502, { error: (r && r.reason) || 'error' });
  });
}

function createServer({ openStream, harnessPath, suggest = null }) {
  const wss = new WebSocketServer({ noServer: true });

  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://relay');
    if (req.method === 'POST' && pathname === '/suggest') { handleSuggest(req, res, suggest); return; }
    if (req.method === 'GET' && pathname === '/') {
      fs.readFile(harnessPath, (err, body) => {
        if (err) { res.writeHead(500); res.end('harness not found'); return; }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(body);
      });
      return;
    }
    res.writeHead(404); res.end('not found');
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://relay');
    if (url.pathname !== '/stt') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      const speaker = url.searchParams.get('speaker');
      if (!SPEAKERS.includes(speaker)) { ws.close(1008, 'bad speaker'); return; }
      if (!allowedOrigin(req.headers.origin, req.headers.host)) { ws.close(1008, 'origin not allowed'); return; }
      bridge(ws, speaker);
    });
  });

  function bridge(ws, speaker) {
    const send = obj => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };
    let ended = false;
    const stream = openStream({
      speaker,
      onPartial: text => send({ type: 'partial', speaker, text }),
      onFinal: (text, lang) => send({ type: 'final', speaker, text, lang }),
      onError: err => { send({ type: 'error', message: err.message }); finish(); ws.close(1011, 'stream error'); }
    });
    function finish() { if (!ended) { ended = true; stream.end(); } }
    ws.on('message', (data, isBinary) => {
      if (isBinary) { if (!ended) stream.write(Buffer.from(data)); }
      else if (data.toString() === 'stop') finish();
    });
    ws.on('close', finish);
    send({ type: 'ready', speaker });
  }

  return server;
}

module.exports = { createServer };
