# Intake Form Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a call runs, the Intake form offers dashed, one-click suggestions for six slow-to-type fields. The relay fills them from the transcript with Claude Haiku 5.5, and keeps only values backed by words actually said on the call.

**Architecture:**
- The page sends finished transcript lines to a new `POST /suggest` route on the existing relay.
- The relay asks Claude Haiku 5.5 for a fixed JSON shape (structured outputs) and drops any value whose quote isn't in the cited line.
- A browser suggestion source handles timing (800 ms debounce, one request in flight, newest wins).
- A pure per-field reducer decides when a suggestion shows.
- `Field` gains a `suggestion` prop, and Intake holds the six fields as controlled state.

**Tech Stack:** Node ≥ 20 (`node:test`), `@anthropic-ai/sdk` ^1.8.0, `ws`, browser UMD modules injected into the Design System `bundle.js` (React 18 UMD, no JSX), Python build scripts, Figma MCP.

**Spec:** `docs/superpowers/specs/2026-11-13-intake-form-suggestions-design.md` (read it with this plan; ADR 0002 and `CLAUDE.md` "Live speech-to-text" give the existing relay).

## Global Constraints

- Model `claude-haiku-5-5` by default; `SUGGEST_MODEL` in `.env` overrides it. Key `ANTHROPIC_API_KEY`, read only by the relay. It is never sent to the page and never logged.
- Request: `client.messages.create` with `max_tokens: 2048`, `output_config: { effort: 'low', format: { type: 'json_schema', schema } }`. No `thinking`, `temperature`, `top_p`, `top_k` or assistant prefill (Haiku 5.5 rejects sampling params and prefill). Client options: `timeout: 10000`, `maxRetries: 0`.
- Read the answer from the content block with `type === 'text'`, never `content[0]`. `stop_reason` other than `end_turn` counts as a failure.
- Errors: use the SDK's typed classes (`Anthropic.APIError` and subclasses); log the class name and status only, never the request body.
- The six field keys, in this order everywhere: `callerName`, `contactNumber`, `patient`, `underlyingDisease`, `symptoms`, `address`.
- Suggestions come only from finished lines (`partial: false`). Case Type, keyword chips, the Critical Keywords box and Confirm Location are untouched.
- The relay stays on `127.0.0.1` and applies the existing `allowedOrigin` rule to `POST /suggest`.
- No field is ever written without Use or Tab. A suggestion never changes what the call taker typed.
- Copy: Use button `Use`, time label `heard HH:MM:SS`, after a change `Updated · heard HH:MM:SS`, header note `Suggestions off`.
- Contact number for EM-104 is the fake `081-234-5678`.
- Don't hand-edit `preview-harness.html`; rebuild it. After any change in `stt/client/`, re-run `scripts/inject-stt-client.py`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push without the user's yes.

## Review Focus

1. **Phone number spoken as words** ("oh eight one, two three four…"): there's no digit match, so no Contact Number suggestion. A wrong one must never appear. *(Task 1 test)*
2. **A long call** (10+ minutes, hundreds of lines): suggestions keep working. The page sends at most the last 200 finished lines. *(Task 3 test)*
3. **The call taker is typing when a suggestion arrives:** the field's value and caret stay put. The suggestion appears beside the field, not in it. *(Task 4 test)*
4. **Anthropic is slow (> 10 s) while lines keep arriving:** there is still only one request in flight. The slow one times out, one fresh request follows, and the form never blocks. *(Task 3 test)*
5. **Junk sent to `/suggest`** (non-JSON, wrong shape, body > 256 KB, a foreign Origin): the relay answers 400/413/403 without calling Anthropic and without crashing. *(Task 2 test)*

---

### Task 1: Relay suggester (prompt, schema, checks)

**Files:**
- Create: `stt/src/suggest.js`
- Modify: `stt/src/config.js` (add `suggestModel`), `stt/package.json` (dependency `"@anthropic-ai/sdk": "^1.8.0"`, then `npm install`)
- Test: `stt/test/suggest.test.js`, `stt/test/config.test.js`

