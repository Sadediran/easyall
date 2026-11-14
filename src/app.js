// EasyAll — Express app shared by every host.
//
//   server.js      — traditional hosts (Render, Railway, a VPS): listens on PORT
//   api/index.js   — Vercel: the same app exported as a serverless function
//
// API surface (all voice calls are proxied server-side; API keys never
// reach the browser):
//
//   POST /api/login                  { password } -> sets a session cookie (only when APP_PASSWORD is set)
//   POST /api/logout                 clears the session cookie
//   GET  /api/status                 which engines are configured + limits
//   GET  /api/voices?engine=...      voice catalogue for one engine
//   GET  /api/balance?engine=...     remaining credits/characters for one engine
//   POST /api/generate               { engine, voiceId, voiceName, text, language? } -> { clip }
//   GET  /api/clips                  saved clips, newest first
//   GET  /api/clips/:id/audio        stream the MP3 (play in the page)
//   GET  /api/clips/:id/download     download the MP3 as a file
//   DELETE /api/clips/:id            delete a clip
//
// Errors are always JSON { error } with a plain-language message.

const express = require('express');
const path = require('path');

const config = require('./config');
const ClipStore = require('./store');
const elevenlabs = require('./elevenlabs');
const speechify = require('./speechify');
const auth = require('./auth');
const { ApiError } = require('./errors');

// Maximum characters per generation, per the providers' own limits:
// ElevenLabs text-to-speech takes up to 5,000; Speechify's
// /v1/audio/speech takes up to 2,000 spoken characters.
const MAX_CHARS = { elevenlabs: 5000, speechify: 2000 };
const ENGINE_LABEL = { elevenlabs: 'ElevenLabs', speechify: 'Speechify' };

// Voice lists change rarely; cache them briefly so switching engines is instant.
const VOICE_CACHE_TTL_MS = 5 * 60 * 1000;
const voiceCache = new Map(); // engine -> { at, voices }

