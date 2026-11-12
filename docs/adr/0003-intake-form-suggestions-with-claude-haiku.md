---
status: accepted
---

# Intake form suggestions come from Claude Haiku through the relay, and the call taker accepts each one

The call taker loses time typing during the call. The Call Transcript is already live (ADR 0002), so while the call runs, the Intake form now offers values for six slow fields:
- Caller Name
- Contact Number
- Patient Demographics
- U / D
- Symptom Description
- Address

How it works:
1. After each finished line, the page sends the transcript so far to the relay's `POST /suggest`.
2. The relay asks Claude Haiku 5.5 (`claude-haiku-5-5`, `SUGGEST_MODEL` overrides it) for a fixed JSON shape. Each value comes with the exact words it came from and the line they were said in.
3. The relay drops any value whose quote isn't in that line, and any phone number whose digits differ from the spoken ones.
4. Each kept value shows as a dashed suggestion under its field. The call taker takes it with **Use** (or Tab in an empty field), types over it, or dismisses it.

Nothing is written into a field by itself, and Case Type stays the call taker's pick. We chose this because the slowest fields to type, the symptom summary and the address, are free speech that only a language model fills well. It keeps the project rule that AI may suggest facts but people decide.

This decision covers the form fields only. ADR 0002's choice of a phrase table for the keyword chips stands unchanged.

## Considered Options

- **Fixed rules in the browser.** Free, instant and private, but it catches only phrasing written into rules and can't write a symptom summary. Rejected because it saves the least typing.
- **Rules for the easy fields plus Claude for the rest.** Phone and age would arrive a second sooner, but it means two systems for little gain.
- **The Claude subscription through `claude -p`.** Each reply takes several seconds to start, and a subscription is for personal use, not the engine of an app.
- **Fill the fields directly, marked "check".** Fastest, but a misheard address could reach Dispatch unchecked. Rejected in favour of suggest-and-accept.

## Consequences

- **Call text leaves the PC and goes to Anthropic.** That is acceptable for this demo, which has no real patients. A real deployment needs a privacy review first.
- **The key stays on the relay.** `ANTHROPIC_API_KEY` in `stt/.env` is never sent to the page and never logged. Without a key, the form works as before, and the card header shows "Suggestions off".
- **Each call costs a little.** The page sends one small request per finished line, at low effort on Haiku.
- **Suggestions trail speech by about 1–3 s.** If Anthropic is slow or fails, suggestions pause and the transcript is not affected.
- **The checks make invented values much less likely, but don't rule them out.** A quote must appear as whole words (at least 4 characters) in the line it cites, and a phone number must be a whole Thai number (9 or 10 digits, starting with 0) spoken as one run of digits in that line. That proves the words were said, not that the value reads them correctly: for name, patient, U / D, symptoms and address, fidelity still rests on the model. That is why every value waits for a person to take it. A number spoken as words, or cut across two lines, produces no suggestion.
- **The EM-104 replay call gained four lines** (name, number, underlying disease), so Replay can show all six suggestions. The demo number is the fake `081-234-5678`.

## Implementation notes

Built in `stt/src/suggest.js`, `stt/src/server.js` (`POST /suggest`), `stt/client/suggest-source.js`, and the Design System's `Field` (`suggestion` prop) and Intake. Spec: `docs/superpowers/specs/2026-11-13-intake-form-suggestions-design.md`. Plan: `docs/superpowers/plans/2026-11-13-intake-form-suggestions.md`. Setup: `docs/claude-suggest-setup.md`.
