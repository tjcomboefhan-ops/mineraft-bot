// Skill library. Each skill is a task the AI can run; every run is recorded in memory so the
// "learning notebook" grows. Failures are saved as mistakes together with the reason.
const { isLog, isHostile, describeEntity } = require('./knowledge');

class Skills {
  constructor({ bot, mcData, mover, leveling, mem, state, say, log }) {
    Object.assign(this, { bot, mcData, mover, leveling, mem, state, say, log });
    this.token = null;
  }

  cancel() {
    if (this.token) this.token.cancelled = true;
    this.mover.stop();
    try { this.bot.stopDigging(); } catch {}
    this.state.task = null;
  }

  async run(name, label, fn) {
    this.cancel();
    const token = (this.token = { cancelled: false });
    this.state.task = { name, label, since: Date.now() };
    this.log(`task started: ${label}`);
    try {
      const result = await fn(token);
      if (!token.cancelled) {
        this.leveling.add('mission');
        this.mem.skills[name] = (this.mem.skills[name] || 0) + 1;
        this.mem.records.push({ n: this.mem.records.length + 1, mission: label, result: result || 'completed', at: new Date().toISOString() });
        this.mem.records = this.mem.records.slice(-200);
        this.log(`task done: ${label}${result ? ' - ' + result : ''}`);
      }
    } catch (err) {
      this.mem.mistakes.push({ mission: label, error: String(err.message || err), at: new Date().toISOString() });
      this.mem.mistakes = this.mem.mistakes.slice(-100);
      this.log(`task failed: ${label} (${err.message || err})`);
      this.say(`I could not finish: ${label}. ${err.message || ''}`.slice(0, 200));
    } finally {
      if (this.token === token) { this.state.task = null; }
    }
  }

  playerEntity(name) { return this.bot.players[name] && this.bot.players[name].entity; }

  follow(name) {
    const e = this.playerEntity(name);
    if (!e) return this.say(`I cannot see ${name}.`);
    this.cancel();
    this.state.task = { name: 'follow', label: `following ${name}`, since: Date.now() };
    this.mover.follow(e, 3);
  }

  come(name) {
    const e = this.playerEntity(name);
    if (!e) return this.say(`I cannot see ${name}.`);
    return this.run('come', `walk to ${name}`, async () => {
      await this.mover.goto(e.position.x, e.position.y, e.position.z, 2);
    });
  }

  goto(x, y, z) {
    return this.run('goto', `go to ${x} ${y} ${z}`, async () => { await this.mover.goto(x, y, z, 1); });
  }

  collectWood(count = 5) {
    return this.run('collect_wood', `collect ${count} logs`, async (t) => {
      let got = 0, misses = 0;
      while (got < count && !t.cancelled && misses < 3) {
        const found = this.bot.findBlock({ matching: (b) => isLog(b), maxDistance: 48 });
        if (!found) { misses++; this.say('No trees close by, looking around.'); await this.exploreLeg(t); continue; }
        await this.mover.goto(found.position.x, found.position.y, found.position.z, 2);
        const block = this.bot.blockAt(found.position);
        if (!block || !isLog(block)) continue;
        await this.bot.lookAt(block.position.offset(0.5, 0.5, 0.5), false);
        await this.bot.dig(block);
        got++; this.leveling.add('collectLog');
        await this.mover.goto(found.position.x, found.position.y, found.position.z, 1).catch(() => {});
      }
      if (got === 0) throw new Error('found no trees');
      return `collected ${got} logs`;
    });
  }

  craft(itemName, count = 1) {
    return this.run('craft', `craft ${count} ${itemName}`, async () => {
      const names = itemName === 'planks'
        ? Object.keys(this.mcData.itemsByName).filter((n) => n.endsWith('_planks')) : [itemName];
      for (const n of names) {
        const item = this.mcData.itemsByName[n];
        if (!item) continue;
        let table = null;
        let recipe = this.bot.recipesFor(item.id, null, 1, null)[0];
        if (!recipe) {
          const t = this.bot.findBlock({ matching: this.mcData.blocksByName.crafting_table.id, maxDistance: 32 });
          if (t) { await this.mover.goto(t.position.x, t.position.y, t.position.z, 3); table = this.bot.blockAt(t.position);
            recipe = this.bot.recipesFor(item.id, null, 1, table)[0]; }
        }
        if (!recipe) continue;
        await this.bot.craft(recipe, count, table);
        this.leveling.add('craft');
        return `crafted ${count} ${n}`;
      }
      throw new Error(`no recipe I can make right now for ${itemName} (missing materials or crafting table)`);
    });
  }

  attack() {
    return this.run('attack', 'fight nearby hostile mob', async (t) => {
      const target = this.bot.nearestEntity((e) => isHostile(e) && e.position.distanceTo(this.bot.entity.position) < 20);
      if (!target) return 'nothing hostile nearby';
      await this.fight(target, t);
    });
  }

  async fight(target, t = { cancelled: false }) {
    const bot = this.bot;
    const weapon = bot.inventory.items().find((i) => /sword$/.test(i.name)) || bot.inventory.items().find((i) => /axe$/.test(i.name));
    if (weapon) await bot.equip(weapon, 'hand').catch(() => {});
    const start = Date.now();
    while (!t.cancelled && target.isValid && Date.now() - start < 30000) {
      const d = bot.entity.position.distanceTo(target.position);
      if (d > 3) this.mover.follow(target, 2);
      else { this.mover.stop(); await bot.lookAt(target.position.offset(0, target.height * 0.85, 0), false); bot.attack(target); this.leveling.add('defend'); }
      await new Promise((r) => setTimeout(r, 550)); // roughly a player's attack cooldown
    }
    this.mover.stop();
    if (!target.isValid) { this.leveling.add('killMob'); this.log(`defeated ${describeEntity(target).name}`); }
  }

  async exploreLeg(t) {
    const p = this.bot.entity.position, a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 40;
    const x = Math.round(p.x + Math.cos(a) * d), z = Math.round(p.z + Math.sin(a) * d);
    await this.mover.gotoXZ(x, z, 60000).catch(() => {});
    const key = `${x >> 4},${z >> 4}`;
    if (!this.mem.visitedChunks.includes(key)) { this.mem.visitedChunks.push(key); this.leveling.add('explore'); }
    this.mem.visitedChunks = this.mem.visitedChunks.slice(-2000);
  }

  explore() {
    return this.run('explore', 'explore the world', async (t) => {
      for (let i = 0; i < 5 && !t.cancelled; i++) await this.exploreLeg(t);
      return `explored, ${this.mem.visitedChunks.length} chunks known`;
    });
  }
}
module.exports = { Skills };
