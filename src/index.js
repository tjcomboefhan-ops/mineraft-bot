const cfg = require('./config');
const memory = require('./memory');
const { TJBot } = require('./bot');
const dashboard = require('./dashboard');
const { Guard } = require('./guard');
const { Auth } = require('./auth');

const tj = new TJBot();
const guard = new Guard({ allow: cfg.allowIps, onBan: (ip, why, ms) => tj.log(`SECURITY: blocked ${ip} for ${Math.round(ms / 3600000)}h - ${why}`) });
const auth = new Auth();
auth.init(cfg, (m) => tj.log(m)).then(() => {
  dashboard.start(tj, cfg, guard, auth);
  tj.connect();
});

const killVia = () => { try { tj.via.proc && tj.via.proc.kill(); } catch {} };
process.on('exit', killVia);
const bye = () => { memory.save(tj.mem); killVia(); process.exit(0); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);
process.on('unhandledRejection', (e) => tj.log(`unhandled: ${e && e.message ? e.message : e}`));
process.on('uncaughtException', (e) => tj.log(`uncaught: ${e.message}`));