**Interfaces:**
- Produces:
  - `FIELDS: string[]`, the six keys above.
  - `buildSuggestRequest({ model: string, lines: Line[] }) -> object`: the params for `messages.create`. `Line = { id, time, speaker, text }`, all strings.
  - `checkFields(raw: object|null, lines: Line[]) -> { [key]: { value, quote, lineId } }`: only the fields that pass.
  - `createSuggester({ client, model, log? }) -> { suggest(lines) -> Promise<{ ok: true, fields } | { ok: false, reason: string }> }`.
  - `config.suggestModel(env) -> string`: `env.SUGGEST_MODEL` trimmed, else `'claude-haiku-5-5'`.

- [ ] **Step 1: Write the failing tests** in `stt/test/suggest.test.js`. Use a fake client `{ messages: { create: async (params) => response } }` that records `params`.

```js
const LINES = [
  { id: 'replay-1', time: '14:19:55', speaker: 'Caller', text: 'There is an accident in front of Building A, Soi Lat Phrao 1.' },
  { id: 'replay-7', time: '14:20:30', speaker: 'Caller', text: 'He is about thirty. No helmet.' },
  { id: 'replay-9', time: '14:20:37', speaker: 'Caller', text: 'Somchai Jaidee. My number is 081 234 5678.' }
];
test('request: haiku, low effort, json_schema with all six keys required and nullable', () => {
  const p = buildSuggestRequest({ model: 'claude-haiku-5-5', lines: LINES });
  assert.equal(p.model, 'claude-haiku-5-5');
  assert.equal(p.max_tokens, 2048);
  assert.equal(p.output_config.effort, 'low');
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.deepEqual(p.output_config.format.schema.required, FIELDS);
  assert.equal(p.output_config.format.schema.additionalProperties, false);
  for (const k of ['thinking', 'temperature', 'top_p', 'top_k']) assert.equal(k in p, false, k);
  assert.equal(p.messages.at(-1).role, 'user');
  assert.match(p.messages[0].content, /\[replay-9\] 14:20:37 Caller: Somchai Jaidee\. My number is 081 234 5678\./);
});
test('checkFields keeps a value whose quote is in its line (case, spacing, punctuation ignored)', () => {
  const f = checkFields({ callerName: { value: 'Somchai Jaidee', quote: 'somchai  jaidee', lineId: 'replay-9' } }, LINES);
  assert.deepEqual(f.callerName, { value: 'Somchai Jaidee', quote: 'somchai  jaidee', lineId: 'replay-9' });
});
test('checkFields drops a made-up quote, an unknown lineId, a quote from another line, and nulls', () => {
  const f = checkFields({
    callerName: { value: 'Somchai', quote: 'my name is Somchai', lineId: 'replay-9' },
    address: { value: 'Soi Lat Phrao 1', quote: 'Soi Lat Phrao 1', lineId: 'replay-404' },
    patient: { value: 'Male, about 30', quote: 'He is about thirty', lineId: 'replay-1' },
    symptoms: null
  }, LINES);
  assert.deepEqual(f, {});
});
test('contact number: digits in the value must equal the digits in the quote', () => {
  const ok = checkFields({ contactNumber: { value: '081-234-5678', quote: '081 234 5678', lineId: 'replay-9' } }, LINES);
  assert.equal(ok.contactNumber.value, '081-234-5678');
  const bad = checkFields({ contactNumber: { value: '081-234-5679', quote: '081 234 5678', lineId: 'replay-9' } }, LINES);
  assert.deepEqual(bad, {});
});
test('contact number spoken as words is dropped, never guessed (Review Focus 1)', () => {
  const lines = [{ id: 'L1', time: '14:20:37', speaker: 'Caller', text: 'It is oh eight one two three four five six seven eight.' }];
  assert.deepEqual(checkFields({ contactNumber: { value: '081-234-5678', quote: 'oh eight one two three four five six seven eight', lineId: 'L1' } }, lines), {});
});
test('suggest: parses the text block (after any thinking block) and checks it', async () => { /* fake response content: [{type:'thinking',thinking:''},{type:'text',text: JSON.stringify({...six keys, address valid, others null})}], stop_reason 'end_turn' → { ok: true, fields: { address } } */ });
test('suggest: refusal, max_tokens, bad JSON and a thrown Anthropic.APIError become { ok: false } with a short reason', async () => { /* four fakes; assert ok false; assert log never received the transcript text */ });
```

