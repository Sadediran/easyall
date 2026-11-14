// Clip library: a small JSON index plus one MP3 file per clip, both under
// the data directory. No database to install; the JSON file is the index and
// the audio files are the payload. Replays and re-downloads read from disk,
// so they never cost voice credits.
//
// On Vercel the data directory is /tmp (ephemeral) — clips survive while the
// instance is warm but are not guaranteed to persist. On Render/Railway the
// files persist on the server's disk (Render free has an ephemeral disk too;
// attach a persistent disk or a Railway volume for a lasting library).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ClipStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.audioDir = path.join(dataDir, 'audio');
    this.file = path.join(dataDir, 'clips.json');
    fs.mkdirSync(this.audioDir, { recursive: true });
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.clips = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Failed to read clip library:', err.message);
      this.clips = [];
    }
  }

  async save() {
    await fs.promises.writeFile(this.file, JSON.stringify(this.clips, null, 2));
  }

  list() {
    return [...this.clips].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id) {
    return this.clips.find((clip) => clip.id === id) || null;
  }

  async add({ engine, voiceId, voiceName, text, chars, billableChars, audioBuffer }) {
    const id = crypto.randomUUID();
    const file = `${id}.mp3`;
    await fs.promises.writeFile(path.join(this.audioDir, file), audioBuffer);
    const clip = {
      id,
      engine,
      voiceId,
      voiceName,
      text,
      chars,
      billableChars: billableChars ?? chars,
      createdAt: Date.now(),
      file,
    };
    this.clips.push(clip);
    await this.save();
    return clip;
  }

  async remove(id) {
    const clip = this.get(id);
    if (!clip) return false;
    this.clips = this.clips.filter((c) => c.id !== id);
    await this.save();
    await fs.promises.unlink(path.join(this.audioDir, clip.file)).catch(() => {});
    return true;
  }

  audioPath(clip) {
    return path.join(this.audioDir, clip.file);
  }

  // Characters billed through this app in the current calendar month,
  // per engine. Used for the Speechify balance meter, which has no
  // upstream endpoint to read.
  usedThisMonth(engine) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return this.clips
      .filter((clip) => clip.engine === engine && clip.createdAt >= monthStart)
      .reduce((sum, clip) => sum + (clip.billableChars || clip.chars || 0), 0);
  }
}

module.exports = ClipStore;
