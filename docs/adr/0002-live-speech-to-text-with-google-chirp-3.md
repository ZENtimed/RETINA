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

## Implementation notes

Built in `stt/` (see `CLAUDE.md`, "Live speech-to-text"), plan `docs/superpowers/plans/2026-11-12-live-speech-to-text.md`.

- **Spike (two streams, Thai + English):** not run yet. It needs a Google Cloud project and two recordings (`node stt/scripts/spike.js th.wav en.wav`). Until it passes, auto-detect (`languageCodes: ["auto"]`) in streaming is unconfirmed. If it fails, set `STT_LANGUAGES=th-TH,en-US`.
- **Microphones:** Operator is the first audio input and Caller the second, overridable by label. With fewer than two inputs Intake uses Replay, because one mic can't label speakers.
- **When Live is tried:** only on the page the relay serves (`localhost:8787`). The relay refuses WebSocket connections from any other browser origin, so no other site can spend the Google key. Elsewhere, including the claude.ai artifact, Intake starts in Replay.
- **Connecting → Live:** the badge reads `Connecting…` until both relay sockets are ready and audio from both mics has reached them. A suspended Chrome AudioContext resumes on the first click or key press.
- **Fallback:** a denied mic, no `ready` within 3 s of the sockets opening, no audio within 10 s of `ready`, a relay error, or a dropped socket. It is one-way for the session. Finished lines stay, the grey partial is removed, and the replay lines follow.
- **Replay pace:** the first line at once, then one line every 1.5 s.
- **Chips:** the phrase table (`stt/client/phrases.js`) gives each chip one Case Type. ChipInput offers only the chips of the chosen Case Type that finished lines produced. Thai matching ignores spaces that the recogniser inserts. A phrase right after a negation (`ไม่`, `ไม่ได้`, `ไม่มี`, `ไม่ได้มี`, `ยังไม่`, `not`, `no`, `no longer`, `wasn't`, `isn't`, `never`, `denies`, `without`) is not suggested.
- **Audio:** each mic has a stateful 16 kHz resampler, so 128-sample worklet blocks join without lost samples. The relay starts a fresh Google stream every 4.5 minutes, before the stream limit of about 5 minutes.
- **UI:** `TranscriptLine` has a `partial` state (grey, no keyword marks, no copy button). `TranscriptBadge` (`Live` / `Replay`) replaces the waveform in the transcript card header, because both together squeezed the 296px header. The transcript stays scrolled to the newest line unless the operator has scrolled up.
