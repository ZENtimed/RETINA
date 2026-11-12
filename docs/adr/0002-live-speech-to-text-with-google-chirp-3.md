---
status: accepted
---

# Live speech-to-text at Intake uses Google Chirp 3 through a Node relay, with two audio inputs and a scripted fallback

The **Call Transcript** at Intake was only a scripted replay of the EM-104 call. We are making it a live microphone demo, not a connection to real 1669 phone calls. Audio from two microphones (one for the Operator, one for the Caller) goes from the browser over WebSocket to a small Node.js relay server. The server holds the Google key and streams each input to Google Cloud Speech-to-Text V2 using the Chirp 3 model, with the language auto-detected as Thai or English. Unfinished speech shows as live grey text. Only finished lines are matched against a hand-written phrase table, which maps Thai and English phrases to one fixed list of English chips. If the live path fails, the Intake screen switches to the scripted replay behind the same interface, and a **Live / Replay** badge shows which one is running. We chose this setup so the demo looks real, labels each speaker without guessing, keeps the **Case** in the same English words across all five apps, and always finishes in front of an audience.

## Considered Options

- **Real 1669 telephony (a SIP trunk or Twilio).** This would be realistic, but it is a much bigger build and involves real patient audio. It is out of scope for a design demo.
- **The operator picks TH or EN per call.** This was recommended because it is more reliable and fits "people decide". It was rejected in favour of auto-detect so the operator has nothing to set. Auto-detect while streaming is not confirmed in Google's docs. If it fails, use `["th-TH", "en-US"]`, or detect the language on the first line and keep it for the rest of the call.
- **Google diarization on one microphone.** This needs less hardware, but it can't tell which speaker is the Operator. It is weak on short phrases, and it isn't confirmed to work together with streaming and auto-detect.
- **Chips in the language that was spoken.** This feels more natural to the operator, but one Case could hold "ไม่ใส่หมวก" or "No helmet" depending on the call, and every downstream app would need to understand both.
- **An AI model (for example Gemini) instead of a phrase table.** It would catch more ways of saying things. But it adds a second API, cost, about a second of delay, and odd suggestions. It stays possible later behind the same keyword-suggester interface.
- **Calling Google directly from the browser.** This isn't possible: the key would be exposed, and browsers can't open Google's gRPC streaming connection.

## Consequences

- Thai in Chirp 3 is a Preview language. Run a short test with two streams at once (Thai and English) before building on it.
- Two streams cost twice as much per minute as one. That is acceptable for a demo that lasts a few minutes.
- The design system needs a **partial** (grey) state on `TranscriptLine` and a Live / Replay badge in the transcript header, in Figma and in `components/bundle.js`.
- Wording that isn't in the phrase table produces no suggestion. The operator can still type any chip by hand, so a miss costs time but never puts wrong data on the Case.
