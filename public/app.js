// EasyAll frontend — vanilla JS, no build step.
// The browser never sees an API key: every voice call goes through
// the server's /api routes.

const CHARS_PER_MINUTE = 900; // rough speech rate, for "about X of speech"

const state = {
  status: null,
  engine: 'elevenlabs',
  voices: [],
  selectedVoice: null,
  clips: [],
};

const $ = (id) => document.getElementById(id);

const textEl = $('text');
const voiceListEl = $('voiceList');
const voiceSearchEl = $('voiceSearch');
const generateBtn = $('generateBtn');
const playerCard = $('playerCard');
const player = $('player');
const toastEl = $('toast');

let previewAudio = null;
let previewBtn = null;

function charCount(text) {
  return [...text].length; // Unicode code points, matching how the APIs bill
}

function fmt(n) {
  return n.toLocaleString('en-US');
}

function formatDuration(chars) {
  const seconds = Math.max(1, Math.round((chars / CHARS_PER_MINUTE) * 60));
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toastEl.hidden = true; }, 6000);
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    // Password gate: go to the login page. (A plain reload would loop on
    // hosts like Vercel, where the static page is served without the
    // server-side gate — the login page itself is what asks for the password.)
    window.location.href = '/login.html';
    throw new Error('Please sign in to use EasyAll.');
  }
  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong. Please try again.');
  }
  return data;
}

// ---------- Engine picker ----------

function engineLabel(engine) {
  return engine === 'elevenlabs' ? 'ElevenLabs' : 'Speechify';
}

function engineUnit(engine) {
  return engine === 'elevenlabs' ? 'credits' : 'characters';
}

async function selectEngine(engine, { load = true } = {}) {
  state.engine = engine;
  state.selectedVoice = null;
  stopPreview();

  document.querySelectorAll('.engine').forEach((el) => {
    el.classList.toggle('selected', el.dataset.engine === engine);
  });
  $('speechifyCredit').hidden = engine !== 'speechify';

  const max = state.status.engines[engine].maxChars;
  textEl.maxLength = max;
  updateCostLine();

  const hint = $('engineHint');
  if (engine === 'speechify') {
    hint.textContent = `Speechify reads up to ${fmt(max)} characters per clip, on Simba 3.5.`;
  } else {
    hint.textContent = `ElevenLabs reads up to ${fmt(max)} characters per clip.`;
  }

  if (load) {
    await loadVoices();
    await loadBalance(engine);
  }
}

async function loadBalance(engine) {
  const el = $(`balance-${engine}`);
  try {
    const b = await fetchJson(`/api/balance?engine=${engine}`);
    el.textContent = `${fmt(b.remaining)} ${b.unit} left${b.estimated ? ' · tracked here' : ''}`;
  } catch (err) {
    el.textContent = 'Balance unavailable';
  }
}

// ---------- Voices ----------

async function loadVoices() {
  voiceListEl.innerHTML = '<p class="empty">Loading voices…</p>';
  try {
    const data = await fetchJson(`/api/voices?engine=${state.engine}`);
    state.voices = data.voices || [];
    renderVoices();
  } catch (err) {
    voiceListEl.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
  }
}

function renderVoices() {
  const q = voiceSearchEl.value.trim().toLowerCase();
  const list = state.voices.filter((v) => {
    if (!q) return true;
    return (v.name + ' ' + (v.gender || '') + ' ' + (v.locale || '')).toLowerCase().includes(q);
  });
  if (list.length === 0) {
    voiceListEl.innerHTML = '<p class="empty">No voices match that search.</p>';
    return;
  }
  voiceListEl.innerHTML = '';
  for (const voice of list) {
    const row = document.createElement('div');
    row.className = 'voice-row' + (state.selectedVoice && state.selectedVoice.id === voice.id ? ' selected' : '');
    row.tabIndex = 0;

    const info = document.createElement('div');
    info.className = 'voice-info';
    const name = document.createElement('div');
    name.className = 'voice-name';
    name.textContent = voice.name;
    const meta = document.createElement('div');
    meta.className = 'voice-meta';
    meta.textContent = [voice.gender, voice.locale, voice.description].filter(Boolean).join(' · ') || 'Voice';
    info.appendChild(name);
    info.appendChild(meta);
    row.appendChild(info);

    if (voice.previewUrl) {
      const btn = document.createElement('button');
      btn.className = 'preview-btn';
      btn.type = 'button';
      btn.textContent = '▶';
      btn.title = `Hear ${voice.name}`;
      btn.setAttribute('aria-label', `Hear ${voice.name}`);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePreview(voice.previewUrl, btn);
      });
      row.appendChild(btn);
    }

    const pick = () => {
      state.selectedVoice = voice;
      document.querySelectorAll('.voice-row').forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
    };
    row.addEventListener('click', pick);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
    voiceListEl.appendChild(row);
  }
}

function stopPreview() {
  if (previewAudio) {
    previewAudio.pause();
    previewAudio = null;
  }
  if (previewBtn) {
    previewBtn.textContent = '▶';
    previewBtn.classList.remove('playing');
    previewBtn = null;
  }
}

function togglePreview(url, btn) {
  if (previewAudio && previewBtn === btn) {
    stopPreview();
    return;
  }
  stopPreview();
  previewAudio = new Audio(url);
  previewBtn = btn;
  btn.textContent = '⏸';
  btn.classList.add('playing');
  previewAudio.addEventListener('ended', stopPreview);
  previewAudio.addEventListener('error', () => {
    stopPreview();
    showToast('Could not play that preview.');
  });
  previewAudio.play().catch(() => {
    stopPreview();
    showToast('Could not play that preview.');
  });
}

