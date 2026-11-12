# Live Speech-to-Text at Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Intake **Call Transcript** from a scripted replay into live speech-to-text: two microphones (Operator, Caller) stream through a local Node relay to Google Chirp 3, the operator sees grey partial lines and dashed English chip suggestions, and the screen falls back to the scripted replay, with a Live / Replay badge, when the live path fails.

**Architecture:** A Node.js package `stt/` holds two parts. `stt/src/` is the relay: an HTTP + WebSocket server on `127.0.0.1:8787` that serves `preview-harness.html` and opens one Google Speech-to-Text V2 stream per WebSocket (one per microphone). `stt/client/` holds browser code written as UMD scripts, so `node --test` can test it and a Python injector can copy it into the Design System `bundle.js`. That code covers the phrase table, PCM conversion, the microphone worklet and the transcript source with Live → Replay fallback. Intake then renders lines from that source instead of its hard-coded array.

**Tech Stack:** Node.js ≥ 20 (24.18 installed), `node:test`, `ws` 8, `@google-cloud/speech` (v2 client, model `chirp_3`), Python 3 (injector and harness build), React 18.3.1 UMD bundle on the Design System artifact, Figma file `oLhd7VqtFiFiZOvJe73JPk`.

**Spec:** `docs/adr/0002-live-speech-to-text-with-google-chirp-3.md`. The glossary is `CONTEXT.md`, and the folder rules are in `CLAUDE.md`.

## Global Constraints

- AI may suggest facts; people make every decision. A suggestion is a dashed chip and becomes case data only when the operator taps it.
- Chips are always English words from one fixed list, whatever language was spoken (`CONTEXT.md`, Relationships).
- Only a **finished** line can produce an AI suggestion. A partial line shows in grey while the person is still speaking.
- Language is auto-detected with `languageCodes: ["auto"]`. The operator sets nothing. The fallback is `["th-TH", "en-US"]`, set through the env var `STT_LANGUAGES` (ADR 0002).
- Speakers are labelled by which microphone the audio came from, never by diarization. The labels are exactly `Operator` and `Caller`.
- The Google credentials stay on the relay. The browser never talks to Google. The relay binds to `127.0.0.1` only.
- Credentials come from Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`) plus `GOOGLE_CLOUD_PROJECT`. Never commit a key file.
- Google settings: location `us` (env `STT_LOCATION`), endpoint `<location>-speech.googleapis.com`, recognizer `projects/<project>/locations/<location>/recognizers/_`, audio LINEAR16, 16000 Hz, mono.
- UI copy is English. The badge reads exactly `Live` or `Replay`.
- Do not hand-edit the inlined bundle in `preview-harness.html`. Rebuild it with `python scripts/build-preview-harness.py ds preview-harness.html`.
- The Design System artifact `https://claude.ai/artifact/U2YowM3zMU6B6UbQyPC5Ca` and the Figma file are the source of truth for the UI. Ask the user before republishing the artifact.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions this plan makes (the ADR leaves them open)

- **Mic mapping:** Operator is the first audio input and Caller is the second. Either can be overridden with `window.RETINA_STT = { micLabels: { Operator: '<label substring>', Caller: '<label substring>' } }`. With fewer than two inputs, the screen goes to Replay, because a single mic can't label speakers.
- **When Live is attempted:** only when the page is served by the relay (`localhost:8787` or `127.0.0.1:8787`) or the URL has `?stt=live`. Everywhere else, including the claude.ai artifact pages, it starts in Replay, so viewers get no microphone or local-network prompt.
- **Fallback triggers:** no `ready` within 3000 ms, a mic list or mic open that rejects, a WebSocket `error` or `close` while live, or an `error` message from the relay. Fallback is one-way for the session. Lines already shown stay, grey partials are removed, and the replay lines follow them.
- **Replay pace:** the first line at once, then one line every 1500 ms.
- **Case Type filtering:** each chip in the table has one Case Type, taken from the current `TYPE_SUGGEST`. ChipInput shows only the chips of the chosen Case Type that finished lines produced. Before a Case Type is picked, it shows none.
- The "AI Detected Critical Keywords" box on Intake is not part of this ADR and stays unchanged.

## Review Focus

