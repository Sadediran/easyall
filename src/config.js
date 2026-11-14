// Central configuration.
//
// API keys come ONLY from environment variables:
//   ELEVENLABS_API_KEY and SPEECHIFY_API_KEY.
// Never hardcode a key, never write one into a file, never log one.
// Locally, put them in a .env file (see .env.example). On a host, set them
// in the host dashboard — Vercel, Render and Railway all have env-var settings.

require('dotenv').config();

const path = require('path');

const isVercel = Boolean(process.env.VERCEL);

// On Vercel the only writable directory is /tmp, and it is ephemeral —
// clips stored there disappear when the instance is recycled. Traditional
// hosts (Render, Railway, a VPS) keep ./data on disk.
const defaultDataDir = isVercel
  ? path.join('/tmp', 'easyall-data')
  : path.join(__dirname, '..', 'data');

module.exports = {
  port: Number(process.env.PORT || 3000),

  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  speechifyApiKey: process.env.SPEECHIFY_API_KEY || '',

  // Monthly Speechify character allowance used for the balance meter.
  // Speechify has no public balance endpoint, so EasyAll counts the
  // characters it generates itself against this allowance.
  speechifyMonthlyCharacters: Number(process.env.SPEECHIFY_MONTHLY_CHARACTERS || 500000),

  // Optional shared password gating the whole site (see src/auth.js).
  appPassword: process.env.APP_PASSWORD || '',

  dataDir: process.env.DATA_DIR || defaultDataDir,

  elevenLabsModel: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
  speechifyModel: process.env.SPEECHIFY_MODEL || 'simba-3.5',
};
