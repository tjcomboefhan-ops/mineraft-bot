// The brain. The language model only ever chooses from a fixed list of actions (it cannot run
// arbitrary code), and the leveling system decides which actions are unlocked yet.
const ACTIONS = ['none', 'follow', 'come', 'goto', 'stop', 'collect_wood', 'craft', 'attack', 'explore', 'status'];

function systemPrompt(ctx) {
  return `You are TJ AI, a friendly player-bot inside a Minecraft server. Keep replies under 200 characters.
Reply with ONLY a JSON object: {"say": "<chat reply>", "action": "<one of ${ACTIONS.join('|')}>", "args": {}}
args: goto {x,y,z} | craft {item, count} | collect_wood {count}.
Unlocked actions right now: ${ctx.allowed.join(', ')}. If the player asks for something that is not unlocked, say you need to level up first.
You are level ${ctx.level} (${ctx.stageName}). Position: ${ctx.position}. Nearby: ${ctx.nearby}. Inventory: ${ctx.inventory}.
If asked about an item or mob, answer from this knowledge: ${ctx.knowledge}`;
}

// Used when there is no API key or the API fails, so the bot still understands basic commands.
function ruleParse(text) {
  const t = text.toLowerCase();
  const num = (re, d) => { const m = t.match(re); return m ? parseInt(m[1], 10) : d; };
  if (/\b(stop|halt|wait)\b/.test(t)) return { say: 'Stopping.', action: 'stop', args: {} };
  if (/follow me|follow/.test(t)) return { say: 'Following you!', action: 'follow', args: {} };
  if (/\bcome\b|come here|over here/.test(t)) return { say: 'On my way.', action: 'come', args: {} };
  if (/(wood|log|tree)/.test(t)) return { say: 'Getting wood.', action: 'collect_wood', args: { count: num(/(\d+)/, 5) } };
  if (/planks/.test(t)) return { say: 'Crafting planks.', action: 'craft', args: { item: 'planks', count: 4 } };
  if (/craft(ing)? table|workbench/.test(t)) return { say: 'Making a crafting table.', action: 'craft', args: { item: 'crafting_table', count: 1 } };
  if (/(fight|attack|kill|defend)/.test(t)) return { say: 'Fighting!', action: 'attack', args: {} };
  if (/(explore|look around)/.test(t)) return { say: 'Exploring.', action: 'explore', args: {} };
  const c = t.match(/(-?\d+)[ ,]+(-?\d+)[ ,]+(-?\d+)/);
  if (/(go to|goto|walk to)/.test(t) && c) return { say: 'Heading there.', action: 'goto', args: { x: +c[1], y: +c[2], z: +c[3] } };
  if (/(status|how are you|level)/.test(t)) return { say: '', action: 'status', args: {} };
  return { say: 'I am still learning. Try: follow me, come, collect wood, status.', action: 'none', args: {} };
}

async function think(cfg, ctx, player, text) {
  if (!cfg.apiKey) return ruleParse(text);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, max_tokens: 300,
        messages: [{ role: 'system', content: systemPrompt(ctx) }, { role: 'user', content: `${player}: ${text}` }] }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const raw = (data.choices && data.choices[0] && data.choices[0].message.content) || '';
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    if (!ACTIONS.includes(json.action)) json.action = 'none';
    return { say: String(json.say || '').slice(0, 220), action: json.action, args: json.args || {} };
  } catch (err) {
    const r = ruleParse(text);
    r.error = String(err.message || err);
    return r;
  }
}
module.exports = { think, ruleParse, ACTIONS };