1. **Thai with inserted spaces.** Chirp often returns `มอเตอร์ไซค์ ชน เสา`. It must still match `มอเตอร์ไซค์ชนเสา`. Test in Task 1.
2. **Negated phrases.** `ไม่หมดสติ` or `not unconscious` must not suggest `Unconscious`. Test in Task 1.
3. **Live path unavailable at start.** If the relay is down, the mic is denied or only one mic exists, the screen must reach Replay within 3 s. Test in Task 5.
4. **Live dies mid-call.** Finished lines stay, no grey partial is left behind, the badge flips to Replay and nothing is duplicated. Test in Task 5.
5. **Relay misuse.** An unknown `speaker` is rejected with close code 1008, and the server listens on `127.0.0.1` only. Test in Task 4.

---

### Task 1: Repository, package and phrase table

**Files:**
- Create: `.gitignore`, `stt/package.json`, `stt/client/phrases.js`
- Test: `stt/test/phrases.test.js`

**Interfaces:**
- Produces: `suggestChips(text: string) -> Array<{ chip: string, type: 'moi'|'noi' }>` (unique, in table order) and `PHRASES: Array<{ chip, type, en: string[], th: string[] }>`. They are exported through the UMD wrapper below, which every `stt/client/*.js` file uses:

```js
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EMS = root.EMS || {}; Object.assign(root.EMS, api); }
})(typeof window !== 'undefined' ? window : globalThis, function (root) { /* … */ return { /* api */ }; });
```

- [ ] **Step 1: Initialise git and branch**

```bash
git init -b main
git add -A
git commit -m "chore: snapshot RETINA before live speech-to-text" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git switch -c feat/live-stt
```

Expected: one commit on `main`, then `Switched to a new branch 'feat/live-stt'`.

- [ ] **Step 2: Create `.gitignore` and `stt/package.json`**

`.gitignore` contains `node_modules/`, `.superpowers/`, `ds/`, `stt/.env`, `*-key.json` and `credentials*.json`. `stt/package.json` is `{"name":"retina-stt","private":true,"type":"commonjs","engines":{"node":">=20"},"scripts":{"test":"node --test","start":"node src/main.js"}}`. Then run `cd stt && npm install ws @google-cloud/speech`.
Expected: `node -e "console.log(typeof require('@google-cloud/speech').v2.SpeechClient)"` prints `function`.

- [ ] **Step 3: Write the failing tests** in `stt/test/phrases.test.js` (`node:test` and `node:assert/strict`):

```js
const { suggestChips } = require('../client/phrases');
const chips = t => suggestChips(t).map(c => c.chip);
test('english EM-104 lines', () => {
  assert.deepEqual(chips('Motorcycle hit a pole.'), ['Motorcycle vs pole']);
  assert.deepEqual(chips('The victim is unconscious and not breathing.'), ['Unconscious', 'Not breathing']);
  assert.deepEqual(chips('He is about thirty. No helmet.'), ['No helmet']);
  assert.deepEqual(chips('There is a lot of bleeding from his head.'), ['Head bleeding']);
});
test('thai maps to the same english chips', () => {
  assert.deepEqual(chips('มอเตอร์ไซค์ชนเสาค่ะ'), ['Motorcycle vs pole']);
  assert.deepEqual(chips('คนเจ็บหมดสติ ไม่หายใจ'), ['Unconscious', 'Not breathing']);
});
test('thai with spaces inserted by STT still matches', () => {
  assert.deepEqual(chips('มอเตอร์ไซค์ ชน เสา'), ['Motorcycle vs pole']);
});
test('negated phrases are not suggested', () => {
  assert.deepEqual(chips('ไม่หมดสติครับ'), []);
  assert.deepEqual(chips('He is not unconscious'), []);
});
test('case-insensitive, deduped, typed', () => {
  assert.deepEqual(suggestChips('NO HELMET, no helmet'), [{ chip: 'No helmet', type: 'moi' }]);
});
test('unknown wording gives nothing', () => { assert.deepEqual(chips('He fell down the stairs'), []); });
```

- [ ] **Step 4: Run to verify they fail**

Run: `cd stt && node --test test/phrases.test.js`
Expected: FAIL with `Cannot find module '../client/phrases'`.

- [ ] **Step 5: Implement `stt/client/phrases.js`**

`PHRASES` uses exactly these entries, in this order:

| chip | type | en | th |
|---|---|---|---|
| Motorcycle vs pole | moi | motorcycle hit a pole, motorbike hit a pole, motorcycle crashed into a pole, bike hit a pole | มอเตอร์ไซค์ชนเสา, มอไซค์ชนเสา, รถจักรยานยนต์ชนเสา |
| No helmet | moi | no helmet, not wearing a helmet, without a helmet | ไม่ใส่หมวก, ไม่สวมหมวกกันน็อก, ไม่ได้ใส่หมวกกันน็อค |
| High-energy impact | moi | high speed, very fast, flew off | ความเร็วสูง, ขับเร็วมาก, กระเด็น |
| Unconscious | noi | unconscious, not responding, passed out | หมดสติ, ไม่รู้สึกตัว, ไม่ตอบสนอง |
| Not breathing | noi | not breathing, stopped breathing | ไม่หายใจ, หยุดหายใจ |
| Head bleeding | noi | bleeding from his head, bleeding from her head, bleeding from the head, head is bleeding | เลือดออกที่หัว, เลือดออกจากศีรษะ, หัวแตก |
| Chest pain | noi | chest pain, pain in his chest, pain in her chest | เจ็บหน้าอก, แน่นหน้าอก |
| Food allergy | noi | food allergy, allergic to | แพ้อาหาร |
| Stroke signs | noi | face drooping, slurred speech | ปากเบี้ยว, พูดไม่ชัด, แขนขาอ่อนแรง |

Matching works like this:
- Normalise with NFC and lowercase.
- English phrases match on the text with whitespace collapsed to single spaces, at word boundaries.
- Thai phrases match on the text with all whitespace removed.
- A match is skipped when the text right before it ends with `ไม่` (Thai) or with `not ` or `no longer ` (English).

- [ ] **Step 6: Run to verify they pass**

Run: `cd stt && node --test test/phrases.test.js`
Expected: PASS, 6/6.

- [ ] **Step 7: Commit**

