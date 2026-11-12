# Turning on Intake form suggestions (Claude API key)

The Intake form can suggest Caller Name, Contact Number, Patient Demographics, U / D, Symptom Description and Address from the live call. The suggestions come from Claude Haiku through the local relay, which needs an **Anthropic API key**.

Without a key, everything else still works. The card shows **Suggestions off**.

You need the relay already working with Google first (`docs/stt-google-setup.md`).

## 1. Get an API key

1. Go to <https://console.anthropic.com> and sign in, or create an account.
2. Add a payment method under **Billing**. The API is pay-per-use, and a demo call costs very little.
3. Open **API Keys** → **Create Key**. Name it, for example `retina-relay`.
4. Copy the key. It starts with `sk-ant-`, and it is shown only once.

Treat the key like a password:
- Never paste it into a chat, an issue, or a file that goes into git.
- If it leaks, delete it in the console and create a new one.

## 2. Put it in `stt/.env`

Open `stt/.env`, the same file that holds your Google settings. It is git-ignored. Add this line:

```
ANTHROPIC_API_KEY=sk-ant-...your key...
```

Optional: use a different Claude model. The default is `claude-haiku-5-5`, the fastest.

```
SUGGEST_MODEL=claude-haiku-5-5
```

## 3. Check the key with the spike

In `stt/`:

```bash
node scripts/suggest-spike.js
```

It sends the scripted EM-104 call to Claude once and prints what the form would be offered, for example:

```
model=claude-haiku-5-5 lines=12
took 1400 ms
callerName: Somchai Jaidee   [replay-9: "Somchai Jaidee"]
contactNumber: 081-234-5678   [replay-9: "081 234 5678"]
...
kept 6 of 6
```

## 4. Restart the relay

Stop the relay with **Ctrl+C**, then run:

```bash
npm start
```

The start-up lines should include `suggestions: on (claude-haiku-5-5)`. Open `http://localhost:8787/#Intake` (or `?mics=1` with one mic) and talk.

About 1–3 seconds after each finished line, dashed suggestions appear under the fields:
- **Use** (or **Tab** in an empty field) fills the field.
- Typing your own value hides the suggestion.
- **×** dismisses it.
- If the caller corrects something, the new value shows as **Updated**.

## If something is wrong

| What you see | Why | Fix |
|---|---|---|
| `suggestions: off (no ANTHROPIC_API_KEY)` | The key isn't in `stt/.env`, or the relay was started before you added it | Add the line and restart the relay |
| The card shows **Suggestions off** during a call | The relay has no key, or Anthropic didn't answer | Look at the relay window: one line says why (for example `AuthenticationError 401`) |
| `AuthenticationError 401` | The key is wrong or was deleted | Create a new key and replace it in `stt/.env` |
| `RateLimitError 429` | Too many requests, or no credit left | Wait a minute; check **Billing** in the console |
| A field never gets a suggestion | The call didn't say it clearly, or the words aren't in the transcript (for example a number spoken as words) | Type it; that's the safe outcome |

## Privacy

The transcript of each call is sent to Anthropic to make the suggestions. That is fine for this demo with no real patients. Do not use it for real 1669 calls without a privacy review (ADR 0003).
