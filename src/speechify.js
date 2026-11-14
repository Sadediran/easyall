// Speechify API client (https://docs.speechify.ai).
// All calls happen server-side with a Bearer token; the key never
// leaves this process.
//
// Endpoints used:
//   GET  /v1/voices             — voice catalogue (id, display_name, locale,
//                                 gender, models, preview URL); paginated
//   POST /v1/audio/speech       — returns JSON with base64 audio_data
//
// Request shape (per the official docs and the Speechify-AI skill repo):
//   { input, voice_id, model: "simba-3.5", audio_format: "mp3", language }
// Response: { audio_data (base64), audio_format, billable_characters_count, ... }
//
// Limits that matter here:
//   - /v1/audio/speech takes at most 2,000 spoken characters per request.
//   - A character is one Unicode code point (an emoji counts as one).
//   - Free plan: 3 concurrent requests, 1 request/second; 429 when exceeded.
//   - Free plan pauses with HTTP 402 when the monthly allowance runs out.
//
// There is no public balance endpoint: the app tracks characters itself
// (see store.usedThisMonth) and reports the balance as an estimate.

const { ApiError } = require('./errors');

const BASE = 'https://api.speechify.ai/v1';

async function upstreamError(res) {
  let message = '';
  try {
    const body = await res.json();
    message = (body && body.error && body.error.message) || body.message || body.detail || '';
  } catch {
    // Not JSON — fall through to the generic message.
  }
  if (res.status === 401) {
    return new ApiError(502, 'The Speechify API key was rejected. Check the key in the server settings.');
  }
  if (res.status === 402) {
    return new ApiError(502, 'Your Speechify characters are used up for this month — they start again next month.');
  }
  if (res.status === 429) {
    return new ApiError(502, 'Speechify is busy right now — please wait a moment and try again.');
  }
  if (res.status === 400 && message) {
    return new ApiError(502, `Speechify said: ${message}`);
  }
  return new ApiError(502, message || `Speechify returned an error (${res.status}).`);
}

function modelNames(v) {
  // The API returns models as objects [{ name, languages: [...] }]; older
  // versions returned plain strings. Accept both.
  if (!Array.isArray(v.models)) return [];
  return v.models.map((m) => (typeof m === 'string' ? m : m && m.name)).filter(Boolean);
}

function previewFor(v, model) {
  // Confirmed field on the live API is `preview_audio` (top level). Fall
  // back to the chosen model's language preview, then older field names.
  if (v.preview_audio) return v.preview_audio;
  if (Array.isArray(v.models)) {
    for (const m of v.models) {
      if (!m || m.name !== model || !Array.isArray(m.languages)) continue;
      const withPreview = m.languages.find((l) => l && l.preview_audio);
      if (withPreview) return withPreview.preview_audio;
    }
  }
  return v.preview_url || v.audio_preview_url || v.sample_url || v.preview_audio_url || null;
}

function mapVoice(v, model) {
  return {
    id: v.id || v.voice_id,
    name: v.display_name || v.name || v.id,
    gender: v.gender || null,
    locale: v.locale || v.language || null,
    description: v.description || '',
    previewUrl: previewFor(v, model),
    models: modelNames(v),
    type: v.type || null,
  };
}

async function listVoices(apiKey, { locale = 'en', model = 'simba-3.5' } = {}) {
  const voices = [];
  const seen = new Set();
  const base = `${BASE}/voices?locale=${encodeURIComponent(locale)}&model=${encodeURIComponent(model)}&limit=100`;
  // Pagination is cursor-based: { voices, next_cursor, has_more }.
  let cursor = null;
  for (let page = 0; page < 10; page += 1) {
    const url = cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw await upstreamError(res);
    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.voices || data.data || data.items || []);
    for (const v of items) {
      const mapped = mapVoice(v, model);
      if (!mapped.id || seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      // Only keep voices that serve the chosen model, when the API tells us
      // which models a voice serves.
      const names = modelNames(v);
      if (names.length > 0 && !names.includes(model)) continue;
      voices.push(mapped);
    }
    if (!data || !data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  voices.sort((a, b) => a.name.localeCompare(b.name));
  return voices;
}

async function synthesize(apiKey, { voiceId, text, model, language }) {
  const body = {
    input: text,
    voice_id: voiceId,
    model,
    audio_format: 'mp3',
  };
  // If omitted, Speechify uses the voice's own locale. Passing the voice's
  // locale explicitly keeps the accent the voice was recorded with.
  if (language) body.language = language;
  const res = await fetch(`${BASE}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await upstreamError(res);
  const data = await res.json();
  if (!data.audio_data) {
    throw new ApiError(502, 'Speechify returned no audio for that text. Please try again.');
  }
  return {
    audio: Buffer.from(data.audio_data, 'base64'),
    billableChars: data.billable_characters_count ?? text.length,
  };
}

module.exports = { listVoices, synthesize };
