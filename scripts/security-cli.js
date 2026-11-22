// Emergency tools, run on the server:
//   npm run bans                     list blocked IPs
//   npm run unban -- 1.2.3.4         unblock an IP (works while the service is running)
//   npm run resetpw -- admin NewPassword12   reset a dashboard password (restart the service afterwards)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const D = path.join(__dirname, '..', 'data');
const [cmd, a, b] = process.argv.slice(2);
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); } catch { return d; } };
const write = (f, o) => fs.writeFileSync(path.join(D, f), JSON.stringify(o, null, 2), { mode: 0o600 });

if (cmd === 'list') {
  const j = read('blocked.json', { blocked: {} });
  const rows = Object.entries(j.blocked);
  if (!rows.length) console.log('No blocked IPs.');
  for (const [ip, x] of rows) console.log(`${ip}  until ${new Date(x.until).toLocaleString()}  ${x.reason}`);
} else if (cmd === 'unban' && a) {
  const j = read('blocked.json', { blocked: {}, history: {} });
  if (j.blocked[a]) { delete j.blocked[a]; delete (j.history || {})[a]; write('blocked.json', j); console.log(`Unblocked ${a}.`); } else console.log(`${a} is not blocked.`);
} else if (cmd === 'resetpw' && a && b) {
  if (b.length < 10) { console.log('Password must be at least 10 characters.'); process.exit(1); }
  const j = read('users.json', { users: [] });
  const u = j.users.find((x) => x.username.toLowerCase() === a.toLowerCase());
  if (!u) { console.log('No such user.'); process.exit(1); }
  const salt = crypto.randomBytes(16);
  u.salt = salt.toString('hex'); u.hash = crypto.scryptSync(b, salt, 64).toString('hex');
  write('users.json', j); console.log(`Password changed for ${u.username}. Restart the service: sudo systemctl restart tj-ai`);
} else console.log('Usage: npm run bans | npm run unban -- <ip> | npm run resetpw -- <user> <new password>');
