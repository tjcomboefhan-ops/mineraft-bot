// Website dashboard API + static files, protected by accounts (auth.js) and the anti-bot guard (guard.js).
const express = require('express');
const net = require('net');
const path = require('path');

const ACTIONS = ['stop', 'follow', 'come', 'goto', 'collect_wood', 'craft', 'attack', 'explore', 'status'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(tj, cfg, guard, auth) {
  const app = express();
  app.disable('x-powered-by');
  if (cfg.trustProxy) app.set('trust proxy', cfg.trustProxy);   // only when nginx/Cloudflare sits in front

  app.use(guard.middleware());                                  // 1. blocked IPs and obvious attacks stop here
  app.use((req, res, next) => {                                 // 2. security headers
    res.set({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
      'Cache-Control': req.path.startsWith('/api') ? 'no-store' : 'no-cache',
    });
    next();
  });
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const S = () => tj.settings.get();
  const tokenOf = (req) => (req.headers.authorization || '').replace(/^Bearer /, '');

  // role gate: need('viewer') lets everyone logged in through, need('admin') only admins
  const need = (role) => (req, res, next) => {
    const ip = guard.ipOf(req), tok = tokenOf(req), s = auth.session(tok);
    if (!s) {
      if (tok) guard.strike(ip, 2, 'invalid or expired session token');
      return res.status(401).json({ error: 'Please log in.', login: true });
    }
    if (role === 'admin' && s.user.role !== 'admin') {
      guard.strike(ip, 2, `viewer "${s.user.username}" tried an admin action`);
      return res.status(403).json({ error: 'Admins only.' });
    }
    req.user = s.user; req.token = s.token; next();
  };
  const h = (fn) => async (req, res) => {
    try { res.json((await fn(req)) || { ok: true }); } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
  };

  // ---------- login ----------
  app.post('/api/login', async (req, res) => {
    const ip = guard.ipOf(req);
    const { username, password, hp, elapsed } = req.body || {};
    if (hp) { guard.ban(ip, 'filled in the hidden login field (bot)'); return res.status(403).json({ error: 'Blocked.' }); }
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      guard.strike(ip, 3, 'malformed login request'); return res.status(400).json({ error: 'Enter a username and password.' });
    }
    if (typeof elapsed === 'number' && elapsed < 800) guard.strike(ip, 5, 'login submitted faster than a human can type');
    await sleep(250 + Math.random() * 250);                      // slows down guessing
    const u = await auth.login(username, password);
    if (!u) {
      guard.strike(ip, 2, `failed login for "${username.slice(0, 32)}"`);
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    guard.reset(ip); guard.log('login', ip, `${u.username} (${u.role}) logged in`);
    res.json({ token: auth.newSession(u, ip), user: auth.pub(u) });
  });
  app.post('/api/logout', need('viewer'), (req, res) => { auth.destroy(req.token); res.json({ ok: true }); });
  app.get('/api/me', need('viewer'), (req, res) => res.json({ user: auth.pub(req.user) }));
  app.post('/api/me/password', need('viewer'), h(async (req) => {
    const { current, next } = req.body || {};
    if (!(await auth.login(req.user.username, String(current || '')))) { guard.strike(guard.ipOf(req), 3, 'wrong current password on change'); throw new Error('Current password is wrong.'); }
    await auth.setPassword(req.user.id, next);
    return { relogin: true };
  }));

  // ---------- anyone logged in ----------
  app.get('/api/state', need('viewer'), (req, res) => res.json(tj.publicState()));

  // ---------- admin only ----------
  const A = need('admin');
  app.get('/api/settings', A, (req, res) => res.json(tj.settings.view()));
  app.post('/api/settings', A, h((req) => tj.applySettings(req.body || {})));
  app.post('/api/profiles', A, h((req) => ({ profile: tj.settings.upsertProfile(req.body || {}) })));
  app.delete('/api/profiles/:id', A, h((req) => { tj.settings.removeProfile(req.params.id); }));
  app.post('/api/join', A, h(async (req) => { await tj.switchServer(String((req.body || {}).id)); }));
  app.post('/api/chat', A, h(async (req) => {
    const text = String((req.body && req.body.text) || '').slice(0, 200);
    if (!text) throw new Error('Empty message.');
    return { reply: await tj.command('dashboard', text) };
  }));
  app.post('/api/action', A, h((req) => {
    const { action, args = {}, player = '' } = req.body || {};
    if (!ACTIONS.includes(action)) throw new Error('Unknown action.');
    if (!tj.skills) throw new Error('Bot is not in the game.');
    tj.act(String(player), action, args, true);
  }));
  app.post('/api/control', A, h((req) => tj.control(req.body.key, req.body.ms)));
  app.post('/api/turn', A, h((req) => tj.turn(req.body.deg)));
  app.post('/api/raw', A, h((req) => tj.rawChat((req.body || {}).text)));
  app.post('/api/equip', A, h((req) => tj.equip((req.body || {}).name)));
  app.post('/api/stop', A, h(() => { if (tj.skills) tj.skills.cancel(); }));
  app.post('/api/detect', A, h(() => tj.redetect()));
  app.post('/api/reconnect', A, h(() => tj.rejoin()));
  app.post('/api/disconnect', A, h(() => tj.disconnect()));
  app.post('/api/via', A, h(async (req) => {
    const { op, line } = req.body || {};
    if (op === 'command') tj.via.send(String(line || ''));
    else if (op === 'account') tj.via.send('account add microsoft');
    else if (op === 'restart') await tj.rejoin();
    else throw new Error('Unknown ViaProxy action.');
  }));

  // user management
  app.get('/api/users', A, (req, res) => res.json({ users: auth.list() }));
  app.post('/api/users', A, h(async (req) => ({ user: await auth.create(req.body || {}) })));
  app.post('/api/users/:id/password', A, h((req) => auth.setPassword(req.params.id, (req.body || {}).password)));
  app.post('/api/users/:id/role', A, h((req) => auth.setRole(req.params.id, (req.body || {}).role)));
  app.delete('/api/users/:id', A, h((req) => {
    if (req.params.id === req.user.id) throw new Error('You cannot delete your own account.');
    auth.remove(req.params.id);
  }));

  // security center
  app.get('/api/security', A, (req, res) => res.json({ ...guard.snapshot(), yourIp: guard.ipOf(req) }));
  app.post('/api/security/block', A, h((req) => {
    const { ip, hours = 24 } = req.body || {};
    if (!net.isIP(String(ip))) throw new Error('That is not a valid IP address.');
    if (ip === guard.ipOf(req)) throw new Error('That is your own IP address.');
    if (guard.isAllowed(ip)) throw new Error('That IP is on the allow list.');
    guard.ban(ip, `blocked by ${req.user.username}`, Math.min(Math.max(+hours || 24, 1), 8760));
  }));
  app.post('/api/security/unblock', A, h((req) => { guard.unban(String((req.body || {}).ip)); guard.forgive(String((req.body || {}).ip)); }));
  app.post('/api/security/enabled', A, h((req) => { guard.enabled = !!(req.body || {}).enabled; guard.log('setting', guard.ipOf(req), `anti-bot ${guard.enabled ? 'on' : 'off'} (${req.user.username})`); }));

  // anything else is a scanner guessing paths
  app.use((req, res) => { guard.strike(guard.ipOf(req), 1, `404 ${req.method} ${req.path.slice(0, 60)}`); res.status(404).json({ error: 'Not found.' }); });
  app.use((err, req, res, next) => {
    if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
      guard.strike(guard.ipOf(req), err.type === 'entity.too.large' ? 5 : 2, `bad request body (${err.type})`);
      return res.status(400).json({ error: 'Bad request.' });
    }
    res.status(500).json({ error: 'Server error.' });
  });

  app.listen(cfg.dashPort, cfg.dashHost, () => console.log(`Dashboard on http://${cfg.dashHost}:${cfg.dashPort}`));
}
module.exports = { start };