```bash
git add .gitignore stt/package.json stt/package-lock.json stt/client/phrases.js stt/test/phrases.test.js
git commit -m "feat(stt): phrase table mapping Thai/English to fixed English chips" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: PCM conversion and microphone capture

**Files:**
- Create: `stt/client/pcm.js`, `stt/client/worklet.js`, `stt/client/mic.js`
- Test: `stt/test/pcm.test.js`

**Interfaces:**
- Produces: `toPcm16k(input: Float32Array, inRate: number) -> Int16Array`.
- Produces: `listMics() -> Promise<Array<{deviceId, label}>>` and `openMic(deviceId, workletSrc) -> Promise<{ onChunk(fn: (pcm: ArrayBuffer) => void), close() }>` in `mic.js`. These are browser-only and are not unit tested.
- Produces: `worklet.js`, an AudioWorkletProcessor registered as `'retina-pcm'` that posts each Float32 block to its port.

- [ ] **Step 1: Write the failing tests** in `stt/test/pcm.test.js`:
  - `toPcm16k(new Float32Array(480), 48000).length === 160`
  - `toPcm16k(new Float32Array(441), 44100).length === 160`
  - Rate 16000 is identity: `[0, 0.5, -0.5]` → `[0, 16384, -16384]` (round `x * 32767` for positive values and `x * 32768` for negative values)
  - Values clamp: `[2, -2]` at 16000 → `[32767, -32768]`
  - 48000 → 16000 averages each group of three: `[0.3, 0.3, 0.3]` → `[Math.round(0.3 * 32767)]`
- [ ] **Step 2: Run `cd stt && node --test test/pcm.test.js`.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement `toPcm16k`** in `stt/client/pcm.js` by averaging the input samples in each output sample's window (`floor(n * 16000 / inRate)` outputs). Then write `worklet.js`. Then write `mic.js`:
  - `getUserMedia({ audio: { deviceId: { exact }, channelCount: 1, echoCancellation: false, noiseSuppression: false } })`
  - an `AudioContext`
  - the worklet loaded with `addModule(URL.createObjectURL(new Blob([workletSrc], { type: 'text/javascript' })))`
  - chunks buffered to 1600 output samples (100 ms) before `onChunk`
  - `close()` stops the tracks and closes the context
- [ ] **Step 4: Run `cd stt && node --test test/pcm.test.js`.** Expected: PASS, 5/5.
- [ ] **Step 5: Commit** `stt/client/pcm.js stt/client/worklet.js stt/client/mic.js stt/test/pcm.test.js` with the message `feat(stt): 16 kHz PCM conversion and mic capture worklet`.

### Task 3: Google Chirp 3 stream adapter and two-stream spike

**Files:**
- Create: `stt/src/google.js`, `stt/scripts/spike.js`
- Test: `stt/test/google.test.js`

**Interfaces:**
- Produces: `parseLanguages(value?: string) -> string[]`.
- Produces: `buildStreamingRequest({ project, location, languages }) -> object`.
- Produces: `mapResponse(resp) -> Array<{ kind: 'partial'|'final', text: string, lang?: string }>`.
- Produces: `createGoogleStream({ client, request, onPartial(text), onFinal(text, lang), onError(err) }) -> { write(buf: Buffer), end() }`.
- Produces: `makeClient(location) -> new v2.SpeechClient({ apiEndpoint: location + '-speech.googleapis.com' })`.

- [ ] **Step 1: Write the failing tests** in `stt/test/google.test.js`:
  - `parseLanguages(undefined)` and `parseLanguages('')` return `['auto']`. `parseLanguages(' th-TH, en-US ')` returns `['th-TH', 'en-US']`.
  - `buildStreamingRequest({ project: 'p', location: 'us', languages: ['auto'] })` deep-equals:
    `{ recognizer: 'projects/p/locations/us/recognizers/_', streamingConfig: { config: { explicitDecodingConfig: { encoding: 'LINEAR16', sampleRateHertz: 16000, audioChannelCount: 1 }, languageCodes: ['auto'], model: 'chirp_3' }, streamingFeatures: { interimResults: true } } }`
  - `mapResponse`:
    - `{}` → `[]`
    - two non-final results `'Motorcycle'` and `' hit a'` → `[{ kind: 'partial', text: 'Motorcycle hit a' }]`
    - `{ results: [{ isFinal: true, languageCode: 'th-th', alternatives: [{ transcript: 'มอเตอร์ไซค์ชนเสา' }] }] }` → `[{ kind: 'final', text: 'มอเตอร์ไซค์ชนเสา', lang: 'th-th' }]`
    - an empty transcript → `[]`
    - a final plus a partial in one response → final first, then partial
    - all texts are trimmed
  - `createGoogleStream` with a fake `client._streamingRecognize()` that returns an object-mode `PassThrough`:
    - the first object written is `request`
    - `write(Buffer.from([1, 2]))` writes `{ audio: <that buffer> }`
    - a `'data'` event with a final calls `onFinal(text, lang)`
    - an `'error'` event calls `onError`
    - `end()` ends the stream
- [ ] **Step 2: Run `cd stt && node --test test/google.test.js`.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement `stt/src/google.js`.** Use the v2 client's raw bidirectional stream `client._streamingRecognize()`. Write `request` first, then `{ audio }` for each chunk.
- [ ] **Step 4: Run `cd stt && node --test test/google.test.js`.** Expected: PASS.
- [ ] **Step 5: Write `stt/scripts/spike.js`**, run as `node scripts/spike.js <a.wav> <b.wav>`:
  - Read each WAV. Exit 1 with `need 16 kHz mono 16-bit WAV` unless the header is 16000 Hz, 1 channel, 16-bit.
  - Open two `createGoogleStream`s at the same time with `makeClient(STT_LOCATION || 'us')`, `parseLanguages(process.env.STT_LANGUAGES)` and `GOOGLE_CLOUD_PROJECT`.
  - Feed 3200-byte chunks every 100 ms.
  - Print `[A] partial: …` and `[A] final (lang): …`, with `[B]` for the second file.
- [ ] **Step 6: Commit** `stt/src/google.js stt/scripts/spike.js stt/test/google.test.js` with the message `feat(stt): Google Chirp 3 streaming adapter and two-stream spike`.
- [ ] **Step 7 (human checkpoint): ask the user to run the spike.** It needs their Google credentials and two recordings, one Thai and one English, of the EM-104 caller lines. Recordings can be converted with `ffmpeg -i in.m4a -ar 16000 -ac 1 -c:a pcm_s16le th.wav`. Then they run:
  `cd stt; $env:GOOGLE_CLOUD_PROJECT='<project>'; node scripts/spike.js th.wav en.wav`
  Expected: both streams print finals, with lang `th-th` and `en-us`.
  - If `auto` is rejected in streaming, rerun with `$env:STT_LANGUAGES='th-TH,en-US'`.
  - Write the result in the ledger as `Spike: <auto works | needs th-TH,en-US>`.
  - Tasks 4–7 use fakes and do not wait for this. Task 8 needs it.

### Task 4: Relay server

**Files:**
- Create: `stt/src/server.js`, `stt/src/main.js`
- Test: `stt/test/server.test.js`

**Interfaces:**
- Consumes: `createGoogleStream`, `buildStreamingRequest`, `parseLanguages` and `makeClient` (Task 3).
- Produces: `createServer({ openStream: ({ speaker, onPartial, onFinal, onError }) => { write, end }, harnessPath: string }) -> http.Server`.
- The WebSocket protocol on path `/stt?speaker=Operator|Caller`:
  - Client → server: binary PCM16 16 kHz mono chunks, or the text `stop`.
  - Server → client: `{"type":"ready","speaker"}`, `{"type":"partial","speaker","text"}`, `{"type":"final","speaker","text","lang"}` and `{"type":"error","message"}`. An error is followed by close code 1011.
  - `GET /` serves `harnessPath` as `text/html; charset=utf-8`. Any other path returns 404.

- [ ] **Step 1: Write the failing tests** in `stt/test/server.test.js`. Each test starts `createServer` with a fake `openStream` on port 0 (`127.0.0.1`) and connects with the `ws` client.
  - `/stt?speaker=Caller` receives `ready`. A binary frame reaches the fake's `write` as the same bytes.
  - The fake's `onPartial('มอเตอร์')` arrives as a `partial` message with `speaker: 'Caller'`, and `onFinal('Motorcycle hit a pole.', 'en-us')` arrives as a `final` message.
  - The fake's `onError(new Error('quota'))` sends `{type:'error',message:'quota'}`, then the socket closes with 1011.
  - The client closing the socket, or sending `stop`, calls the fake's `end` exactly once.
  - `/stt?speaker=Boss` closes with 1008 and never calls `openStream`.
  - `server.address().address === '127.0.0.1'` after `listen(0, '127.0.0.1')`.
  - `GET /` returns status 200, the harness bytes and an HTML content type. `GET /x` returns 404.
- [ ] **Step 2: Run `cd stt && node --test test/server.test.js`.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement `stt/src/server.js`** with `http` and `ws`'s `WebSocketServer({ noServer: true })`, upgrading on the `/stt` path.
- [ ] **Step 4: Implement `stt/src/main.js`.**
  - Read `GOOGLE_CLOUD_PROJECT`. If it is missing, exit 1 with `Set GOOGLE_CLOUD_PROJECT`.
  - Read `STT_LOCATION` (default `us`), `STT_LANGUAGES` and `STT_PORT` (default 8787).
  - Build one `makeClient` and pass `openStream` to `createServer` with `harnessPath = path.join(__dirname, '../../preview-harness.html')`.
  - Listen on `127.0.0.1` and log `RETINA STT relay on http://localhost:<port>/#Intake`.
