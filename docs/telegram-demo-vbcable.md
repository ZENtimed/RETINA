# Demo: a Telegram call as the Caller (VB-Cable)

This setup makes a Telegram voice call the **Caller** on the Intake Call Transcript, and your own microphone the **Operator**. It needs no code changes and no second Telegram account. The call's sound goes from Telegram Desktop into a virtual cable, and Intake listens to that cable.

```
Caller's phone ──Telegram call──▶ Telegram Desktop (this PC)
                                     │ speaker = CABLE Input
                                     ▼
                              CABLE Output ──▶ Intake "Caller"
Your headset / laptop mic ──────────────────▶ Intake "Operator"  ──▶ also Telegram's microphone
```

## 1. Install (once)

1. Download **VB-CABLE Driver** (free) from the official site, <https://vb-audio.com/Cable/>.
2. Unzip it, right-click `VBCABLE_Setup_x64.exe`, choose **Run as administrator**, then click **Install Driver**.
3. Restart Windows.
4. Install **Telegram Desktop** and log in. Any account works, because it only receives the call.

You should now have a playback device **CABLE Input** and a recording device **CABLE Output**.

## 2. Route Telegram into the cable

In Telegram Desktop, open **Settings → Advanced → Call settings** (on some versions **Settings → Calls**):

- **Output device (speakers): CABLE Input (VB-Audio Virtual Cable)**
- **Input device (microphone):** your real mic or headset, the same one you will use as Operator.

## 3. Hear the caller yourself

Because Telegram now plays into the cable, you won't hear the caller. To fix that:

1. Open Windows **Sound settings → More sound settings → Recording** tab.
2. Right-click **CABLE Output → Properties → Listen**.
3. Tick **Listen to this device**, choose your **headphones** under "Playback through this device", then click **OK**.

Use **headphones**, not speakers. With speakers, the caller's voice leaks into your Operator mic, so their words would be transcribed twice.

## 4. Start the relay and open Intake

Start the relay in `stt/`:

```bash
npm start
```

Then open Intake, naming the cable as the Caller:

```
http://localhost:8787/?caller=CABLE#Intake
```

- `caller=CABLE` picks the input whose name contains "CABLE" (case doesn't matter) as the Caller.
- The Operator is the first other input. To name it too, add `op=`, for example `?op=Headset&caller=CABLE`.
- Chrome asks for microphone permission the first time. Allow it.
- The badge reads `Connecting…` and then `Live`. If it stays on `Connecting…`, click anywhere on the page.

Place the Telegram call to this PC's account, answer it in Telegram Desktop, and talk. Caller lines come from the phone, and Operator lines from your mic.

**Caller only, no Operator:** open `http://localhost:8787/?mics=1&caller=CABLE#Intake`.

## If it shows Replay

| What you see | Why | Fix |
|---|---|---|
| Replay right away | No input with "CABLE" in its name, or only one input in total | Check that CABLE Output appears in Windows Recording devices; restart Chrome after installing the driver |
| `Connecting…` then Replay after about 10 s | No sound reached the page | Click the page once; check that Chrome's site settings allow the microphone |
| Caller lines missing, Operator fine | Telegram is still playing to your speakers | Set Telegram's output to CABLE Input (step 2) |
| Each caller sentence appears twice (Caller and Operator) | The caller's voice reaches your mic | Use headphones (step 3) |

To check which names Chrome sees, open the browser console on the Intake page and run:

```js
navigator.mediaDevices.enumerateDevices().then(d => console.table(d.filter(x => x.kind === 'audioinput')))
```

## Later: no PC in the loop

For a real deployment, a Telegram bridge built like `Silicon-Melter/claude-caller` (Telethon + py-tgcalls) could answer the call itself and send the caller's audio straight to the relay as 16 kHz PCM. That needs a relay change (an audio feed on the server whose transcript goes to the Intake page) and a second Telegram account, so it isn't built yet.
