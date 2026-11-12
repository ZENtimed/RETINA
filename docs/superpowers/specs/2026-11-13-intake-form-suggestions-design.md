# Intake form suggestions from the call (Claude Haiku)

Status: for approval · 2026-11-13

## Intent

The call taker loses time **typing during the call**. The Call Transcript is already live (ADR 0002), so while the call is going, the Intake form should offer what was just said as ready-made values for the slow fields. The call taker takes each one with a click, or types their own. Success means a call taker can fill the form for the EM-104 call mostly by clicking **Use**, without typing the symptom sentence or the address.

## Goals

- Suggest values for six Intake fields, from the transcript so far, while the call is running:
  1. **Caller Name**
  2. **Contact Number**
  3. **Patient Demographics** (sex and age, for example "Male, about 30")
  4. **U / D** (underlying disease; often "None mentioned")
  5. **Symptom Description** (a short, factual summary in English)
  6. **Address** (the Location Lock search box)
- Each suggestion shows **under its field as a dashed box** with the value, when it was heard, and a **Use** button. Pressing **Tab** in an empty, focused field also takes it.
- Suggestions improve as the call goes on. A later line can replace a suggestion, for example when the caller corrects the phone number.

## Non-goals

- **Case Type** and its keyword chips are unchanged. Case Type stays the call taker's pick, and chips still come from the phrase table (ADR 0002).
- The **AI Detected Critical Keywords** box (still fixed demo data) is unchanged.
- **Location pin and lock:** a used address fills the search box only. The two-step verification and **Confirm Location** stay manual.
- Thai. The relay is English only for now (`STT_LANGUAGES=en-US`), so the prompt and the suggestions are English. Thai can come later without changing this design.
- Canned suggestions for Replay without a key (see Behaviour).

## Anti-goals (a failure even if it works)

- **Anything is filled without a person taking it.** The system never writes into a field by itself, and never overwrites what the call taker typed. (Project rule: AI may suggest facts, people make every decision.)
- **A made-up value.** A suggestion that isn't backed by words actually said on the call must not appear.
- **The form gets in the way:** suggestions that jump around while the call taker is typing, or a slow or failing AI that blocks the form.
- **The key reaches the browser.**

## Constraints

- The Anthropic API key lives only on the relay, in `stt/.env` as `ANTHROPIC_API_KEY`. It is never sent to the page and never logged.
- The model is **Claude Haiku 5.5** (`claude-haiku-5-5`), chosen for speed. `SUGGEST_MODEL` in `.env` can override it.
- The relay stays bound to `127.0.0.1` and keeps its Origin allow-list for the new endpoint.
- Call text leaves the PC and goes to Anthropic. That's acceptable for the demo, with no real patients. It is recorded in a new **ADR 0003**, because ADR 0002 rejected an AI model for the chips. This decision is about the form fields only.
- The design lives in the Design System (`ds/` working copy of the artifact, then the harness) and in Figma. Both get the new suggested state.

## Approaches considered

1. **Fixed rules in the browser.** Free, instant and private, but it catches only phrasing written into rules and can't write a symptom summary, which is the slowest field to type. Rejected, because it saves the least typing.
2. **Claude Haiku through the relay.** Handles any phrasing, writes the summary, and pulls the address out of speech. Costs a little per call, needs an API key, and adds 1–3 s of delay. **Chosen.**
3. **Rules for the easy fields plus Claude for the rest.** Gets phone and age a second sooner, but means two systems for little gain. Rejected.
4. **Claude subscription via `claude -p` (as in claude-caller).** Rejected: several seconds per reply, and a subscription is meant for personal use, not for an app.

The display choice, **suggest and accept** (A), was picked over **fill in and mark to check** (B), because B lets a misheard address reach Dispatch unchecked.

## Decided design

### Flow

```
finished transcript line ──▶ page: wait 800 ms for more lines
   ──▶ POST /suggest {lines:[{id,time,speaker,text}]}  (relay, same Origin rules)
   ──▶ relay ──▶ Claude Haiku (tool use, fixed schema) ──▶ relay checks quotes
   ──▶ page: dashed suggestion under each field
```

