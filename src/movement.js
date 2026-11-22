// Realistic movement. Minecraft physics + A* pathfinding, with the things that make a bot look
// like a player: sprinting, parkour, smooth head turns, glancing around when idle, and recovering
// when it gets stuck (jump, strafe, re-path, then give up and report instead of spinning forever).
const { Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear, GoalFollow, GoalXZ } = goals;

const withTimeout = (p, ms, onTimeout) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => { onTimeout && onTimeout(); rej(new Error('path timeout')); }, ms))]);

class Mover {
  constructor(bot, mcData, hooks) {
    this.bot = bot; this.hooks = hooks; // hooks: { onWalk100(), log(msg) }
    const mv = new Movements(bot, mcData);
    mv.canDig = true; mv.allowSprinting = true; mv.allowParkour = true;
    bot.pathfinder.setMovements(mv);
    this.last = null; this.walked = 0; this.stuckSince = 0; this.tries = 0; this.nextGlance = 0;
    this.timer = setInterval(() => this.tick(), 500);
  }

  stop() { this.bot.pathfinder.setGoal(null); this.bot.clearControlStates(); }
  destroy() { clearInterval(this.timer); }

  async goto(x, y, z, range = 1, ms = 60000) {
    const goal = new GoalNear(x, y, z, range);
    return withTimeout(this.bot.pathfinder.goto(goal), ms, () => this.stop());
  }
  async gotoXZ(x, z, ms = 60000) {
    return withTimeout(this.bot.pathfinder.goto(new GoalXZ(x, z)), ms, () => this.stop());
  }
  follow(entity, range = 3) { this.bot.pathfinder.setGoal(new GoalFollow(entity, range), true); }

  tick() {
    const bot = this.bot;
    if (!bot.entity) return;
    const p = bot.entity.position;
    if (this.last) {
      const d = Math.hypot(p.x - this.last.x, p.z - this.last.z);
      if (d < 20) { this.walked += d; while (this.walked >= 100) { this.walked -= 100; this.hooks.onWalk100(); } }
    }
    const moving = bot.pathfinder.goal && bot.pathfinder.isMoving();
    if (bot.pathfinder.goal) {
      // stuck detection: wants to move but has barely moved for ~4 seconds
      if (this.last && p.distanceTo(this.last) < 0.15) {
        this.stuckSince = this.stuckSince || Date.now();
        if (Date.now() - this.stuckSince > 4000) this.recover();
      } else { this.stuckSince = 0; this.tries = 0; }
    } else { this.stuckSince = 0; }
    this.last = p.clone();
    if (!moving && this.hooks.glance()) this.glance();
  }

  recover() {
    const bot = this.bot; this.stuckSince = Date.now(); this.tries++;
    this.hooks.log(`stuck, recovery attempt ${this.tries}`);
    if (this.tries > 3) { this.tries = 0; this.stop(); this.hooks.log('gave up on this path'); return; }
    const goal = bot.pathfinder.goal;
    bot.setControlState('jump', true);
    bot.setControlState(this.tries % 2 ? 'left' : 'right', true);
    setTimeout(() => { bot.setControlState('jump', false); bot.setControlState('left', false); bot.setControlState('right', false);
      if (goal) bot.pathfinder.setGoal(goal, !!goal.dynamic); }, 400);
  }

  // Idle behaviour: look at a nearby player, otherwise drift the camera a little (smooth, not instant).
  glance() {
    const bot = this.bot;
    if (Date.now() < this.nextGlance) return;
    this.nextGlance = Date.now() + 2500 + Math.random() * 4500;
    const near = bot.nearestEntity((e) => e.type === 'player' && e.position.distanceTo(bot.entity.position) < 8);
    if (near && Math.random() < 0.6) { bot.lookAt(near.position.offset(0, near.height * 0.9, 0), false); return; }
    bot.look(bot.entity.yaw + (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.5, false);
  }
}
module.exports = { Mover, GoalNear };