- [ ] **Step 5: Run `cd stt && npm test`.** Expected: all test files PASS.
- [ ] **Step 6: Commit** `stt/src/server.js stt/src/main.js stt/test/server.test.js` with the message `feat(stt): localhost WebSocket relay, one Google stream per microphone`.

### Task 5: Transcript source with Live → Replay fallback

**Files:**
- Create: `stt/client/transcript-source.js`
- Test: `stt/test/transcript-source.test.js`

**Interfaces:**
- Consumes: `suggestChips` (Task 1). In Node it uses `require('./phrases')`; in the browser it uses `root.EMS.suggestChips`. It also consumes the protocol from Task 4.
- Produces the type `Line = { id: string, time: 'HH:MM:SS', speaker: 'Operator'|'Caller', text: string, partial: boolean, chips: Array<{chip,type}>, removed?: true }`. `chips` is always `[]` on partial lines.
- Produces: `createTranscriptSource({ mode: 'live'|'replay', replayLines: Array<[time, speaker, text]>, relayUrl: string, micLabels?, env }) -> { on(event: 'line'|'mode', fn), start(), stop() }`. Here `env = { WebSocket, listMics, openMic, workletSrc, now: () => Date, setTimeout, clearTimeout }`. `mode` is emitted once at start (`'live'`, or `'replay'`) and once more on fallback.
- Produces: `upsertLine(lines: Line[], line: Line) -> Line[]`. It replaces by `id`, removes on `removed`, and appends otherwise.
- Produces: `chipsFor(lines: Line[], type: 'moi'|'noi'|null) -> string[]`, with unique chips from non-partial lines whose type matches. `null` gives `[]`.
- Produces: `sttMode(loc: {hostname, port, search}) -> 'live'|'replay'` and `relayUrlFor(loc) -> string`. The URL is `ws://<host>/stt` when the page is served by the relay, and `ws://localhost:8787/stt` otherwise.
- Line ids: in Live they are `<speaker>-<n>`. Every partial of one utterance and its final share an id, and `n` goes up after each final. In Replay they are `replay-<i>`.