In `stt/test/config.test.js`, add `suggestModel`: `{}` gives `'claude-haiku-5-5'`, and `{ SUGGEST_MODEL: ' claude-sonnet-5-5 ' }` gives `'claude-sonnet-5-5'`.

- [ ] **Step 2: Run the tests to see them fail.** Run `cd stt && npm test`. Expected: FAIL, `Cannot find module '../src/suggest'` and `suggestModel is not a function`.

- [ ] **Step 3: Implement `stt/src/suggest.js` and `config.suggestModel`.**
  - **Schema.** Each of the six keys is `anyOf: [{ type: 'object', properties: { value, quote, lineId } (all `type: 'string'`), required: ['value','quote','lineId'], additionalProperties: false }, { type: 'null' }]`. Write a `description` on each key, within the spec's rules.
  - **System prompt.** Facts said on the call only. English. Short. Contact Number as digits with dashes. Patient as sex and age ("Male, about 30"), where a pronoun counts as the sex. U / D is a condition the caller named, or "Unknown" when the caller says they don't know. Symptoms is a factual one- or two-sentence summary with no diagnosis and no triage words. `quote` is copied exactly from the single line named in `lineId`. A field the call hasn't covered is `null`.
  - **User message.** One line per transcript line: `[id] time Speaker: text`.
  - **Normalisation for the quote check.** Lower-case, drop `.,!?;:'"`, collapse whitespace. A quote passes when its normalised form is a substring of the normalised text of the line with that `lineId`.
  - **Digit check.** Applies to `contactNumber` only: `value.replace(/\D/g,'') === quote.replace(/\D/g,'')`, and that string has at least 6 digits.
  - **`suggest()`.** It catches everything and never throws.

- [ ] **Step 4: Run the tests to see them pass.** Run `cd stt && npm test`. Expected: all pass, with 84 earlier tests plus the new ones.

- [ ] **Step 5: Commit.**

```bash
git add stt/src/suggest.js stt/src/config.js stt/test/suggest.test.js stt/test/config.test.js stt/package.json stt/package-lock.json
git commit -m "feat(suggest): relay asks Claude Haiku for Intake fields and keeps only quoted values"
```

### Task 2: `POST /suggest` on the relay, startup wiring, spike

**Files:**
- Modify: `stt/src/server.js`, `stt/src/main.js`
- Create: `stt/scripts/suggest-spike.js`
- Test: `stt/test/server.test.js`

**Interfaces:**
- Consumes: `createSuggester(...).suggest(lines)` (Task 1).
- Produces:
  - `createServer({ openStream, harnessPath, suggest })`. `suggest` is `(lines) => Promise<{ok, fields?, reason?}>`, or `null` when there's no key.
  - The HTTP contract the page uses:
    - `POST /suggest`, body `{ lines: Line[] }`.
    - Success: `200 { fields }`.
    - No key: `503 { off: true }`.
    - Anthropic failed: `502 { error: reason }`.
    - Bad input: `400`.
    - Body over 262144 bytes: `413`.
    - Foreign Origin: `403`.

- [ ] **Step 1: Write the failing tests** in `server.test.js`, using a fake `suggest` that records calls:
  - `'POST /suggest returns the checked fields'`: 200 with `{ fields: { address: {...} } }`, and `suggest` was called with the posted lines.
  - `'POST /suggest without a key answers 503 {off:true}'`: `createServer({ ..., suggest: null })`.
  - `'POST /suggest passes an Anthropic failure on as 502'`: fake returns `{ ok: false, reason: 'timeout' }`, so the response is 502 `{ error: 'timeout' }`.
  - `'POST /suggest rejects junk without calling suggest (Review Focus 5)'`, each case giving the stated code and `suggest` never called:
    - non-JSON gives 400
    - `{lines: 'x'}` gives 400
    - a line missing `text` gives 400
    - more than 400 lines gives 400
    - 300 KB body gives 413
    - `Origin: http://evil.example` gives 403
  - `'GET /suggest is 404 and the WebSocket path still works'`.

