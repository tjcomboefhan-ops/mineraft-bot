// User accounts for the dashboard. Passwords are hashed with scrypt (never stored in plain text).
// Roles: admin = full control, viewer = can only look. Only an admin can create accounts.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');

const scrypt = util.promisify(crypto.scrypt);
const FILE = path.join(__dirname, '..', 'data', 'users.json');
const NAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const SESSION_MS = 12 * 3600 * 1000;
const DUMMY_SALT = crypto.randomBytes(16);   // so unknown usernames take as long to check as real ones

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new Error('Password must be at least 10 characters.');
  if (pw.length > 200) throw new Error('Password is too long.');
}

class Auth {
  constructor() {
    this.users = []; this.sessions = new Map();
    try { this.users = JSON.parse(fs.readFileSync(FILE, 'utf8')).users || []; } catch {}
    setInterval(() => { const n = Date.now(); for (const [t, s] of this.sessions) if (s.exp < n) this.sessions.delete(t); }, 60000).unref();
  }

  save() {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ users: this.users }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  }

  async hash(pw, salt = crypto.randomBytes(16)) {
    return { salt: salt.toString('hex'), hash: (await scrypt(pw, salt, 64)).toString('hex') };
  }

  // First start: make the first admin from .env (ADMIN_USER + DASH_PASSWORD), or generate a password.
  async init(cfg, log) {
    if (this.users.length) return;
    const name = NAME_RE.test(cfg.adminUser) ? cfg.adminUser : 'admin';
    let pw = cfg.dashPassword, generated = false;
    if (!pw || pw.length < 10 || pw === 'change-me') { pw = crypto.randomBytes(9).toString('base64url'); generated = true; }
    await this.create({ username: name, password: pw, role: 'admin' });
    if (generated) {
      const f = path.join(path.dirname(FILE), 'FIRST_ADMIN_LOGIN.txt');
      fs.writeFileSync(f, `username: ${name}\npassword: ${pw}\n(change it after logging in, then delete this file)\n`, { mode: 0o600 });
      log(`First admin account created. Username: ${name}  Password: ${pw}  (also saved in ${f})`);
    } else log(`First admin account created: ${name} (password from DASH_PASSWORD in .env)`);
  }

  pub(u) { return { id: u.id, username: u.username, role: u.role, createdAt: u.createdAt }; }
  list() { return this.users.map((u) => this.pub(u)); }
  byId(id) { return this.users.find((u) => u.id === id); }

  async login(username, password) {
    const u = this.users.find((x) => x.username.toLowerCase() === String(username).toLowerCase());
    const salt = u ? Buffer.from(u.salt, 'hex') : DUMMY_SALT;
    const k = await scrypt(String(password).slice(0, 200), salt, 64);
    if (!u) return null;
    const ok = crypto.timingSafeEqual(k, Buffer.from(u.hash, 'hex'));
    return ok ? u : null;
  }

  async create({ username, password, role }) {
    if (!NAME_RE.test(String(username))) throw new Error('Username: 3-32 letters, numbers, dot, dash or underscore.');
    if (!['admin', 'viewer'].includes(role)) throw new Error('Role must be admin or viewer.');
    checkPassword(password);
    if (this.users.find((u) => u.username.toLowerCase() === username.toLowerCase())) throw new Error('That username already exists.');
    const u = { id: crypto.randomBytes(6).toString('hex'), username, role, createdAt: new Date().toISOString(), ...(await this.hash(password)) };
    this.users.push(u); this.save();
    return this.pub(u);
  }

  async setPassword(id, password) {
    const u = this.byId(id); if (!u) throw new Error('Unknown user.');
    checkPassword(password);
    Object.assign(u, await this.hash(password)); this.save();
    this.killSessions(id);
  }

  setRole(id, role) {
    const u = this.byId(id); if (!u) throw new Error('Unknown user.');
    if (!['admin', 'viewer'].includes(role)) throw new Error('Role must be admin or viewer.');
    if (u.role === 'admin' && role !== 'admin' && this.users.filter((x) => x.role === 'admin').length <= 1) throw new Error('There must be at least one admin.');
    u.role = role; this.save();
  }

  remove(id) {
    const u = this.byId(id); if (!u) throw new Error('Unknown user.');
    if (u.role === 'admin' && this.users.filter((x) => x.role === 'admin').length <= 1) throw new Error('You cannot delete the last admin.');
    this.users = this.users.filter((x) => x.id !== id); this.save(); this.killSessions(id);
  }

  // ---- sessions (random tokens kept in memory, 12 hours) ----
  newSession(u, ip) {
    const mine = [...this.sessions.entries()].filter(([, s]) => s.uid === u.id);
    if (mine.length >= 10) this.sessions.delete(mine[0][0]);
    const token = crypto.randomBytes(32).toString('hex');
    this.sessions.set(token, { uid: u.id, ip, exp: Date.now() + SESSION_MS });
    return token;
  }
  session(token) {
    if (!token) return null;
    const s = this.sessions.get(token);
    if (!s) return null;
    if (s.exp < Date.now()) { this.sessions.delete(token); return null; }
    const user = this.byId(s.uid);
    return user ? { token, user } : null;
  }
  destroy(token) { this.sessions.delete(token); }
  killSessions(uid) { for (const [t, s] of this.sessions) if (s.uid === uid) this.sessions.delete(t); }
}
module.exports = { Auth };
