// Traditional-host entry point: Render, Railway, a VPS, or your own machine.
// Run with:  node server.js
// (Vercel uses api/index.js instead — same app, serverless wrapper.)

const config = require('./src/config');
const { createApp } = require('./src/app');

const app = createApp();

app.listen(config.port, () => {
  console.log(`EasyAll listening on http://localhost:${config.port}`);
  console.log(`  ElevenLabs: ${config.elevenLabsApiKey ? 'configured' : 'NOT configured — set ELEVENLABS_API_KEY'}`);
  console.log(`  Speechify:  ${config.speechifyApiKey ? 'configured' : 'NOT configured — set SPEECHIFY_API_KEY'}`);
  if (config.appPassword) console.log('  Password gate: on');
});