- [ ] **Step 2: Run the tests to see them fail.** Run `cd stt && npm test`. Expected: FAIL with 404 on `POST /suggest`.

- [ ] **Step 3: Implement the route in `server.js`.** Read the body with a running byte count and stop at 262144. Validate the shape, then `await suggest(lines)`. Answer with `content-type: application/json`. Reuse `allowedOrigin(req.headers.origin, req.headers.host)`.

- [ ] **Step 4: Wire `main.js`.**
  - If `ANTHROPIC_API_KEY` is set, build `new Anthropic({ timeout: 10000, maxRetries: 0 })` and `createSuggester({ client, model: suggestModel(), log: console.error })`, then pass its `suggest`. Otherwise pass `null`.
  - Log one startup line, without the key: `suggestions: on (claude-haiku-5-5)` or `suggestions: off (no ANTHROPIC_API_KEY)`.
  - Google stays required, as today.

- [ ] **Step 5: Write `stt/scripts/suggest-spike.js`.** It loads `.env` like `spike.js`, sends the 12 EM-104 replay lines (its own copy: the 8 lines of `REPLAY_LINES` in `ds/project/components/bundle.js` plus the spec's 4 new ones, ids `replay-0`…`replay-11`) through `createSuggester`, and prints each kept field with its quote, plus the dropped count. With no key, it exits with a clear message.

- [ ] **Step 6: Run the tests to see them pass.** Run `cd stt && npm test`. Expected: all pass.

- [ ] **Step 7: Commit.**

```bash
git add stt/src/server.js stt/src/main.js stt/scripts/suggest-spike.js stt/test/server.test.js
git commit -m "feat(suggest): POST /suggest on the relay; suggestions on/off at startup; spike script"
```

### Task 3: Browser suggestion source and per-field reducer

**Files:**
- Create: `stt/client/suggest-source.js` (UMD, same wrapper as `transcript-source.js`)
- Modify: `stt/client/transcript-source.js` (export `suggestUrlFor`), `scripts/inject-stt-client.py` (`FILES` gets `'suggest-source.js'` after `'transcript-source.js'`), `scripts/test_inject_stt_client.py`
- Test: `stt/test/suggest-source.test.js`, `stt/test/transcript-source.test.js`

**Interfaces:**
- Consumes: the HTTP contract from Task 2.
- Produces (all on `window.EMS` once injected):
  - `suggestUrlFor(loc) -> string|null`: `'http://' + loc.host + '/suggest'` when served by the relay, else `null`.
  - `createSuggestSource({ url, env: { fetch, setTimeout, clearTimeout } }) -> { on(ev, fn), update(lines), stop() }`.
    - Events: `'fields'` with the `fields` object, and `'status'` with `'on' | 'off'`.
    - `update` takes the whole transcript array, partials included, and filters it.
  - `suggestionStep(st, ev) -> st`. Field state is `{ shown: string|null, visible: boolean, updated: boolean, heardAt: string }`, and the initial state is `{ shown: null, visible: false, updated: false, heardAt: '' }`. Events:
    - `{ type: 'incoming', value, heardAt, fieldValue }`
    - `{ type: 'use' }`
    - `{ type: 'type' }`
    - `{ type: 'dismiss' }`

- [ ] **Step 1: Write the failing tests** (hand-driven clock and fake `fetch`, like `makeEnv` in `transcript-source.test.js`).
  - `'waits 800 ms after the last finished line, then posts all finished lines'`: partials aren't sent. Two updates 500 ms apart give one POST at 1300 ms.
  - `'one request in flight; lines that arrive meanwhile give exactly one follow-up'`.
  - `'newest wins: a late response to an older request is ignored'`.
  - `'sends at most the last 200 finished lines (Review Focus 2)'`: 450 lines in, so the body has 200 and the last id is the last line's.
  - `'503 turns suggestions off for good: status off, no more requests'`.
  - `'502 or a network error: status off, the next update still tries; a 200 sets status on again'`.
  - `'a request that never answers is abandoned after 12 s, and the next one goes out (Review Focus 4)'`: the fake `fetch` never resolves, and `env.setTimeout` fires the 12000 ms guard.
  - `'stop() clears timers and ignores later responses'`.
  - `suggestionStep`:
    - First incoming on an empty field gives `visible: true, updated: false`.
    - The same value again gives no change.
    - `use` or `type` gives `visible: false`.
    - A different value while `fieldValue` is non-empty gives `visible: true, updated: true`.
    - `dismiss`, then the same value, stays hidden. A different value shows again.
    - Incoming equal to `fieldValue` gives `visible: false`.
  - `suggestUrlFor`: `localhost:8788` gives `'http://localhost:8788/suggest'`. A `claude.ai` page or a disk page (empty hostname) gives `null`.
  - The Python inject test checks that `/*ss*/` (suggest-source) is injected once.

- [ ] **Step 2: Run the tests to see them fail.** Run `cd stt && npm test`, then `python -m unittest scripts/test_inject_stt_client.py`. Expected: FAIL, missing module and functions.

- [ ] **Step 3: Implement `suggest-source.js`, `suggestUrlFor` and the `FILES` entry.** `suggestUrlFor` reuses `servedByRelay`. The in-flight guard timer is 12000 ms, which is longer than the relay's 10 s timeout, so a relay answer normally comes first.

- [ ] **Step 4: Run the tests to see them pass.** Run the same two commands. Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add stt/client/suggest-source.js stt/client/transcript-source.js stt/test/suggest-source.test.js stt/test/transcript-source.test.js scripts/inject-stt-client.py scripts/test_inject_stt_client.py
git commit -m "feat(suggest): browser suggestion source (debounce, one in flight, newest wins) and field reducer"
```

### Task 4: Design System: Field suggestion, Intake wiring, replay lines

**Files:**
- Modify: `ds/project/components/bundle.js` (Field, CASE, REPLAY_LINES, Intake), `ds/project/components/bundle.css`
- Regenerate: `preview-harness.html`
- Test: `stt/test/bundle.test.js`

**Interfaces:**
- Consumes: `EMS.createSuggestSource`, `EMS.suggestUrlFor`, `EMS.suggestionStep` (Task 3), and the line objects from the transcript source.
- Produces: `Field` prop `suggestion: { value, heardAt, updated, onUse, onDismiss } | null`.

- [ ] **Step 1: Write the failing tests** in `bundle.test.js`, using the existing stub-React loader.
  - `'Field shows a dashed suggestion with heard time, Use and dismiss'`:
    - Render `EMS.Field({ label: 'Caller Name', value: '', suggestion: { value: 'Somchai Jaidee', heardAt: '14:20:37', onUse, onDismiss } })`.
    - Find the node with class `ems-field-suggest`. It contains `'Somchai Jaidee'` and `'heard 14:20:37'`, plus a button labelled `Use` and one with `aria-label` `'Dismiss suggestion'`.
    - Calling the Use button's `onClick` calls `onUse` once.
  - `'Updated suggestions say so'`: `updated: true` renders `'Updated · heard 14:20:37'`.
  - `'a suggestion never changes the input value (Review Focus 3)'`: with `value: 'Som'` and a suggestion, the input's `value` prop stays `'Som'`.
  - `'Tab in an empty field takes the suggestion'`: call the input's `onKeyDown({ key: 'Tab', preventDefault })` with `value: ''`. `onUse` is called and `preventDefault` is called. With `value: 'x'`, neither is called.
  - `'replay script ends with the four new lines'`: `src` contains `'Somchai Jaidee. My number is 081 234 5678.'` and `"I don't know him, I have no idea."`.
  - `'Intake wires suggestions'`: `src` matches `/E\.createSuggestSource\(/`, `/E\.suggestUrlFor\(location\)/` and `/Suggestions off/`.
  - `'no masked number is left'`: `src` doesn't contain `'081-xxx-xxxx'`.

- [ ] **Step 2: Run the tests to see them fail.** Run `cd stt && npm test`. Expected: the new `bundle.test.js` cases fail.

- [ ] **Step 3: Implement.**
  - **`Field`.** When `p.suggestion` is set and not locked, render under `.ems-field-box` a `div.ems-field-suggest` (role `status`) holding: a sparkle icon, the value, a muted time label, a `Use` button (`ems-btn ems-btn-ghost ems-btn-sm`, check icon) and a dismiss `×` button. Add `onKeyDown` for the Tab rule.
  - **CSS.** In `bundle.css`, `.ems-field-suggest` uses the dashed `--action-line` border and `--action` text of `.ems-chip-suggest`, with radius `var(--radius-sm)`, padding 8px 12px, a gap and wrapping text, so the Symptom Description runs over 2–3 lines.
  - **`CASE`.** Add `caller: 'Somchai Jaidee'` and `contact: '081-234-5678'`.
  - **`REPLAY_LINES`.** Append the spec's four lines, exactly as written there (times `14:20:33`, `14:20:37`, `14:20:42`, `14:20:45`).
  - **Intake state.**
    - A `form` state holds the six keys. When `E.suggestUrlFor(location)` is non-null, every field starts as `''`. Otherwise use the demo values: `CASE.caller`, `CASE.contact`, `CASE.patient`, `'Unknown / None recorded'`, `CASE.symptoms`, `CASE.address`.
    - A `sug` state holds one `suggestionStep` state per key. A `sugStatus` state starts at `'on'`.
  - **Intake effects.**
    - When the URL is non-null, create the source once.
    - On `'fields'`, run `suggestionStep` with `incoming` for each key. Look up `heardAt` from `tl[0]` by `lineId`, and pass `fieldValue: form[key]`.
    - On `'status'`, set `sugStatus`.
    - Call `src.update(tl[0])` whenever `tl[0]` changes, and `stop` on unmount.
  - **Wire the six `Field`s.**
    - Caller Name, Contact Number, Patient Demographics, U / D and Symptom Description are in the centre card. The address is the Location Lock search `Field`, which keeps its `suggestions` dropdown and `locked`.
    - Each gets `value: form[key]`.
    - `onChange` sets `form` and dispatches `{type:'type'}`.
    - `suggestion` is set when `sug[key].visible`: Use sets `form[key]` to the value and dispatches `use`; dismiss dispatches `dismiss`.
  - **Header note.** In the Patient & Incident card, when `sugStatus === 'off'` and the URL is non-null, show a muted `span` reading `Suggestions off` in `actions`.
  - **Remove `081-xxx-xxxx`.**

- [ ] **Step 4: Rebuild and run.**

```bash
python scripts/inject-stt-client.py ds/project/components/bundle.js stt/client
python scripts/build-preview-harness.py ds preview-harness.html
cd stt && npm test
```

Expected: all pass.

- [ ] **Step 5: Look at it.** Open the harness from disk in the browser pane. Intake must look as it does today, with demo values and no suggestion boxes, and no console errors.

- [ ] **Step 6: Commit.** `ds/` is git-ignored, so only the harness and tests are committed.

```bash
git add preview-harness.html stt/test/bundle.test.js
git commit -m "feat(suggest): dashed one-click suggestions on six Intake fields; EM-104 replay gains name, number, U/D"
```

### Task 5: Docs and ADR

**Files:**
- Create: `docs/adr/0003-intake-form-suggestions-with-claude-haiku.md`, `docs/claude-suggest-setup.md`
- Modify: `CLAUDE.md` ("Live speech-to-text": a **Form suggestions** bullet), `docs/adr/0002-…md` (one line under Implementation notes pointing to 0003)

- [ ] **Step 1: Write ADR 0003.** Use the ADR 0002 front matter (`status: accepted`). Cover:
  - **Decision:** Haiku through the relay; suggest-and-accept.
  - **Considered options:** the four from the spec.
  - **Consequences:**
    - Call text goes to Anthropic, which is acceptable for the demo with no real patients.
    - Cost per call is small.
    - Quote and digit checks are in place.
    - With no key, the form works as before.
  - Say plainly that it doesn't change ADR 0002's chip decision.

- [ ] **Step 2: Write `docs/claude-suggest-setup.md`** at the same step-by-step level as `docs/stt-google-setup.md`:
  - get an API key at console.anthropic.com
  - add `ANTHROPIC_API_KEY=...` to `stt/.env`, which is git-ignored, and never paste the key in chat
  - optional `SUGGEST_MODEL`
  - restart and look for `suggestions: on`
  - `node scripts/suggest-spike.js`
  - troubleshooting: `Suggestions off`; 401 = bad key; 429 = rate limit

- [ ] **Step 3: Update `CLAUDE.md`.** Add one **Form suggestions** bullet: the six fields, `POST /suggest`, `ANTHROPIC_API_KEY`/`SUGGEST_MODEL`, the quote and digit checks, the setup doc link and the spike command. Also note the 12-line replay.

- [ ] **Step 4: Commit.**

```bash
git add docs/adr/0003-intake-form-suggestions-with-claude-haiku.md docs/claude-suggest-setup.md docs/adr/0002-live-speech-to-text-with-google-chirp-3.md CLAUDE.md
git commit -m "docs: ADR 0003 and setup for Intake form suggestions"
```

### Task 6: Figma suggested state

**Files:** Figma file `oLhd7VqtFiFiZOvJe73JPk`. Call `create_session` first, then load the `figma-use` skill before `use_figma`. The Starter plan has a monthly call cap, so batch the work into as few `use_figma` calls as possible.

- [ ] **Step 1: Find the Field component set** on the components page (`search_design_system` for "Field"). Record its node id in `CLAUDE.md`'s Figma library line.
- [ ] **Step 2: Add a `State=suggested` variant** (and `updated` if it's cheap, per the spec's builder note). Copy the dashed style from `KeywordChip Tone=suggested`, using variables, not raw hex. Re-set hug sizing after any `resize()`. Rebind `Show …` properties on clones (`CLAUDE.md` gotchas).
- [ ] **Step 3: Update frame 8:166 Intake.**
  - Caller Name, Contact Number and Symptom Description use the suggested variant, showing the EM-104 values with `heard 14:20:37` / `14:20:06`.
  - The address field shows a suggestion under the search box.
  - Extend the transcript card with the four new lines.
- [ ] **Step 4: Check with `get_screenshot`** of 8:166. Nothing should be clipped, and the dashed boxes should line up with the fields.
- [ ] **Step 5: Commit the `CLAUDE.md` node-id change.**

```bash
git add CLAUDE.md
git commit -m "docs: Figma Field suggested state node ids"
```

### Task 7: Live check with a real key (needs the user)

- [ ] **Step 1: Ask the user to add `ANTHROPIC_API_KEY` to `stt/.env` themselves** (never in chat). Wait for them to say it's done.
- [ ] **Step 2: Run the spike.** Run `cd stt && node scripts/suggest-spike.js`. Expected:
  - all six fields kept, with quotes from the replay lines: `Somchai Jaidee`, `081-234-5678`, `Male, about 30`, `Unknown`, a 1–2 sentence symptoms summary, and `Front of Building A, Soi Lat Phrao 1` or close to it
  - 0 dropped, or a dropped field explained by its quote
- [ ] **Step 3: Check it in the browser.**
  - Restart the relay. The startup log reads `suggestions: on (claude-haiku-5-5)`.
  - Open `http://localhost:8787/?mics=1#Intake` and say the EM-104 lines.
  - Suggestions appear within about 3 s of each line. **Use** fills the field. Typing hides the suggestion.
  - Saying a different phone number shows `Updated`.
- [ ] **Step 4: Check the no-key path.** Remove the key or rename it, then restart. The startup log reads `suggestions: off`, the card shows `Suggestions off`, and the transcript and chips still work.
