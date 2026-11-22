// Self-training level system. XP comes from doing real things, with cooldowns so it cannot be farmed.
const XP = {
  walk100: 5,
  discoverItem: 10, discoverMob: 15, discoverBlock: 4,
  chatReply: 8, understood: 4,
  killMob: 20, defend: 4,
  collectLog: 3, craft: 10,
  explore: 12, mission: 50, survive10min: 20,
};
const COOLDOWN = { chatReply: 4000, defend: 3000, understood: 4000 };

const STAGES = [
  { n: 1, minLevel: 1,  name: "Basic Movement",        can: ["stop", "follow", "come", "goto"] },
  { n: 2, minLevel: 5,  name: "Resource Learning",     can: ["collect_wood"] },
  { n: 3, minLevel: 10, name: "Crafting Intelligence", can: ["craft"] },
  { n: 4, minLevel: 16, name: "Building Intelligence", can: ["attack"] },
  { n: 5, minLevel: 25, name: "Independent Player",    can: ["explore"] },
];
const levelFor = (xp) => 1 + Math.floor(Math.sqrt(xp / 40));
const xpForLevel = (l) => 40 * (l - 1) * (l - 1);

class Leveling {
  constructor(mem, onLevelUp, unlockAll) {
    this.mem = mem; this.onLevelUp = onLevelUp; this.unlockAll = unlockAll; this.last = {};
  }
  get level() { return levelFor(this.mem.xp); }
  get stage() { return [...STAGES].reverse().find((s) => this.level >= s.minLevel) || STAGES[0]; }
  allowed(action) {
    if (this.unlockAll) return true;
    return STAGES.filter((s) => s.n <= this.stage.n).some((s) => s.can.includes(action));
  }
  add(kind, times = 1) {
    const cd = COOLDOWN[kind];
    if (cd && Date.now() - (this.last[kind] || 0) < cd) return 0;
    this.last[kind] = Date.now();
    const before = this.level;
    const gain = (XP[kind] || 0) * times;
    this.mem.xp += gain;
    this.mem.counters[kind] = (this.mem.counters[kind] || 0) + times;
    if (this.level > before) this.onLevelUp(this.level, this.stage);
    return gain;
  }
  snapshot() {
    const l = this.level, lo = xpForLevel(l), hi = xpForLevel(l + 1);
    return { level: l, xp: this.mem.xp, intoLevel: this.mem.xp - lo, levelSize: hi - lo,
      stage: this.stage.n, stageName: this.stage.name, unlockAll: this.unlockAll,
      nextStage: STAGES.find((s) => s.n === this.stage.n + 1) || null, counters: this.mem.counters };
  }
}
module.exports = { Leveling, STAGES };