// Count Unicode code points, matching how the APIs bill (an emoji is one).
function charCount(text) {
  return [...text].length;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function requireEngine(req) {
  const engine = ((req.query.engine || (req.body && req.body.engine)) || '').toLowerCase();
  if (engine !== 'elevenlabs' && engine !== 'speechify') {
    throw new ApiError(400, 'Pick an engine first: ElevenLabs or Speechify.');
  }
  return engine;
}

function requireKey(engine) {
  const key = engine === 'elevenlabs' ? config.elevenLabsApiKey : config.speechifyApiKey;
  if (!key) {
    throw new ApiError(
      503,
      `${ENGINE_LABEL[engine]} is not set up on this server yet. Add the API key to the server settings and try again.`
    );
  }
  return key;
}

async function getVoices(engine) {
  const cached = voiceCache.get(engine);
  if (cached && Date.now() - cached.at < VOICE_CACHE_TTL_MS) return cached.voices;
  const key = requireKey(engine);
  const voices = engine === 'elevenlabs'
    ? await elevenlabs.listVoices(key)
    : await speechify.listVoices(key, { locale: 'en', model: config.speechifyModel });
  voiceCache.set(engine, { at: Date.now(), voices });
  return voices;
}

async function getBalance(engine, store) {
  if (engine === 'elevenlabs') {
    return elevenlabs.getBalance(requireKey(engine));
  }
  // Speechify has no public balance endpoint, so EasyAll counts the
  // characters it generated itself this month against the plan allowance.
  requireKey(engine);
  const limit = config.speechifyMonthlyCharacters;
  const used = store.usedThisMonth('speechify');
  return {
    engine: 'speechify',
    unit: 'characters',
    used,
    limit,
    remaining: Math.max(0, limit - used),
    estimated: true,
    note: 'Counts only clips generated through EasyAll this month.',
  };
}

// What the browser gets for a clip: metadata plus URLs. The audio itself
// stays on the server until the browser asks for it.
function publicClip(clip) {
  return {
    id: clip.id,
    engine: clip.engine,
    voiceId: clip.voiceId,
    voiceName: clip.voiceName,
    text: clip.text,
    chars: clip.chars,
    createdAt: clip.createdAt,
    audioUrl: `/api/clips/${clip.id}/audio`,
    downloadUrl: `/api/clips/${clip.id}/download`,
  };
}

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  const store = new ClipStore(config.dataDir);
  const publicDir = path.join(__dirname, '..', 'public');

  // Optional password gate (does nothing unless APP_PASSWORD is set).
  app.use(auth.middleware(publicDir));

  app.post('/api/login', (req, res) => {
    if (!config.appPassword) return res.json({ ok: true });
    const { password } = req.body || {};
    if (!auth.passwordMatches(password)) {
      return res.status(401).json({ error: 'That password is not right.' });
    }
    auth.setSessionCookie(req, res);
    return res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    auth.clearSessionCookie(res);
    return res.json({ ok: true });
  });

  app.get('/api/status', (req, res) => {
    res.json({
      engines: {
        elevenlabs: {
          configured: Boolean(config.elevenLabsApiKey),
          model: config.elevenLabsModel,
          maxChars: MAX_CHARS.elevenlabs,
        },
        speechify: {
          configured: Boolean(config.speechifyApiKey),
          model: config.speechifyModel,
          maxChars: MAX_CHARS.speechify,
        },
      },
      authRequired: Boolean(config.appPassword),
    });
  });

  app.get('/api/voices', asyncHandler(async (req, res) => {
    const engine = requireEngine(req);
    res.json({ engine, voices: await getVoices(engine) });
  }));

  app.get('/api/balance', asyncHandler(async (req, res) => {
    const engine = requireEngine(req);
    res.json(await getBalance(engine, store));
  }));

  app.post('/api/generate', asyncHandler(async (req, res) => {
    const engine = requireEngine(req);
    const key = requireKey(engine);
    const { voiceId, voiceName, text, language } = req.body || {};
    if (!voiceId || typeof voiceId !== 'string') {
      throw new ApiError(400, 'Pick a voice first.');
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new ApiError(400, 'Type something for the voice to say first.');
    }
    const clean = text.trim();
    const chars = charCount(clean);
    const max = MAX_CHARS[engine];
    if (chars > max) {
      throw new ApiError(
        400,
        `That text is ${chars.toLocaleString('en-US')} characters — the ${ENGINE_LABEL[engine]} limit for one clip is ${max.toLocaleString('en-US')}. Split it into shorter pieces.`
      );
    }

    let result;
    if (engine === 'elevenlabs') {
      result = await elevenlabs.synthesize(key, { voiceId, text: clean, model: config.elevenLabsModel });
    } else {
      result = await speechify.synthesize(key, {
        voiceId,
        text: clean,
        model: config.speechifyModel,
        language,
      });
    }

    const clip = await store.add({
      engine,
      voiceId,
      voiceName: voiceName || voiceId,
      text: clean,
      chars,
      billableChars: result.billableChars,
      audioBuffer: result.audio,
    });
    res.json({ clip: publicClip(clip) });
  }));

  app.get('/api/clips', (req, res) => {
    res.json({ clips: store.list().map(publicClip) });
  });

  app.get('/api/clips/:id/audio', (req, res, next) => {
    const clip = store.get(req.params.id);
    if (!clip) return next(new ApiError(404, 'That clip is no longer here.'));
    res.sendFile(store.audioPath(clip), { headers: { 'Content-Type': 'audio/mpeg' } }, (err) => {
      if (err) next(new ApiError(404, 'That clip is no longer here.'));
    });
  });

  app.get('/api/clips/:id/download', (req, res, next) => {
    const clip = store.get(req.params.id);
    if (!clip) return next(new ApiError(404, 'That clip is no longer here.'));
    res.download(store.audioPath(clip), `easyall-${clip.id}.mp3`, (err) => {
      if (err) next(new ApiError(404, 'That clip is no longer here.'));
    });
  });

  app.delete('/api/clips/:id', asyncHandler(async (req, res) => {
    const removed = await store.remove(req.params.id);
    if (!removed) throw new ApiError(404, 'That clip is no longer here.');
    res.json({ ok: true });
  }));

  // Unknown API routes get JSON, not the app shell.
  app.use('/api/', (req, res) => {
    res.status(404).json({ error: 'That is not an EasyAll address.' });
  });

  // Static frontend, plus a fallback so deep links land on the app.
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // Last stop: plain-language errors, nothing raw.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
  });

  return app;
}

module.exports = { createApp };