- [ ] **Step 1: Write the failing tests.** Use a fake `WebSocket` class whose instances record `send` and expose `emitOpen`, `emitMessage(obj)` and `emitClose()`, fake mics, and fake timers driven by hand.
  - **Replay:** `mode:'replay'` with the 8 EM-104 lines emits `mode` `'replay'`. Line 0 arrives at once and line 1 after 1500 ms. The `'Motorcycle hit a pole.'` line has chips `[{chip:'Motorcycle vs pole',type:'moi'}]`.
  - **Live happy path:** two mics give two sockets, with `?speaker=Operator` and `?speaker=Caller` appended to `relayUrl`. When both send `ready`, `mode` is `'live'`. Two partials and then a final from Caller give three `line` events with the same id `Caller-0`. The first two have `partial: true` and `chips: []`, and the last has `partial: false` and its chips. A mic chunk is sent on its speaker's socket.
  - **Fallback at start:** each of these reaches `mode: 'replay'` and starts the replay lines:
    - no `ready` within 3000 ms
    - `listMics` resolves one mic
    - `openMic` rejects
  - **Fallback mid-call:** after a final and a pending partial on Caller, `emitClose()` on Caller emits `{id:'Caller-1', removed:true}`, then `mode: 'replay'`. Both mics are closed, both sockets are closed, and the final line is never re-emitted.
  - **micLabels:** `micLabels: { Operator: 'Headset', Caller: 'USB' }` picks the devices by label substring, whatever their order.
  - **Helpers:**
    - `upsertLine` covers replace, append and remove.
    - `chipsFor` ignores partials, filters by type and returns `[]` for `null`.
    - `sttMode({hostname:'localhost',port:'8787',search:''})` is `'live'`, `sttMode({hostname:'claude.ai',port:'',search:'?stt=live'})` is `'live'`, and `sttMode({hostname:'claude.ai',port:'',search:''})` is `'replay'`.
    - `relayUrlFor({host:'127.0.0.1:8787',hostname:'127.0.0.1',port:'8787'})` is `ws://127.0.0.1:8787/stt`.
  - **stop():** clears timers and closes the sockets and mics.
- [ ] **Step 2: Run `cd stt && node --test test/transcript-source.test.js`.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement `stt/client/transcript-source.js`** in the UMD wrapper. Live times use `env.now()` formatted with `en-GB` `HH:MM:SS`.
- [ ] **Step 4: Run `cd stt && npm test`.** Expected: all PASS.
- [ ] **Step 5: Commit** `stt/client/transcript-source.js stt/test/transcript-source.test.js` with the message `feat(stt): transcript source with live streams and replay fallback`.

### Task 6: Design System bundle: partial line, Live/Replay badge, Intake wiring

**Files:**
- Create: `scripts/inject-stt-client.py`, `scripts/test_inject_stt_client.py`, `stt/test/bundle.test.js`
- Modify (artifact working copy under the git-ignored `ds/`): `ds/project/components/bundle.js` (the `TranscriptLine` function, the `api` object, `Intake()`), `ds/project/components/bundle.css` (the TranscriptLine block)
- Regenerate: `preview-harness.html`

**Interfaces:**
- Consumes: everything in `stt/client/` (Tasks 1, 2, 5).
- Produces: `inject-stt-client.py <bundle.js> <stt/client dir>`. It places `phrases.js`, `pcm.js`, `transcript-source.js` and `mic.js`, followed by `window.EMS.STT_WORKLET_SRC = <worklet.js as a JSON string>;`, between the line `/* ---- STT client: generated by scripts/inject-stt-client.py from stt/client, do not hand-edit ---- */` and the line `/* ---- end STT client ---- */`. On the first run it inserts the block right before the line that starts with `/* ---- Screens:`. On later runs it replaces the block.
- Produces: `EMS.TranscriptLine` gains the prop `partial: boolean`. It also gains `EMS.TranscriptBadge({ mode: 'live'|'replay' })`.

- [ ] **Step 1: Get the working copy.** Use the Artifact tool's `read` with `url` `https://claude.ai/artifact/U2YowM3zMU6B6UbQyPC5Ca`, `paths` `["project/components/bundle.js", "project/components/bundle.css", "project/tokens.json"]` and `out_dir` `ds`.
  Expected: the three files exist under `ds/project/`.
