// ElevenLabs API client (https://elevenlabs.io/docs/api-reference).
// All calls happen server-side with the xi-api-key header; the key never
// leaves this process.
//
// Endpoints used:
//   GET  /v1/voices                       — voice catalogue (with preview_url)
//   GET  /v1/user/subscription            — character_count / character_limit
//   POST /v1/text-to-speech/{voice_id}    — returns raw MP3 bytes
//
// Billing: text-to-speech costs 1 credit per character on the standard models.

const { ApiError } = require('./errors');

const BASE = 'https://api.elevenlabs.io/v1';

async function upstreamError(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = (body && body.detail && body.detail.message) || body.detail || '';
  } catch {
    // Not JSON — fall through to the generic message.
  }
  if (res.status === 401) {
    return new ApiError(502, 'The ElevenLabs API key was rejected. Check the key in the server settings.');
  }
  if (res.status === 402) {
    return new ApiError(502, 'Your ElevenLabs credits are used up for this month.');
  }
  if (res.status === 429) {
    return new ApiError(502, 'ElevenLabs is busy right now — please wait a moment and try again.');
  }
  return new ApiError(502, detail ? `ElevenLabs said: ${detail}` : `ElevenLabs returned an error (${res.status}).`);
}

async function listVoices(apiKey) {
  const res = await fetch(`${BASE}/voices`, { headers: { 'xi-api-key': apiKey } });
  if (!res.ok) throw await upstreamError(res);
  const data = await res.json();
  return (data.voices || []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    gender: (v.labels && v.labels.gender) || null,
    locale: (v.labels && v.labels.accent) || null,
    description: v.description || '',
    previewUrl: v.preview_url || null,
  }));
}

async function getBalance(apiKey) {
  const res = await fetch(`${BASE}/user/subscription`, { headers: { 'xi-api-key': apiKey } });
  if (!res.ok) throw await upstreamError(res);
  const data = await res.json();
  const used = data.character_count || 0;
  const limit = data.character_limit || 0;
  return {
    engine: 'elevenlabs',
    unit: 'credits',
    used,
    limit,
    remaining: Math.max(0, limit - used),
    tier: data.tier || null,
    resetUnix: data.next_character_count_reset_unix || null,
  };
}

async function synthesize(apiKey, { voiceId, text, model }) {
  const url = `${BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) throw await upstreamError(res);
  const audio = Buffer.from(await res.arrayBuffer());
  return { audio, billableChars: text.length };
}

module.exports = { listVoices, getBalance, synthesize };
