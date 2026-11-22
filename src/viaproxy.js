// Runs ViaProxy as a child process so the dashboard can point it at any server and version
// (ViaProxy translates between the bot's version and the server's, from 1.0 up to the newest it supports).
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const DIR = path.join(__dirname, '..', 'viaproxy');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port, timeout: 800 });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.once('timeout', () => { s.destroy(); resolve(false); });
  });
}

class ViaProxy {
  constructor(log) { this.log = log; this.proc = null; this.lines = []; this.target = null; }

  jar() {
    try { const f = fs.readdirSync(DIR).find((n) => /^ViaProxy.*\.jar$/i.test(n)); return f ? path.join(DIR, f) : null; } catch { return null; }
  }
  get available() { return !!this.jar(); }
  get running() { return !!this.proc; }

  push(line) {
    line = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (!line || /^(\[[^\]]*\] [^:]*: )?\s*at /.test(line) || /\[STDERR\]: \s*at /.test(line)) return; // skip Java stack-trace noise
    this.lines.push(line); this.lines = this.lines.slice(-60);
  }

  // Starts (or restarts) ViaProxy for one target server. Resolves true once its port accepts connections.
  async start({ bindPort, host, port, targetVersion, auth, accountIndex = 0 }) {
    await this.stop();
    const jar = this.jar();
    if (!jar) throw new Error('ViaProxy jar not found. Re-run install.sh.');
    fs.writeFileSync(path.join(DIR, 'viaproxy.yml'),
      `bind-address: 127.0.0.1:${bindPort}\ntarget-address: ${host}:${port}\ntarget-version: ${targetVersion || 'auto'}\nauth-method: ${auth === 'none' ? 'none' : 'account'}\nminecraft-account-index: ${accountIndex | 0}\n`);
    this.target = `${host}:${port}`;
    const p = (this.proc = spawn('java', ['-jar', jar, 'config', 'viaproxy.yml'], { cwd: DIR }));
    const feed = (d) => String(d).split('\n').forEach((l) => this.push(l));
    p.stdout.on('data', feed); p.stderr.on('data', feed);
    p.on('exit', (code) => { this.push(`ViaProxy exited (${code})`); if (this.proc === p) this.proc = null; });
    p.on('error', (e) => { this.push(`could not start Java: ${e.message}`); if (this.proc === p) this.proc = null; });
    for (let i = 0; i < 60; i++) {           // wait up to ~30s for ViaProxy to listen
      if (!this.proc) return false;
      if (await portOpen(bindPort)) { this.log(`ViaProxy ready -> ${host}:${port} (version ${targetVersion || 'auto'})`); return true; }
      await sleep(500);
    }
    return false;
  }

  async stop() {
    const p = this.proc; if (!p) return;
    this.proc = null;
    await new Promise((resolve) => { p.once('exit', resolve); try { p.stdin.write('stop\n'); } catch {} setTimeout(() => { try { p.kill('SIGKILL'); } catch {} resolve(); }, 3000); });
  }

  // Sends one line to the ViaProxy console, e.g. "account add microsoft".
  send(line) {
    if (!this.proc) throw new Error('ViaProxy is not running.');
    this.push(`> ${line}`);
    this.proc.stdin.write(String(line).slice(0, 200) + '\n');
  }
}
module.exports = { ViaProxy };