- **When it runs:** after each **finished** line (never partials), from Live or Replay, but only when the page is served by the relay (`servedByRelay`). A page opened from disk gets no suggestions.
- **Debounce and order:** wait 800 ms after the last finished line, then send the **whole transcript so far**. At most one request is in flight. If lines arrive meanwhile, send one more request when it returns. The newest response wins, and an older response that arrives late is dropped.
- **Request:** the page sends `{lines}`. The relay builds the prompt, so the page never holds a prompt or a key.
- **Response:** `{fields: {callerName, contactNumber, patient, underlyingDisease, symptoms, address}}`. Each present field is `{value, quote, lineId}`. A field the call hasn't covered is left out. No guessing: no age unless one was said.
- **Quote check (anti-hallucination):** the model must give, for each value, the exact words from one line (`quote`, `lineId`). The relay drops any field whose quote doesn't appear in that line, ignoring case and spacing. `symptoms` is a summary, so it carries the quote of its main line and is checked the same way.
- **Digit check (my call):** for **Contact Number**, the digits in the value must equal the digits in the quote, in order. A wrong digit drops the suggestion. Other fields rely on the quote check alone.
- **Pronouns count as said (my call):** "He is about thirty" supports "Male, about 30". A sex or age that nothing in the call supports is left out.
- **The model's instructions** (in the relay): only facts the caller or operator said; English; short; Contact Number as digits with dashes; Symptom Description factual, with no diagnosis and no triage words such as "critical" or "Code Red" (triage is set by Dispatch). The output is forced through a tool schema, so the relay always gets valid JSON.

### Behaviour in the form

- **Starting values (my call):** when the page is served by the relay (Live, Connecting, or Replay after a fallback), the six fields start **empty**. When it is not (opened from disk, or the published Design System page), suggestions can't run, so Intake keeps today's demo text and looks as it does now.
- **When a suggestion shows (my call):** each field remembers the last suggested value it was shown. A suggestion shows while the field is empty. Once the call taker clicks **Use** or types in the field, the suggestion hides. It comes back only when the model returns a value **different from the last one shown** for that field, marked "Updated · heard 14:20:44". It never replaces the field's value by itself, and the same value never reappears.
- **Use** (or Tab in an empty, focused field) copies the value into the field. From then on the value is the call taker's, like any typed text.
- The call taker can dismiss a suggestion (×). It stays hidden until its value changes.
- **No key, or Anthropic fails** (error, timeout of 10 s, rate limit): no suggestions appear, the form works exactly as it does today, and the relay logs one line. The transcript is not affected. No badge or error is shown to the call taker. A small muted note in the Intake card header ("Suggestions off") is enough.
- **Replay:** on the relay, Replay happens only after a live failure (for example, no second mic). Suggestions then run on the scripted lines like on live ones, when the relay has a key. The relay still needs Google credentials to start, as today; a no-Google start and a `?stt=replay` switch are not part of this work (my call).

### Replay script (decided with you)

Four lines are added to the end of the EM-104 replay (`REPLAY_LINES`), so Replay can show all six suggestions. The earlier lines, their timing and their chips are unchanged.

```
14:20:33  Operator  Can I have your name and a number to call you back?
14:20:37  Caller    Somchai Jaidee. My number is 081 234 5678.
14:20:42  Operator  Does he have any medical conditions you know of?
14:20:45  Caller    I don't know him, I have no idea.
```

The demo contact number becomes the full, fake `081-234-5678` everywhere it appears for EM-104 (it was `081-xxx-xxxx`), so the digit check can pass. U / D from this call is "Unknown".

### Look

The suggested state follows the existing dashed **KeywordChip Tone=suggested** style:

```
Caller Name
[                                  ]
┆ ✦ Somchai Jaidee    heard 14:19:58    ✓ Use   × ┆
```

The Symptom Description suggestion wraps over two or three lines. The address suggestion sits under the Location Lock search box, above the map.

### Parts that change

- **Relay (`stt/src/`):** a `POST /suggest` route next to the WebSocket, the Anthropic call (`@anthropic-ai/sdk`), the quote check, the `ANTHROPIC_API_KEY` and `SUGGEST_MODEL` settings, and a startup line saying whether suggestions are on.
- **Browser client (`stt/client/`):** a suggestion source (debounce, one in flight, newest wins, stop), injected into the bundle like the others.
- **Design System (`ds/` bundle.js and bundle.css):** a `suggestion` prop on `Field` (value, heard-at time, onUse, onDismiss, updated flag), and Intake wired to it with controlled fields. The harness is rebuilt.
- **Design System artifact (my call):** not republished in this work. The change goes into `ds/` and the harness; republishing to the shared URL is a separate step that needs your yes, and the artifact wasn't reachable last time.
- **Figma:** a `State=suggested` variant on the Field component set, and frame 8:166 showing two or three fields with suggestions.
- **Docs:** ADR 0003, a CLAUDE.md section, and the key setup in `docs/stt-google-setup.md` (or a short `docs/claude-suggest-setup.md`).

## Left to the builder

- The exact prompt wording and the tool schema field descriptions, within the rules above.
- Whether the quote check normalises punctuation as well as case and spacing.
- The CSS of the suggested state, within the dashed-chip look.
- How tests stub Anthropic (a fake client injected like the Google one).
- Whether the Figma work is one variant or a small set (suggested, updated).
