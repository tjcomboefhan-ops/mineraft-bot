// Anti-bot guard for the dashboard.
// Every IP earns "strike points" for suspicious behaviour. At 10 points inside 10 minutes the IP is
// blocked automatically. Some behaviour (probing for /.env, filling the hidden login field, running
// attack tools) is an instant block. Bans escalate: 1 hour, then 24 hours, then 7 days.
// Blocks are saved in data/blocked.json, and survive restarts. Loopback and ALLOW_IPS are never blocked.
const fs = require('fs');
const path = require('path');
const net = require('net');

const FILE = path.join(__dirname, '..', 'data', 'blocked.json');
const HOUR = 3600 * 1000;
const WINDOW = 10 * 60 * 1000;      // strikes expire after 10 minutes of good behaviour
const THRESHOLD = 10;
const DURATIONS = [1 * HOUR, 24 * HOUR, 7 * 24 * HOUR];
const RATE_LIMIT = 300;             // requests per minute per IP (the dashboard itself uses about 60)

const ATTACK_TOOLS = /(sqlmap|nikto|nmap|masscan|zgrab|gobuster|dirbuster|dirb\b|wpscan|nuclei|acunetix|havij|netsparker|hydra|fuzz faster|ffuf|burp|metasploit|openvas|w3af)/i;
const HONEYPOT = /^\/(\.env|\.git|\.svn|\.aws|\.ssh|\.ds_store|wp-login|wp-admin|wp-content|wp-includes|xmlrpc|phpmyadmin|pma\b|myadmin|administrator|cgi-bin|server-status|actuator|boaform|hnap1|setup\.cgi|vendor\/phpunit|solr|jenkins|console\b|manager\/html|owa\b|autodiscover|remote\/login)|\.(php\d?|asp|aspx|jsp|cgi|env|bak|old|sql|swp|ini|yml|yaml)$/i;
const TRAVERSAL = /(\.\.[\/\\]|%2e%2e|%252e|%00|\\x00|\/etc\/passwd|\/proc\/self|<script|union\s+select)/i;

// ::ffff:1.2.3.4 -> 1.2.3.4
const clean = (ip) => String(ip || '').replace(/^::ffff:/, '');

class Guard {
  constructor({ allow = [], onBan = () => {} } = {}) {
    this.allow = new Set(['127.0.0.1', '::1', ...allow]);
    this.onBan = onBan;
    this.strikes = new Map();    // ip -> { score, first }
    this.rate = new Map();       // ip -> { n, minute }
    this.blocked = new Map();    // ip -> { until, reason, at, count }
    this.history = {};           // ip -> number of bans so far
    this.events = [];
    this.enabled = true;
    this.mtime = 0; this.lastCheck = 0;
    this.load();
    setInterval(() => this.prune(), 60 * 1000).unref();
  }