// ---------- Composer + cost ----------

function updateCostLine() {
  const chars = charCount(textEl.value);
  $('charCount').textContent = `${fmt(chars)} character${chars === 1 ? '' : 's'}`;
  const costEl = $('costLine');
  const max = state.status ? state.status.engines[state.engine].maxChars : 0;
  if (chars === 0) {
    costEl.textContent = '';
    costEl.classList.remove('over');
    return;
  }
  const label = `${fmt(chars)} ${engineUnit(state.engine)} · about ${formatDuration(chars)} of speech`;
  if (chars > max) {
    costEl.textContent = `${label} — over the ${fmt(max)} limit for one clip`;
    costEl.classList.add('over');
  } else {
    costEl.textContent = `Costs ${label}`;
    costEl.classList.remove('over');
  }
}

// ---------- Generate ----------

async function generate() {
  if (!state.selectedVoice) {
    showToast('Pick a voice first.');
    return;
  }
  const text = textEl.value.trim();
  if (!text) {
    showToast('Type something for the voice to say first.');
    textEl.focus();
    return;
  }
  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating…';
  try {
    const data = await fetchJson('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        engine: state.engine,
        voiceId: state.selectedVoice.id,
        voiceName: state.selectedVoice.name,
        text,
        language: state.selectedVoice.locale || undefined,
      }),
    });
    showClip(data.clip);
    await loadClips();
    await loadBalance(state.engine);
  } catch (err) {
    showToast(err.message);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = '✦ Generate voice';
  }
}

function showClip(clip) {
  player.src = clip.audioUrl;
  $('clipMeta').textContent =
    `${clip.voiceName} · ${engineLabel(clip.engine)} · ${fmt(clip.chars)} characters · ${new Date(clip.createdAt).toLocaleString()}`;
  const dl = $('downloadBtn');
  dl.href = clip.downloadUrl;
  playerCard.hidden = false;
  player.play().catch(() => {});
  playerCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- Library ----------

async function loadClips() {
  try {
    const data = await fetchJson('/api/clips');
    state.clips = data.clips || [];
    renderLibrary();
  } catch {
    // Library is a bonus; a failure here should not block the studio.
  }
}

function snippet(text, n = 70) {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > n ? oneLine.slice(0, n - 1) + '…' : oneLine;
}

function renderLibrary() {
  const lib = $('library');
  if (state.clips.length === 0) {
    lib.innerHTML = '<p class="empty">No clips yet. Your first generation will appear here.</p>';
    return;
  }
  lib.innerHTML = '';
  for (const clip of state.clips) {
    const row = document.createElement('div');
    row.className = 'clip-row';

    const info = document.createElement('div');
    info.className = 'clip-info';
    const text = document.createElement('div');
    text.className = 'clip-text';
    text.textContent = snippet(clip.text);
    const sub = document.createElement('div');
    sub.className = 'clip-sub';
    const tag = document.createElement('span');
    tag.className = 'engine-tag';
    tag.textContent = engineLabel(clip.engine);
    sub.appendChild(tag);
    sub.appendChild(document.createTextNode(
      `${clip.voiceName} · ${new Date(clip.createdAt).toLocaleDateString()}`
    ));
    info.appendChild(text);
    info.appendChild(sub);
    row.appendChild(info);

    const play = document.createElement('button');
    play.className = 'icon-btn';
    play.type = 'button';
    play.textContent = '▶';
    play.title = 'Play';
    play.addEventListener('click', () => showClip(clip));
    row.appendChild(play);

    const dl = document.createElement('a');
    dl.className = 'icon-btn';
    dl.href = clip.downloadUrl;
    dl.textContent = '⬇';
    dl.title = 'Download MP3';
    row.appendChild(dl);

    const del = document.createElement('button');
    del.className = 'icon-btn danger';
    del.type = 'button';
    del.textContent = '✕';
    del.title = 'Delete';
    del.addEventListener('click', async () => {
      if (!confirm('Delete this clip?')) return;
      try {
        await fetchJson(`/api/clips/${clip.id}`, { method: 'DELETE' });
        await loadClips();
      } catch (err) {
        showToast(err.message);
      }
    });
    row.appendChild(del);

    lib.appendChild(row);
  }
}

// ---------- Boot ----------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function init() {
  try {
    state.status = await fetchJson('/api/status');
  } catch (err) {
    showToast('Could not reach the EasyAll server.');
    return;
  }

  // Wire the engine cards; disable any engine with no key on the server.
  for (const engine of ['elevenlabs', 'speechify']) {
    const card = $(`engine-${engine}`);
    const info = state.status.engines[engine];
    if (!info.configured) {
      card.classList.add('disabled');
      card.disabled = true;
      $(`balance-${engine}`).textContent = 'Not set up';
    } else {
      card.addEventListener('click', () => selectEngine(engine));
      loadBalance(engine);
    }
  }

  const firstEngine = state.status.engines.elevenlabs.configured ? 'elevenlabs' : 'speechify';
  if (!state.status.engines[firstEngine].configured) {
    $('engineHint').textContent = 'No voice engine is set up on this server yet. Add an API key in the server settings.';
    voiceListEl.innerHTML = '<p class="empty">Add an API key to the server settings to load voices.</p>';
    return;
  }

  await selectEngine(firstEngine);
  await loadClips();

  textEl.addEventListener('input', updateCostLine);
  voiceSearchEl.addEventListener('input', renderVoices);
  generateBtn.addEventListener('click', generate);
}

init();
