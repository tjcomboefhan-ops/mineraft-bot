// Memory file + backup file. Atomic writes so a crash never corrupts the memory.
const fs = require("fs");
const path = require("path");
const DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DIR, "memory.json");
const BACKUP = path.join(DIR, "memory.backup.json");
const blank = () => ({ xp: 0, counters: {}, discovered: { items: [], mobs: [], blocks: [] },
  places: {}, skills: {}, records: [], mistakes: [], visitedChunks: [] });

function load() {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of [FILE, BACKUP]) {
    try { return Object.assign(blank(), JSON.parse(fs.readFileSync(f, "utf8"))); } catch {}
  }
  return blank();
}
let lastBackup = 0;
function save(mem) {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(mem, null, 2));
  fs.renameSync(tmp, FILE);
  if (Date.now() - lastBackup > 30000) { fs.copyFileSync(FILE, BACKUP); lastBackup = Date.now(); }
}
module.exports = { load, save };