- [ ] **Step 2: Write the failing Python tests** in `scripts/test_inject_stt_client.py` (`unittest`, temp dirs):
  - the block is inserted once, right before `/* ---- Screens:`
  - a second run leaves the file byte-identical
  - the worklet appears as a JSON string assigned to `window.EMS.STT_WORKLET_SRC`
  - a bundle without the Screens marker exits 1 and leaves the file unchanged
- [ ] **Step 3: Run `python -m unittest scripts/test_inject_stt_client.py`.** Expected: FAIL, the script is missing.
- [ ] **Step 4: Implement `scripts/inject-stt-client.py`.** Run `python -m unittest scripts/test_inject_stt_client.py`. Expected: PASS.
- [ ] **Step 5: Write the failing `stt/test/bundle.test.js`.**
  - Load `process.env.EMS_DS_DIR || '../ds'` + `/project/components/bundle.js` in `vm`. The context has a `window`, and a stub `React` whose `createElement` returns `{ type, props, children }` and whose hooks throw.
  - `EMS.TranscriptLine({ time:'14:20:02', speaker:'Caller', text:'Motorcycle hit', partial:true, keywords:['CPR'] })` → the root className contains `ems-tline-partial`, there is no copy `Button` child and the text child is the plain string.
  - `EMS.TranscriptBadge({ mode:'live' })` → a StatusPill element with `tone:'live'` and child `'Live'`. `{ mode:'replay' }` → `tone:'neutral'` and `'Replay'`.
  - `EMS.createTranscriptSource`, `EMS.suggestChips`, `EMS.chipsFor` and `EMS.sttMode` are functions, and `EMS.STT_WORKLET_SRC` contains `registerProcessor('retina-pcm'`.
- [ ] **Step 6: Run `cd stt && node --test test/bundle.test.js`.** Expected: FAIL, because `ems-tline-partial` and `TranscriptBadge` are missing.
- [ ] **Step 7: Edit `ds/project/components/bundle.js`.**
  - **TranscriptLine:** when `p.partial` is set, add the class `ems-tline-partial` and `aria-busy: true`, skip `highlight` and `critical`, and render `h('span')` instead of the copy button.
  - **TranscriptBadge:** add `function TranscriptBadge(p)`, which returns `StatusPill` with `tone: p.mode === 'live' ? 'live' : 'neutral'`, a `title` of `Live speech-to-text` or `Scripted replay of the EM-104 call`, and the child `Live` or `Replay`. Add it to `api`.
  - **Intake:**
    - Keep the current `lines` array as `REPLAY_LINES`, outside the component.
    - Add the state `tl` (Line[]) and `mode`. Key `copied` by line `id`.
    - Add a `useEffect([])` that calls `E.createTranscriptSource({ mode: E.sttMode(location), replayLines: REPLAY_LINES, relayUrl: E.relayUrlFor(location), micLabels: (window.RETINA_STT || {}).micLabels, env: { WebSocket, listMics: E.listMics, openMic: E.openMic, workletSrc: E.STT_WORKLET_SRC, now: function () { return new Date(); }, setTimeout: setTimeout.bind(window), clearTimeout: clearTimeout.bind(window) } })`, wires `line` to `upsertLine` and `mode` to the state, starts it, and returns `stop`.
    - Render `tl` with `partial` passed through.
    - The transcript Card `actions` become `[TranscriptBadge, Waveform]`.
    - ChipInput `suggestions` becomes `E.chipsFor(tl[0], type[0])`. Delete `TYPE_SUGGEST`.
- [ ] **Step 8: Edit `ds/project/components/bundle.css`.** Add `.ems-tline-partial .ems-tline-text { color: var(--text-muted); }` after the `.ems-tline-text` rule.
- [ ] **Step 9: Inject the client and run the tests.** Run `python scripts/inject-stt-client.py ds/project/components/bundle.js stt/client`, then `cd stt && npm test`.
  Expected: all PASS, including `bundle.test.js`.
- [ ] **Step 10: Rebuild the harness and check it in the browser.**
  - Run `python scripts/build-preview-harness.py ds preview-harness.html`.
  - Open `preview-harness.html#Intake` in the Browser pane.
  - Expected:
    - The badge reads `Replay`, and the 8 lines arrive about 1.5 s apart.
    - After `Mechanism of Injury` is picked, the dashed chips `Motorcycle vs pole` and `No helmet` appear under "AI suggests".
    - With `Nature of Illness` picked, `Unconscious`, `Not breathing` and `Head bleeding` appear instead.
    - The console shows no errors.
  - Also check `#Dispatch`, `#Copilot`, `#Traffic` and `#Hospital` still render.
