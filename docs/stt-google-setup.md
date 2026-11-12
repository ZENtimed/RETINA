# Getting Google credentials for live speech-to-text

RETINA's Intake screen can transcribe a call live. The two microphones stream through a small local server (`stt/`) to **Google Cloud Speech-to-Text** (model Chirp 3). That server needs Google credentials. This guide sets them up once. It takes about 15 minutes.

> **An API key does not work.** Google's Speech-to-Text V2 (the version we stream to) rejects plain API keys with `UNAUTHENTICATED: API keys are not supported by this API`. We tested this. The server must sign in with **Google credentials** instead: your own Google login (Option A) or a service-account key file (Option B). Both work with no code change.

## What you need

- A Google account.
- A payment card for Google Cloud billing. New accounts usually get free trial credit.
- Node.js 20 or newer, and the RETINA repo cloned.
- Two microphones for the live demo: the first is the Operator, the second is the Caller.

## Step 1: Create a project and turn on billing

1. Open <https://console.cloud.google.com/> and sign in.
2. In the project picker at the top, click **New project**, give it a name (for example `retina-stt`) and click **Create**.
3. Copy the **Project ID**. It is shown under the name and looks like `retina-stt-123456`. You will need it later.
4. Open **Billing** in the menu and link a billing account to this project. Speech-to-Text does not run without one.

## Step 2: Turn on the one API you need

1. Open **APIs & Services → Library**.
2. Search for **Cloud Speech-to-Text API** and click **Enable**.

That is the only API. Gemini, Translation, Maps and Dialogflow are **not** needed.

## Step 3: Get credentials (pick one option)

### Option A: Sign in with your own Google account (recommended, no key file)

1. Install the Google Cloud CLI from <https://cloud.google.com/sdk/docs/install>.
2. In PowerShell, run:

   ```powershell
   gcloud auth application-default login
   gcloud auth application-default set-quota-project <your-project-id>
   ```

   A browser window opens. Sign in with the account that owns the project.

3. Make sure that account has the role **Cloud Speech Client** on the project. Project owners and editors already have it.

There's no file to lose or leak. Skip `GOOGLE_APPLICATION_CREDENTIALS` in Step 4.

### Option B: Service-account key file

Use this when the computer running the demo shouldn't use your personal login.

1. Open **IAM & Admin → Service Accounts** and click **Create service account**.
2. Give it a name (for example `retina-stt`). Under **Grant this service account access**, add the role **Cloud Speech Client**, then click **Done**.
3. Click the new service account, open **Keys → Add key → Create new key**, choose **JSON**, and click **Create**. A `.json` file downloads.
4. Move that file **outside the RETINA folder**, for example to `C:\keys\retina-stt.json`.

> If Google says key creation is disabled (the organization policy `iam.disableServiceAccountKeyCreation`), use Option A.

**Keep the key secret.** Anyone with the file can spend money on your project.
- Never commit it, send it in chat, or put it in the repo. `.gitignore` blocks `*-key.json` and `credentials*.json` as a safety net, but keep the file out of the folder anyway.
- If it leaks, delete the key in **Keys** and create a new one.

## Step 4: Start the server

In PowerShell, from the RETINA folder:

```powershell
cd stt
npm install
$env:GOOGLE_CLOUD_PROJECT = "<your-project-id>"
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\keys\retina-stt.json"   # Option B only
npm start
```

You should see:

```
languages=["en-US"] location=us
RETINA STT relay on http://localhost:8787/#Intake
```

The `$env:` values last only for that PowerShell window. Set them again in each new window.

**Or use a `.env` file** so you don't retype them. Put it at `RETINA/stt/.env` or `RETINA/.env`; both are ignored by git, so they are never committed:

```
GOOGLE_CLOUD_PROJECT=<your-project-id>
# Option B only (leave it out for Option A):
GOOGLE_APPLICATION_CREDENTIALS=C:\keys\retina-stt.json
```

Values already set in the PowerShell window win over the file. The server says which sign-in it used, without printing the secret:

```
env files: .env · auth: key file
```

If the server can't sign in, it stops at start-up and says why, for example `Key file not found: …` or `does not accept API keys`.

## Step 5: Check it works

1. **Optional, without microphones:** record a short Thai clip and a short English clip, convert them, and stream both to Google:

   ```powershell
   ffmpeg -i th.m4a -ar 16000 -ac 1 -c:a pcm_s16le th.wav
   ffmpeg -i en.m4a -ar 16000 -ac 1 -c:a pcm_s16le en.wav
   node scripts/spike.js th.wav en.wav
   ```

   You should see lines like `[A] final (th-th): …` and `[B] final (en-us): …`.

2. **Live demo:**
   1. Open **http://localhost:8787/#Intake** in Chrome. Use this address, not the `preview-harness.html` file, which always shows Replay.
   2. Click **Allow** for the microphone, then click once anywhere on the page.
   3. The server window prints `Operator: Google stream open` and `Caller: Google stream open`.
   4. The badge goes from **Connecting…** to **Live**.

## Cost

- **Rate:** about **US$0.016 per minute of audio** for standard recognition. Check the current price at <https://cloud.google.com/speech-to-text/pricing>.
- **Two streams:** we run two at once (Operator and Caller), so a demo costs about **US$0.03 per minute**. A 10-minute demo is about US$0.32.
- **Silence is billed:** audio streams even when nobody speaks. Close the Intake tab or stop the server (Ctrl+C) when you're not testing.
- **Budget alert:** set one in **Billing → Budgets & alerts**, for example at US$5.

## Troubleshooting

| What you see | Why | Fix |
|---|---|---|
| `Set GOOGLE_CLOUD_PROJECT` and the server exits | The project ID isn't set in this window | Set `$env:GOOGLE_CLOUD_PROJECT` and run `npm start` again |
| Badge shows **Replay** straight away, and the server prints no `stream open` lines | The page didn't reach the server | Open `http://localhost:8787/#Intake` (not the file), allow the mic, and connect two mics |
| Server prints `Could not load the default credentials` | No credentials found | Do Step 3 again. For Option B, check the path in `GOOGLE_APPLICATION_CREDENTIALS` |
| Server prints `PERMISSION_DENIED` | The API is off, billing is off, or the role is missing | Check Steps 1–3 |
| Thai speech comes out as nonsense English | The relay listens for English only (`en-US`) by default | For Thai too, set `STT_LANGUAGES=th-TH,en-US` (or `auto`) in `stt/.env` and restart |
| Badge stays on **Connecting…** | Chrome is holding audio until you interact with the page | Click anywhere on the page |
| Operator and Caller are swapped | Chrome lists the mics in a different order | In the browser console run `window.RETINA_STT = { micLabels: { Operator: 'Headset', Caller: 'USB' } }` (use parts of your mic names), then reload |

More detail, including how the server works and its other settings, is in `CLAUDE.md` under "Live speech-to-text".
