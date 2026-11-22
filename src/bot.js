const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const loadData = require('minecraft-data');
const { Settings } = require('./settings');
const { ViaProxy } = require('./viaproxy');
const { detect } = require('./detect');
const memory = require('./memory');
const { Leveling, STAGES } = require('./leveling');
const { Mover } = require('./movement');
const { Skills } = require('./skills');
const K = require('./knowledge');
const brain = require('./brain');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TJBot {
  constructor() {
    this.mem = memory.load();
    this.settings = new Settings();
    this.via = new ViaProxy((m) => this.log(m));
    this.gen = 0;
    this.state = { status: 'starting', mode: null, msa: null, detect: null, position: null, health: null, food: null,
      dimension: null, inventory: [], entities: [], task: null, level: null, log: [], knowledge: null,
      chat: [], startedAt: Date.now() };
    this.leveling = new Leveling(this.mem, (lvl, st) => {
      this.log(`LEVEL UP: level ${lvl} - stage ${st.n} ${st.name}`);
      this.say(`I reached level ${lvl}! Stage ${st.n}: ${st.name}.`);
    }, this.settings.get().unlockAll);
    this.state.level = this.leveling.snapshot();
    this.bot = null; this.timers = []; this.lastSay = 0; this.fighting = false; this.reconnect = null;
  }

  log(msg) {
    const line = `${new Date().toLocaleTimeString()}  ${msg}`;
    console.log(line);
    this.state.log.push(line); this.state.log = this.state.log.slice(-100);
  }

  say(msg) {
    if (!msg || !this.bot) return;
    const wait = this.lastSay + 1200 - Date.now();
    if (wait > 0) { setTimeout(() => this.say(msg), wait + 50); return; }
    this.lastSay = Date.now();
    this.bot.chat(String(msg).slice(0, 250));
  }

  async redetect() {
    const a = this.settings.active();
    this.state.detect = await detect(a.host, a.port);
    return this.state.detect;
  }

  // Joins the active server. A newer connect()/disconnect() call bumps this.gen, which cancels older ones.
  async connect() {
    clearTimeout(this.reconnect);
    const gen = ++this.gen;
    const S = this.settings.get(), a = this.settings.active();
    this.state.status = 'detecting server';
    const d = await this.redetect();
    if (gen !== this.gen) return;
    let mode = a.mode === 'auto' ? (d.online && d.supported ? 'direct' : 'viaproxy') : a.mode;
    if (!d.online && mode !== 'viaproxy') {
      this.state.status = 'server offline, retrying';
      this.log(`${a.host}:${a.port} is not reachable (${d.error}). Retrying in 15s.`);
      this.reconnect = setTimeout(() => this.connect(), 15000);
      return;
    }
    if (!d.online) this.log('Ping failed, but ViaProxy mode is set so I will try anyway (old and Bedrock servers do not always answer pings).');
    else this.log(`server detected: ${d.name} (version ${d.version}, ${d.players} players). Mode: ${mode}`);
    this.state.mode = mode;

    if (mode === 'viaproxy') {
      this.state.status = 'starting ViaProxy';
      let ok = false;
      try { ok = await this.via.start({ bindPort: S.viaPort, host: a.host, port: a.port, targetVersion: a.targetVersion, auth: S.viaAuth, accountIndex: S.viaAccountIndex }); }
      catch (e) { this.log(e.message); }
      if (gen !== this.gen) return;
      if (!ok) {
        this.state.status = 'ViaProxy not ready, retrying';
        this.log('ViaProxy did not start. Check the ViaProxy log on the dashboard.');
        this.reconnect = setTimeout(() => this.connect(), 20000);
        return;
      }
    } else { await this.via.stop(); if (gen !== this.gen) return; }
    this.state.status = 'connecting';

    const opts = mode === 'viaproxy'
      ? { host: '127.0.0.1', port: S.viaPort, username: S.botName, auth: 'offline', version: S.clientVersion }
      : { host: a.host, port: a.port, username: S.msAccount || S.botName, auth: 'microsoft', version: d.version || undefined,
          profilesFolder: path.join(__dirname, '..', 'auth-cache'),
          onMsaCode: (c) => { this.state.msa = { code: c.user_code, url: c.verification_uri };
            this.log(`Microsoft login needed: open ${c.verification_uri} and enter ${c.user_code}`); } };

    const bot = (this.bot = mineflayer.createBot(opts));
    bot.loadPlugin(pathfinder);
    bot.once('spawn', () => { if (this.bot === bot) this.onSpawn(); });
    bot.on('chat', (user, msg) => this.onChat(user, msg));
    bot.on('kicked', (r) => this.log(`kicked: ${typeof r === 'string' ? r : JSON.stringify(r)}`));
    bot.on('error', (e) => this.log(`error: ${e.message}`));
    bot.on('death', () => this.log('I died. Respawning.'));
    bot.on('end', (why) => { if (this.bot === bot) this.onEnd(why); });
  }

  teardown() {
    this.timers.forEach(clearInterval); this.timers = [];
    if (this.mover) { this.mover.destroy(); this.mover = null; }
    this.skills = null; this.fighting = false;
    memory.save(this.mem);
  }

  onEnd(why) {
    this.log(`disconnected (${why}). Reconnecting in 10s.`);
    this.state.status = 'disconnected';
    this.teardown();
    this.bot = null;
    this.reconnect = setTimeout(() => this.connect(), 10000);
  }

  // Leave the current server on purpose (switching servers, changing settings).
  async disconnect() {
    this.gen++; clearTimeout(this.reconnect);
    const bot = this.bot; this.bot = null;
    this.teardown();
    if (bot) { try { bot.quit('leaving'); } catch {} }
    this.state.status = 'disconnected'; this.state.msa = null;
  }

  async rejoin() { await this.disconnect(); await sleep(500); return this.connect(); }
  async switchServer(id) { this.settings.setActive(id); this.state.entities = []; this.state.inventory = []; return this.rejoin(); }

  onSpawn() {
    const bot = this.bot;
    this.mcData = loadData(bot.version);
    this.state.status = 'online'; this.state.msa = null;
    this.state.knowledge = K.summary(this.mcData);
    this.mover = new Mover(bot, this.mcData, { log: (m) => this.log(m), onWalk100: () => this.leveling.add('walk100'), glance: () => this.settings.get().idleGlance });
    this.skills = new Skills({ bot, mcData: this.mcData, mover: this.mover, leveling: this.leveling, mem: this.mem,
      state: this.state, say: (m) => this.say(m), log: (m) => this.log(m) });
    this.log(`spawned as ${bot.username} on ${bot.version}. Knows ${this.state.knowledge.items} items, ${this.state.knowledge.mobs} mobs, ${this.state.knowledge.recipes} recipes.`);
    this.timers.push(setInterval(() => this.observe(), 1000));
    this.timers.push(setInterval(() => memory.save(this.mem), 10000));
    this.timers.push(setInterval(() => this.leveling.add('survive10min'), 600000));
  }

  // Observation system: position, vitals, inventory, nearby entities. Also where discovery learning happens.
  observe() {
    const bot = this.bot; if (!bot || !bot.entity) return;
    const s = this.state, p = bot.entity.position;
    s.position = { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
    s.health = Math.round(bot.health); s.food = bot.food;
    s.dimension = bot.game && bot.game.dimension;
    s.inventory = bot.inventory.items().map((i) => ({ name: i.name, display: i.displayName, count: i.count }));
    s.entities = Object.values(bot.entities)
      .filter((e) => e !== bot.entity && e.position.distanceTo(p) < 24)
      .map((e) => ({ e, d: e.position.distanceTo(p) })).sort((a, b) => a.d - b.d).slice(0, 12)
      .map(({ e, d }) => ({ ...K.describeEntity(e), distance: Math.round(d), player: e.type === 'player', username: e.username }));

    const D = this.mem.discovered;
    for (const e of s.entities) if (!e.player && e.name !== 'unknown' && !D.mobs.includes(e.name)) {
      D.mobs.push(e.name); this.leveling.add('discoverMob');
      this.log(`learned a new mob: ${e.name} - ${e.look}; ${e.behavior}`);
    }
    for (const i of s.inventory) if (!D.items.includes(i.name)) {
      D.items.push(i.name); this.leveling.add('discoverItem');
      const info = K.itemInfo(this.mcData, i.name);
      this.log(`learned a new item: ${i.display} (stacks to ${info.stackSize}${info.craftable ? ', craftable' : ''})`);
    }
    const looking = bot.blockAtCursor(6);
    for (const b of [looking, bot.blockAt(p.offset(0, -1, 0))]) if (b && !D.blocks.includes(b.name)) {
      D.blocks.push(b.name); this.leveling.add('discoverBlock'); this.log(`learned a new block: ${b.displayName}`);
    }
    s.level = this.leveling.snapshot();

    // self-defense: any hostile mob within 4 blocks gets fought, no matter the level
    if (!this.fighting && this.settings.get().autoDefend) {
      const threat = bot.nearestEntity((e) => K.isHostile(e) && e.position.distanceTo(p) < 4);
      if (threat) {
        this.fighting = true;
        this.skills.fight(threat).catch(() => {}).finally(() => { this.fighting = false; });
      }
    }
  }

  onChat(user, msg) {
    if (!this.bot || user === this.bot.username) return;
    const m = msg.match(new RegExp(`^(?:hey\\s+)?(?:tj[\\s_]*ai|${this.settings.get().botName})\\b[,:!\\s]*(.*)$`, 'i'));
    if (!m) return;
    this.state.chat.push(`${user}: ${m[1]}`); this.state.chat = this.state.chat.slice(-20);
    this.command(user, m[1] || 'status');
  }

  context() {
    const bot = this.bot, s = this.state;
    return { level: s.level.level, stageName: s.level.stageName, position: JSON.stringify(s.position),
      allowed: STAGES.filter((st) => this.leveling.unlockAll || st.n <= s.level.stage).flatMap((st) => st.can),
      nearby: s.entities.slice(0, 6).map((e) => `${e.name}(${e.distance}m)`).join(', ') || 'nothing',
      inventory: s.inventory.slice(0, 12).map((i) => `${i.count} ${i.name}`).join(', ') || 'empty',
      knowledge: JSON.stringify(s.entities.filter((e) => !e.player).slice(0, 4).map((e) => ({ n: e.name, look: e.look, act: e.behavior }))) };
  }

  async command(player, text) {
    if (!this.bot || !this.skills) return 'bot is not online';
    const r = await brain.think(this.settings.get(), this.context(), player, text);
    if (r.error) this.log(`AI brain fallback: ${r.error}`);
    if (r.action !== 'none') this.leveling.add('understood');
    if (r.say) { this.say(r.say); this.leveling.add('chatReply'); }
    this.act(player, r.action, r.args || {});
    return r.say || r.action;
  }

  act(player, action, a, force = false) {
    const S = this.skills;
    if (!S) return;
    if (!force && ['none', 'status'].includes(action) === false && !this.leveling.allowed(action)) {
      const need = STAGES.find((st) => st.can.includes(action));
      return this.say(`I need level ${need ? need.minLevel : '?'} to do that. I am level ${this.leveling.level}.`);
    }
    switch (action) {
      case 'stop': S.cancel(); break;
      case 'follow': S.follow(player); break;
      case 'come': S.come(player); break;
      case 'goto': if ([a.x, a.y, a.z].every(Number.isFinite)) S.goto(a.x, a.y, a.z); break;
      case 'collect_wood': S.collectWood(Math.min(Number(a.count) || 5, 32)); break;
      case 'craft': S.craft(String(a.item || 'planks'), Math.min(Number(a.count) || 1, 64)); break;
      case 'attack': S.attack(); break;
      case 'explore': S.explore(); break;
      case 'status': {
        const l = this.leveling.snapshot(), D = this.mem.discovered;
        this.say(`Level ${l.level}, stage ${l.stage} (${l.stageName}). ${D.items.length} items, ${D.mobs.length} mobs, ${D.blocks.length} blocks learned.`);
        break;
      }
    }
  }

  // ----- dashboard controls -----
  applySettings(patch) {
    const r = this.settings.update(patch);
    this.leveling.unlockAll = this.settings.get().unlockAll;
    if (r.needsReconnect && this.bot) { this.log('settings changed, rejoining the server'); this.rejoin(); }
    return r;
  }

  // Hold a movement key for a short time, like pressing it on a keyboard.
  control(key, ms = 600) {
    const bot = this.bot; if (!bot || !bot.entity) throw new Error('Bot is not in the game.');
    const keys = ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'];
    if (!keys.includes(key)) throw new Error('Unknown control.');
    if (this.skills) this.skills.cancel();
    if (key === 'sneak' || key === 'sprint') { bot.setControlState(key, !bot.controlState[key]); return; }
    bot.setControlState(key, true);
    setTimeout(() => bot.setControlState(key, false), Math.min(Math.max(+ms || 600, 100), 3000));
  }

  turn(deg) {
    const bot = this.bot; if (!bot || !bot.entity) throw new Error('Bot is not in the game.');
    bot.look(bot.entity.yaw + (Math.max(-180, Math.min(180, +deg || 0)) * Math.PI) / 180, bot.entity.pitch, false);
  }

  rawChat(text) {
    if (!this.bot || this.state.status !== 'online') throw new Error('Bot is not in the game.');
    this.bot.chat(String(text).slice(0, 250));
  }

  async equip(name) {
    const item = this.bot && this.bot.inventory.items().find((i) => i.name === name);
    if (!item) throw new Error('Not in inventory.');
    await this.bot.equip(item, 'hand');
  }

  publicState() {
    const D = this.mem.discovered;
    return { ...this.state, uptime: Math.round((Date.now() - this.state.startedAt) / 1000),
      discovered: { items: D.items.length, mobs: D.mobs.length, blocks: D.blocks.length, mobList: D.mobs.slice(-30) },
      records: this.mem.records.slice(-8).reverse(), mistakes: this.mem.mistakes.slice(-5).reverse(),
      stages: STAGES.map((s) => ({ n: s.n, name: s.name, minLevel: s.minLevel })), hasApiKey: !!this.settings.get().apiKey, botName: this.settings.get().botName,
      profiles: this.settings.get().profiles, activeProfile: this.settings.get().activeProfile,
      viaRunning: this.via.running, viaAvailable: this.via.available, viaLog: this.via.lines.slice(-30) };
  }
}
module.exports = { TJBot };