- [ ] **Step 11: Commit** `scripts/inject-stt-client.py scripts/test_inject_stt_client.py stt/test/bundle.test.js preview-harness.html` with the message `feat(ds): partial transcript line, Live/Replay badge, Intake on transcript source`.
- [ ] **Step 12 (ask first): republish the artifact.** Ask the user before republishing. After a yes, publish with `url` `https://claude.ai/artifact/U2YowM3zMU6B6UbQyPC5Ca` and `files` `{ "project/components/bundle.js": "ds/project/components/bundle.js", "project/components/bundle.css": "ds/project/components/bundle.css" }`, then read the Intake page back.
  Expected: Replay badge, with no console errors.

### Task 7: Figma: partial TranscriptLine and Live/Replay badge

**Files:** Figma file `oLhd7VqtFiFiZOvJe73JPk` (components page, plus Intake frame `8:166`).

**Interfaces:**
- Consumes: the visual rules from Task 6. Partial text uses `color/text/muted`. The badge is the live StatusPill or the neutral StatusPill.

- [ ] **Step 1:** Load the `figma-use` skill. Call `create_session` with key `oLhd7VqtFiFiZOvJe73JPk`. Use `get_metadata` on the components page to find the `TranscriptLine` component and the `StatusPill` set.
  The memory note says this is a Starter plan with a monthly call cap, so do Steps 2–3 in at most two `use_figma` calls.
- [ ] **Step 2:** Make `TranscriptLine` a component set with the property `State=default|partial`. In the `partial` variant, the text fill is bound to `color/text/muted`, there are no keyword marks and the copy button is hidden. Create a `TranscriptBadge` component set with `Mode=live|replay`, built from StatusPill instances (tone live with label `Live`, and tone neutral with label `Replay`). Re-apply hug sizing after any `resize()`, as the CLAUDE.md gotchas say.
- [ ] **Step 3:** In frame `8:166`, put a `TranscriptBadge Mode=replay` before the waveform in the "Live Voice Transcript Log" header. Switch the last Caller line instance to `State=partial` to show the state.
- [ ] **Step 4:** Run `get_screenshot` on `8:166`.
  Expected: the badge sits in the header, the last line is grey and nothing else has moved.

### Task 8: Documentation and live end-to-end check

**Files:**
- Modify: `CLAUDE.md` (add a "Live speech-to-text" section after "preview-harness.html"), `docs/adr/0002-live-speech-to-text-with-google-chirp-3.md` (add an "Implementation notes" section)

- [ ] **Step 1: Add the "Live speech-to-text" section to `CLAUDE.md`.** It covers:
  - the env vars (`GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `STT_LOCATION`, `STT_LANGUAGES`, `STT_PORT`)
  - `cd stt; npm install; npm start`, then opening `http://localhost:8787/#Intake`
  - the mic mapping and `window.RETINA_STT.micLabels`
  - when Live is attempted
  - the injector: rerun `scripts/inject-stt-client.py` after any `stt/client` change, then rebuild the harness
  - `cd stt; npm test`
- [ ] **Step 2: Add "Implementation notes" to ADR 0002.** It records the spike result from the ledger and the decisions list from the top of this plan.
- [ ] **Step 3 (human): live check with the user's credentials and two mics.** Start the relay and open `http://localhost:8787/#Intake`.
  Expected:
  - The badge shows `Live`.
  - Speaking Thai into the Caller mic shows a grey line that turns black when finished, labelled `Caller`.
  - Saying `มอเตอร์ไซค์ชนเสา` and picking Mechanism of Injury offers the dashed `Motorcycle vs pole`, which is added only on tap.
  - Stopping the relay (Ctrl+C) turns the badge to `Replay` within 3 s, the earlier lines stay, and the replay lines follow.
- [ ] **Step 4: Run `cd stt && npm test` and `python -m unittest scripts/test_inject_stt_client.py`.** Expected: all PASS.
- [ ] **Step 5: Commit** `CLAUDE.md docs/adr/0002-live-speech-to-text-with-google-chirp-3.md` with the message `docs: how to run live speech-to-text at Intake`.
