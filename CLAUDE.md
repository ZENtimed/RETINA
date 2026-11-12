# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this folder is

RETINA is the UI/UX design for a Smart Emergency Medical Response & AI Traffic Routing System. It has five apps that share one case (#EM-104: male, about 30, severe head trauma, apnea, Code Red) and one light token set (namespace `EMS`, Inter) in the white / cyan `#2596be` / yellow `#e6e246` of niems.go.th. The cyan app bar carries white type, and yellow is a fill-only accent: the app-bar tile and the current step. Triage colours keep their clinical meaning, and Code Yellow stays amber:

1. EMS Call Intake (1440×900)
2. Dispatch (1440×900): a Case Board start screen, then the Command Center with 3 tabs
3. Ambulance Copilot (1024×768)
4. Traffic Police Control Hub (phone, 390×844 portrait)
5. Hospital ER Pre-Arrival (1440×900)

Design rule: AI may suggest facts (dashed keyword chips at Intake), but people make every decision. There is no AI triage probability, unit ranking, hospital ranking or pre-selection. Domain terms are in `CONTEXT.md`.

The design lives in two places outside this folder. Treat them as the source of truth:

- **Design System artifact:** https://claude.ai/artifact/U2YowM3zMU6B6UbQyPC5Ca
  - Contains tokens.json, design-system.json, `components/bundle.js` + `bundle.css` (React 18 UMD, exposes `window.EMS` and `EMS.Screens`), per-component previews, and one page per app plus an Ecosystem page.
  - To change it, read it with the Artifact tool, edit the returned files, and republish to the same URL.
- **Figma file `oLhd7VqtFiFiZOvJe73JPk`:** an Apps page and a components page with variables, text styles, and component sets.
  - App frames: 8:166 Intake, 40:1718 Dispatch 2a (Case Board), 9:482 Dispatch (Patient Triage), 60:2302 Dispatch 2b0 (Destination Hospital), 11:660 Dispatch 2b (fleet), 11:981 Dispatch 2c (tracking), 41:1936 Copilot 3a (Accept Case), 46:2112 Copilot 3a2 (Decline Reason), 41:2090 Copilot 3b (At Scene, Auto-Arrival panel), 46:2218 Copilot 3b2 (No Transport), 44:2107 Traffic (phone), 60:3199 Hospital 5a (Incoming Notice), 13:1467 Hospital (Pre-Arrival). The crew has no hospital picker; the old 3c Select Hospital frame is deleted.
  - Library additions for this flow: `CaseRow` set 39:1876, `ReasonOption` set 46:2111, `KeywordChip` Tone=suggested, `UnitCard` Type=selectable/selected, `Icon/arrow-left` 39:1843.
  - Form suggestions (ADR 0003): `Field` set 5:107 has `State=suggested` (90:266 single-line, 90:289 multi-line) with a dashed suggestion row under the input and TEXT properties `Suggestion#90:17` / `Heard#90:22`. Frame 8:166 does not show it yet (the MCP call cap was hit on 2026-11-13): switch its six Field instances to `State=suggested` with an empty Value, and add the four new transcript lines.
  - Live speech-to-text (ADR 0002): `TranscriptLine` set 5:330 has `State=default|partial` (partial variant 86:192: muted text, no copy), and `TranscriptBadge` set 86:212 has `Mode=live|replay|connecting`. On 8:166 the badge sits in the transcript card header in place of the waveform.
  - Variables: one mode, "Light (NIEMS)". Retheme by changing variable values. Text on red or black fills uses `color/on/danger`, and the yellow accent is `color/accent/default` with `color/accent/ink`.
  - 33 prototype links. Decline → Decline Reason → Case Board (or Back); No Transport → dialog → Case Board (or Cancel). The main path starts at 8:166: Intake → Case Board → Triage → Destination Hospital → Fleet → Copilot Accept → At Scene → (Confirm Patient Onboard) Hospital Pre-Arrival. Each Command Center tab's Case Board button leads back to 40:1718.
  - Call `create_session` with this key before using any Figma tool.

## preview-harness.html

`preview-harness.html` is a single self-contained test page for viewing the screens locally. It is generated: it inlines the tokens CSS, bundle.css and bundle.js, and loads React 18.3.1 from jsDelivr, so it needs internet access. Don't hand-edit the inlined bundle. Instead, read the artifact's `project/` files into a folder and run:

```bash
python scripts/build-preview-harness.py <folder holding project/> preview-harness.html
```

The page renders exactly one screen, `EMS.Screens[location.hash.slice(1) || 'Intake']`, and reads the hash only at load. To view a different screen, set the hash (`#Dispatch`, `#Copilot`, `#Traffic`, `#Hospital`, `#Ecosystem`) and reload. Dispatch opens on the Case Board, the Copilot opens on Accept Case, and Hospital opens on the Incoming Notice. The Copilot's arrivals and the Hospital's switch to Pre-Arrival run on short timers that simulate location and the crew. The buttons inside each screen change that screen's local state only. Navigation between apps exists only in the Figma prototype.

## Live speech-to-text (`stt/`)

The Intake **Call Transcript** can run live (ADR 0002). `stt/` is one Node package with two parts:

- `stt/src/`: the relay. It serves `preview-harness.html` at `/` and bridges one WebSocket per microphone (`/stt?speaker=Operator|Caller`) to one Google Speech-to-Text V2 stream (model `chirp_3`). It listens on `127.0.0.1` only and refuses browser pages from any other origin, because it spends your Google key.
- `stt/client/`: browser code (phrase table, PCM conversion, mic capture, the transcript source with Live → Replay fallback). These files are UMD, so `node --test` can test them, and they are copied into `bundle.js` by `scripts/inject-stt-client.py`.

To run it live (first-time Google setup, step by step: `docs/stt-google-setup.md`):

```bash
cd stt && npm install
```

Then, with Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS` pointing at a key file outside the repo) and `GOOGLE_CLOUD_PROJECT` set, run `npm start` in `stt/` and open `http://localhost:8787/#Intake`. Optional env: `STT_LOCATION` (default `us`), `STT_LANGUAGES` (default `en-US`, English only, for speed and accuracy; `auto` turns language detection back on, and `th-TH,en-US` lists both), `STT_PORT` (default 8787).

- **When Live is tried:** only when the page is served by the relay (`localhost:8787` / `127.0.0.1:8787`). Everywhere else Intake starts in Replay. `?stt=live` asks for Live, but the relay refuses other origins, so it falls back to Replay.
- **Microphones:** Operator is the first audio input and Caller the second. Override this in the URL with `?op=<label part>&caller=<label part>` (either one alone is fine; the other speaker gets the first remaining input), or with `window.RETINA_STT = { micLabels: { Operator: '<label part>', Caller: '<label part>' } }`. The URL wins. For a Telegram call as the Caller, see `docs/telegram-demo-vbcable.md`. With fewer than two inputs, or a label that matches nothing, Intake uses Replay. To test with one microphone, open the page with `?mics=1` (for example `http://localhost:8787/?mics=1#Intake`): that mic is the Caller, and the Operator isn't transcribed.
- **Connecting:** the badge reads `Connecting…` until both relay sockets are `ready` and audio reaches them from both mics. Only then does it read `Live`. Chrome may hold the audio until the page gets a click or key press, so if the badge stays on `Connecting…`, click anywhere on the page.
- **Fallback:** the screen switches to Replay for the rest of the session on any of these: a denied mic, no `ready` within 3 s of the sockets opening (the mic permission prompt doesn't count), no audio within 10 s of `ready`, a relay error, or a dropped socket. Finished lines stay, and the grey partial is removed.
- **Long sessions:** the relay starts a fresh Google stream every 4.5 minutes, because a stream accepts about 5 minutes of audio. The browser doesn't notice. If Google ends a stream on its own, Intake falls back to Replay.
- **Chips:** only finished lines go through the phrase table in `stt/client/phrases.js`. It maps Thai and English phrases to fixed English chips, and each chip has one Case Type. ChipInput offers only the chips of the chosen Case Type.
- **Form suggestions (ADR 0003):** while the call runs, Intake offers dashed suggestions for Caller Name, Contact Number, Patient Demographics, U / D, Symptom Description and Address. The page posts finished lines to the relay's `POST /suggest` (800 ms after the last line, one request at a time). The relay asks Claude (`SUGGEST_MODEL`, default `claude-haiku-5-5`, key `ANTHROPIC_API_KEY` in `stt/.env`) and keeps a value only if its quote appears as whole words (4+ characters) in the cited line; a phone number must be a whole Thai number (9–10 digits, starting with 0) spoken as one digit run in that line. The call taker clicks **Use** (or Tab in an empty field); nothing is filled by itself. Without a key the card shows `Suggestions off`. On the relay the six fields start empty; from disk they keep the demo text. Setup: `docs/claude-suggest-setup.md`. Check a key with `node stt/scripts/suggest-spike.js`. The EM-104 replay is 12 lines (name, number and U / D at the end).
- **After changing `stt/client/`:** run `python scripts/inject-stt-client.py <folder>/project/components/bundle.js stt/client`, then rebuild the harness.
- **Tests:** `cd stt && npm test` (Node) and `python -m unittest scripts/test_inject_stt_client.py`. `stt/test/bundle.test.js` reads the Design System working copy from `ds/` (git-ignored; override with `EMS_DS_DIR`).
- **Spike:** `node stt/scripts/spike.js a.wav b.wav` streams two 16 kHz mono WAVs to Google at once. Convert a recording with `ffmpeg -i in.m4a -ar 16000 -ac 1 -c:a pcm_s16le out.wav`.

## Figma Plugin API gotchas hit on this file

- `resize()` resets sizing modes to FIXED, so set hug/AUTO again after resizing.
- A component set's hug height applies only when set in a separate `use_figma` call.
- An empty auto-layout frame defaults to 100px tall. Collapse spacer frames explicitly.
- Variable scopes must be unique, so de-duplicate them before calling `setVariableScopes`.
- `fontFeatures` is unsupported, and arbitrary custom properties cannot be set on nodes.
- Cloning a variant with `clone()` drops its component property references (such as `Show copy` on visibility). Set the clone's layers directly or rebind them.
- Measure layout-dependent sizes, such as probability bar fills, after layout settles, not before.