  // ---------- storage ----------
  load() {
    try {
      const st = fs.statSync(FILE); this.mtime = st.mtimeMs;
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      this.blocked = new Map(Object.entries(j.blocked || {}));
      this.history = j.history || {};
    } catch { /* first run */ }
  }
  save() {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ blocked: Object.fromEntries(this.blocked), history: this.history }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
    this.mtime = fs.statSync(FILE).mtimeMs;
  }
  // picks up changes made by `npm run unban` while the service is running
  refresh() {
    if (Date.now() - this.lastCheck < 5000) return;
    this.lastCheck = Date.now();
    try { if (fs.statSync(FILE).mtimeMs !== this.mtime) this.load(); } catch {}
  }
  prune() {
    const now = Date.now();
    for (const [ip, s] of this.strikes) if (now - s.first > WINDOW) this.strikes.delete(ip);
    for (const [ip, r] of this.rate) if (now - r.minute > 120000) this.rate.delete(ip);
    let dirty = false;
    for (const [ip, b] of this.blocked) if (b.until <= now) { this.blocked.delete(ip); dirty = true; }
    if (dirty) this.save();
    if (this.strikes.size > 5000) this.strikes.clear();
  }

  log(type, ip, detail) {
    this.events.push({ t: Date.now(), type, ip, detail: String(detail).slice(0, 160) });
    if (this.events.length > 200) this.events.shift();
  }

  // ---------- decisions ----------
  ipOf(req) { return clean(req.ip || (req.socket && req.socket.remoteAddress)); }
  isAllowed(ip) { return this.allow.has(ip); }
  isBlocked(ip) {
    this.refresh();
    const b = this.blocked.get(ip);
    if (!b) return null;
    if (b.until <= Date.now()) { this.blocked.delete(ip); this.save(); return null; }
    return b;
  }

  strike(ip, points, reason) {
    if (!this.enabled || this.isAllowed(ip)) return;
    const now = Date.now();
    let s = this.strikes.get(ip);
    if (!s || now - s.first > WINDOW) s = { score: 0, first: now };
    s.score += points; this.strikes.set(ip, s);
    this.log('strike', ip, `+${points} ${reason} (total ${s.score}/${THRESHOLD})`);
    if (s.score >= THRESHOLD) this.ban(ip, `suspicious activity: ${reason}`);
  }

  ban(ip, reason, hours) {
    if (this.isAllowed(ip) || !net.isIP(ip)) return false;
    const n = (this.history[ip] = (this.history[ip] || 0) + 1);
    const ms = hours ? hours * HOUR : DURATIONS[Math.min(n - 1, DURATIONS.length - 1)];
    this.blocked.set(ip, { until: Date.now() + ms, reason: String(reason).slice(0, 160), at: Date.now(), count: n });
    this.strikes.delete(ip);
    this.save();
    this.log('block', ip, `${reason} (ban #${n}, ${Math.round(ms / HOUR)}h)`);
    this.onBan(ip, reason, ms);
    return true;
  }

  unban(ip) {
    const had = this.blocked.delete(ip);
    this.strikes.delete(ip);
    if (had) { this.save(); this.log('unblock', ip, 'unblocked by admin'); }
    return had;
  }
  reset(ip) { this.strikes.delete(ip); }                       // after a good login
  forgive(ip) { delete this.history[ip]; this.save(); }

  snapshot() {
    this.refresh();
    return {
      enabled: this.enabled, threshold: THRESHOLD,
      allow: [...this.allow],
      blocked: [...this.blocked.entries()].map(([ip, b]) => ({ ip, ...b })).sort((a, b) => b.at - a.at),
      events: this.events.slice(-60).reverse(),
    };
  }

  // ---------- Express middleware (runs before everything else) ----------
  middleware() {
    return (req, res, next) => {
      const ip = this.ipOf(req);
      const b = this.isBlocked(ip);
      if (b) {
        res.status(403).type('text/plain').send('Your IP address has been blocked because of suspicious activity. Contact the administrator.');
        return;
      }
      if (!this.enabled || this.isAllowed(ip)) return next();

      const url = req.originalUrl || req.url || '';
      const ua = String(req.headers['user-agent'] || '');
      let p = url.split('?')[0];
      try { p = decodeURIComponent(p); } catch { this.strike(ip, 10, 'malformed URL encoding'); }

      if (ATTACK_TOOLS.test(ua)) this.ban(ip, `attack tool user-agent: ${ua.slice(0, 40)}`);
      else if (TRAVERSAL.test(url) || TRAVERSAL.test(p)) this.ban(ip, `attack pattern in URL: ${p.slice(0, 50)}`);
      else if (HONEYPOT.test(p)) this.ban(ip, `probing for ${p.slice(0, 50)}`);
      else if (!['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'].includes(req.method)) this.strike(ip, 5, `unusual method ${req.method}`);

      // request rate
      const now = Date.now();
      let r = this.rate.get(ip);
      if (!r || now - r.minute > 60000) r = { n: 0, minute: now };
      r.n++; this.rate.set(ip, r);
      if (r.n === RATE_LIMIT + 1) this.strike(ip, 6, `more than ${RATE_LIMIT} requests in a minute`);
      if (r.n > RATE_LIMIT * 2) this.ban(ip, 'request flood');

      if (this.isBlocked(ip)) {
        res.status(403).type('text/plain').send('Your IP address has been blocked because of suspicious activity. Contact the administrator.');
        return;
      }
      next();
    };
  }
}
module.exports = { Guard, clean };
