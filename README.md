# EasyAll — Your Voice Studio

EasyAll is a warm, simple website for generating realistic voices. Pick an
engine — **ElevenLabs** or **Speechify** — choose a voice, type your text,
see exactly what it costs, and generate speech you can play and download
as an MP3. Every clip is saved in a library, so replays and re-downloads
cost nothing.

This is the standalone, portable codebase: plain Node.js + Express, no
build step, no host lock-in. It deploys to Vercel, Render, or Railway
from the same code.

## Quick start (local)

```bash
npm install
cp .env.example .env
# Edit .env and paste your API keys
npm start
```

Then open http://localhost:3000.

## Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| `ELEVENLABS_API_KEY` | One engine needed | ElevenLabs key, from elevenlabs.io → Settings → API Keys |
| `SPEECHIFY_API_KEY` | One engine needed | Speechify API key, from platform.speechify.ai → API keys |
| `SPEECHIFY_MONTHLY_CHARACTERS` | No | Monthly Speechify allowance for the balance meter. Default `500000` (the API free plan). |
| `APP_PASSWORD` | No | Shared password gating the whole site. Leave empty for open access. **Set this before sharing the link publicly** — anyone with the link spends your voice credits. |
| `DATA_DIR` | No | Where clips are stored. Default `./data` (on Vercel: `/tmp/easyall-data`). |
| `PORT` | No | Port to listen on. Default `3000`. |

Keys come **only** from environment variables. They are never written into
any file in this repo, never logged, and never sent to the browser — every
voice call is proxied server-side.

## How it works

```
Browser ──> Express server ──> ElevenLabs API  (xi-api-key header)
                          └──> Speechify API   (Bearer token)
```

- `GET /api/voices?engine=` — voice catalogue for one engine, with preview audio.
- `GET /api/balance?engine=` — remaining credits (ElevenLabs, live from the
  subscription endpoint) or characters (Speechify, counted by EasyAll — see below).
- `POST /api/generate` — `{ engine, voiceId, voiceName, text, language? }`.
  ElevenLabs takes up to 5,000 characters per clip; Speechify's
  `/v1/audio/speech` takes up to 2,000. The server enforces both limits
  with a plain message.
- `GET /api/clips`, `GET /api/clips/:id/audio`, `GET /api/clips/:id/download`,
  `DELETE /api/clips/:id` — the saved library.

Models: ElevenLabs `eleven_multilingual_v2`, Speechify `simba-3.5`
(48 languages). Both are overridable with `ELEVENLABS_MODEL` /
`SPEECHIFY_MODEL`.

### Speechify balance is an estimate

Speechify has no public balance endpoint, so EasyAll counts the characters
it generates itself each calendar month against `SPEECHIFY_MONTHLY_CHARACTERS`
and shows the remainder as an estimate, labelled as such in the UI. Usage
outside EasyAll is not counted. ElevenLabs balances are live, read from
`GET /v1/user/subscription`.

### Where clips are stored

Clips are one MP3 file each plus a small JSON index, under `DATA_DIR`.

- **Local / VPS / Railway (with a volume):** clips persist on disk.
- **Render free:** the disk is ephemeral, so clips disappear on redeploys
  and restarts. Attach a paid persistent disk for a lasting library.
- **Vercel:** the only writable directory is `/tmp`, which is ephemeral —
  clips survive while the instance is warm but are not guaranteed to
  persist. For a permanent library on Vercel, add object storage
  (e.g. Vercel Blob) later; generation itself is unaffected.

## Deploy

### Vercel (recommended for a quick free link)

```bash
npm i -g vercel
vercel login
vercel
```

Then in the Vercel dashboard (Project → Settings → Environment Variables),
add `ELEVENLABS_API_KEY` and `SPEECHIFY_API_KEY` (and `APP_PASSWORD` if you
want the password gate), and redeploy. `vercel.json` routes `/api/*` to the
Express app as a serverless function and serves the frontend statically.

Notes:

- Vercel Hobby is for personal, non-commercial use.
- The function timeout is set to 60 seconds in `vercel.json`; a single
  generation is normally a few seconds, so this is plenty.
- The clip library is ephemeral on Vercel (see above).

### Render

Use the included `render.yaml` (New → Blueprint, point it at the repo), or
create a Web Service manually: build command `npm install`, start command
`node server.js`, then add the API keys as environment variables in the
dashboard. `render.yaml` marks the keys `sync: false` so Render asks for
them instead of reading them from the file.

### Railway

Create a project from the repo. Railway detects the Node app and uses the
`Procfile` (`web: node server.js`). Add the API keys as Variables in the
dashboard. Attach a Volume mounted at `/app/data` (or set `DATA_DIR` to the
volume path) for a persistent clip library.

## Security notes

- API keys live only in environment variables on the server. The browser
  never sees them, and no endpoint returns them.
- **Anyone with the link can spend your voice credits.** The free plans
  are 10,000 ElevenLabs credits/month and 500,000 Speechify characters/month.
  Set `APP_PASSWORD` before sharing the link beyond people you trust.
- Both keys used here should be dedicated to EasyAll, so you can revoke
  one without touching anything else.

## Troubleshooting

- **"ElevenLabs / Speechify is not set up on this server yet"** — the
  matching environment variable is missing. Add it on the host and redeploy.
- **"The … API key was rejected"** — the key is wrong or was revoked.
  Create a fresh key and update the environment variable.
- **"Your … credits/characters are used up for this month"** — the free
  allowance ran out; it renews next month.
- **A voice has no preview button** — that voice's catalogue entry carries
  no preview audio. Pick another voice, or generate a short test clip.
- **Clips vanished after a redeploy** — expected on Vercel and Render free
  (ephemeral storage). See "Where clips are stored".
