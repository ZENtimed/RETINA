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

function createServer({ openStream, harnessPath }) {
  const wss = new WebSocketServer({ noServer: true });

  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://relay');
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
