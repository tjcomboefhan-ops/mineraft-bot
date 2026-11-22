// Server detection: pings the Minecraft server, reads its version and decides
// whether the bot can join directly or needs ViaProxy to translate the protocol.
const mc = require('minecraft-protocol');
const mineflayer = require('mineflayer');
const loadData = require('minecraft-data');

const cmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
};
// Mineflayer can join natively if the version is one it was tested on, or sits inside its tested range
// and minecraft-data has the game data for it. Anything newer goes through ViaProxy.
function isSupported(v) {
  if (!v) return false;
  if (mineflayer.testedVersions.includes(v)) return true;
  return cmp(v, mineflayer.oldestSupportedVersion) >= 0 && cmp(v, mineflayer.latestSupportedVersion) <= 0 && !!loadData(v);
}

function ping(host, port) {
  return new Promise((resolve, reject) => {
    mc.ping({ host, port, closeTimeout: 8000 }, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

async function detect(host, port) {
  try {
    const r = await ping(host, port);
    const name = (r.version && r.version.name) || 'unknown';
    const m = name.match(/\d+(?:\.\d+){1,2}/);
    const version = m ? m[0] : null;
    const supported = isSupported(version);
    return {
      online: true, name, version, protocol: r.version && r.version.protocol,
      supported, // true = Mineflayer can speak this version itself
      players: r.players ? `${r.players.online}/${r.players.max}` : '?',
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    return { online: false, error: String(err.message || err), checkedAt: new Date().toISOString() };
  }
}

module.exports = { detect };
