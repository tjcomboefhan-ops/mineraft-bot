// Settings you can change from the dashboard. .env gives the starting values; anything changed on
// the website is saved to data/settings.json (mode 600, it holds your API key) and wins from then on.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mineflayer = require('mineflayer');
const cfg = require('./config');

const FILE = path.join(__dirname, '..', 'data', 'settings.json');
const MODES = ['auto', 'direct', 'viaproxy'];
const HOST_RE = /^[A-Za-z0-9._:\-\[\]]{1,253}$/;
const VER_RE = /^[A-Za-z0-9._+\- ]{1,32}$/;
// settings that need the bot to rejoin the server before they take effect
const RECONNECT_KEYS = ['mode', 'botName', 'clientVersion', 'targetVersion', 'msAccount', 'viaAuth', 'viaAccountIndex'];

class Settings {
  constructor() {
    this.s = {
      mode: cfg.mode, botName: cfg.botName, msAccount: cfg.msAccount || '',
      clientVersion: cfg.clientVersion, targetVersion: 'auto', viaAuth: 'account', viaAccountIndex: 0, viaPort: cfg.viaPort,
      apiKey: cfg.apiKey, model: cfg.model, unlockAll: cfg.unlockAll, autoDefend: true, idleGlance: true,
      activeProfile: 'default',
      profiles: [{ id: 'default', name: 'My server', host: cfg.host, port: cfg.port, mode: '', targetVersion: '' }],
    };
    try { Object.assign(this.s, JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch {}
    if (!this.s.profiles.length) this.s.profiles = [{ id: 'default', name: 'My server', host: cfg.host, port: cfg.port, mode: '', targetVersion: '' }];
    if (!this.s.profiles.find((p) => p.id === this.s.activeProfile)) this.s.activeProfile = this.s.profiles[0].id;
  }

  save() {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.s, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  }

  get() { return this.s; }

  // The server to join right now: profile values, falling back to the global mode/version.
  active() {
    const p = this.s.profiles.find((x) => x.id === this.s.activeProfile);
    return { ...p, mode: p.mode || this.s.mode, targetVersion: p.targetVersion || this.s.targetVersion };
  }

  // What the dashboard may see: never the API key or the password.
  view() {
    const { apiKey, ...rest } = this.s;
    return { ...rest, hasApiKey: !!apiKey, clientVersions: mineflayer.testedVersions.slice().reverse(), latestClient: mineflayer.latestSupportedVersion };
  }

  // Validates and applies a patch. Returns { changed: [...keys], needsReconnect }.
  update(p) {
    const s = this.s, changed = [];
    const set = (k, v) => { if (s[k] !== v) { s[k] = v; changed.push(k); } };
    if ('mode' in p) { if (!MODES.includes(p.mode)) throw new Error('Mode must be auto, direct or viaproxy.'); set('mode', p.mode); }
    if ('botName' in p) { if (!/^[A-Za-z0-9_]{3,16}$/.test(p.botName)) throw new Error('Bot name: 3-16 letters, numbers or underscores.'); set('botName', p.botName); }
    if ('msAccount' in p) set('msAccount', String(p.msAccount).slice(0, 100));
    if ('clientVersion' in p) { if (!mineflayer.testedVersions.includes(p.clientVersion)) throw new Error('That bot version is not supported by Mineflayer.'); set('clientVersion', p.clientVersion); }
    if ('targetVersion' in p) { if (p.targetVersion !== 'auto' && !VER_RE.test(p.targetVersion)) throw new Error('Invalid target version.'); set('targetVersion', p.targetVersion); }
    if ('viaAuth' in p) { if (!['account', 'none'].includes(p.viaAuth)) throw new Error('Invalid join method.'); set('viaAuth', p.viaAuth); }
    if ('viaAccountIndex' in p) { const n = parseInt(p.viaAccountIndex, 10); if (!(n >= 0 && n < 50)) throw new Error('Account number must be 0-49.'); set('viaAccountIndex', n); }
    if ('model' in p) set('model', String(p.model).slice(0, 100));
    if (p.apiKey) set('apiKey', String(p.apiKey).slice(0, 300));
    if (p.clearApiKey) set('apiKey', '');
    for (const k of ['unlockAll', 'autoDefend', 'idleGlance']) if (k in p) set(k, !!p[k]);
    this.save();
    return { changed, needsReconnect: changed.some((k) => RECONNECT_KEYS.includes(k)) };
  }

  upsertProfile(p) {
    const name = String(p.name || '').trim().slice(0, 40);
    const host = String(p.host || '').trim();
    const port = parseInt(p.port, 10);
    if (!name) throw new Error('Give the server a name.');
    if (!HOST_RE.test(host)) throw new Error('Invalid server address.');
    if (!(port >= 1 && port <= 65535)) throw new Error('Port must be 1-65535.');
    const mode = p.mode || ''; if (mode && !MODES.includes(mode)) throw new Error('Invalid mode.');
    const targetVersion = p.targetVersion || ''; if (targetVersion && targetVersion !== 'auto' && !VER_RE.test(targetVersion)) throw new Error('Invalid version.');
    const id = p.id && this.s.profiles.find((x) => x.id === p.id) ? p.id : crypto.randomBytes(4).toString('hex');
    const prof = { id, name, host, port, mode, targetVersion };
    const i = this.s.profiles.findIndex((x) => x.id === id);
    if (i >= 0) this.s.profiles[i] = prof; else this.s.profiles.push(prof);
    this.save();
    return prof;
  }

  removeProfile(id) {
    if (this.s.profiles.length <= 1) throw new Error('Keep at least one server.');
    this.s.profiles = this.s.profiles.filter((p) => p.id !== id);
    if (this.s.activeProfile === id) this.s.activeProfile = this.s.profiles[0].id;
    this.save();
  }

  setActive(id) {
    if (!this.s.profiles.find((p) => p.id === id)) throw new Error('Unknown server.');
    this.s.activeProfile = id; this.save();
  }
}
module.exports = { Settings };
