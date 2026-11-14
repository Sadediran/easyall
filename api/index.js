// Vercel entry point. Vercel runs this file as a serverless function and
// vercel.json rewrites every /api/* request to it, so the same Express app
// serves the API on Vercel as it does on a traditional host.
//
// Note: on Vercel the clip library lives in /tmp and is ephemeral — clips
// survive while the instance is warm but are not guaranteed to persist.
// See README.md ("Where clips are stored").

const { createApp } = require('../src/app');

module.exports = createApp();
