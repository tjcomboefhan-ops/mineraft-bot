// Item + mob intelligence. Item facts come straight from minecraft-data (every item, stack size,
// recipe). Mob appearance/behaviour notes are written by hand for the common mobs; everything else
// falls back to what the game reports (name, size, hostile/passive).
const MOBS = {
  zombie:   { look: 'green skin, blue shirt, arms out front', act: 'walks straight at players; burns in daylight', hostile: true },
  skeleton: { look: 'bony grey humanoid with a bow', act: 'keeps its distance and shoots arrows; strafes', hostile: true },
  creeper:  { look: 'tall green four-legged mob, no arms', act: 'silently approaches, hisses, then explodes', hostile: true },
  spider:   { look: 'wide black body, red eyes', act: 'climbs walls, jumps at players; calm in daylight', hostile: true },
  enderman: { look: 'very tall black mob with purple eyes', act: 'teleports; angry if you look at its face', hostile: false },
  witch:    { look: 'purple hat, robe, long nose', act: 'throws potions from range', hostile: true },
  slime:    { look: 'bouncing green cube', act: 'hops toward players, splits when hit', hostile: true },
  drowned:  { look: 'teal zombie from the water', act: 'swims, sometimes throws tridents', hostile: true },
  phantom:  { look: 'flying blue-grey membrane creature', act: 'dive-bombs players who have not slept', hostile: true },
  villager: { look: 'big nose, robe, profession outfit', act: 'wanders, trades, goes inside at night', hostile: false },
  iron_golem: { look: 'huge iron humanoid with vines', act: 'protects villages from hostile mobs', hostile: false },
  cow:      { look: 'brown and white with horns', act: 'wanders slowly; drops leather and beef', hostile: false },
  pig:      { look: 'pink with a snout', act: 'wanders; drops porkchop', hostile: false },
  sheep:    { look: 'woolly body, many colours', act: 'wanders; drops wool and mutton', hostile: false },
  chicken:  { look: 'small white bird', act: 'flaps, lays eggs; drops feathers', hostile: false },
  wolf:     { look: 'grey dog-like mob', act: 'neutral until attacked; tameable with bones', hostile: false },
};

function describeEntity(e) {
  const name = (e.name || e.displayName || 'unknown').toString();
  const n = MOBS[name];
  const hostile = n ? n.hostile : (e.type === 'hostile' || e.kind === 'Hostile mobs');
  return { name, hostile, look: n ? n.look : 'unknown look', behavior: n ? n.act : 'behaviour not learned yet',
    known: !!n, height: e.height, width: e.width };
}

function itemInfo(mcData, nameOrId) {
  const it = typeof nameOrId === 'number' ? mcData.items[nameOrId] : mcData.itemsByName[nameOrId];
  if (!it) return null;
  const recipes = (mcData.recipes[it.id] || []).length;
  return { id: it.id, name: it.name, displayName: it.displayName, stackSize: it.stackSize, craftable: recipes > 0, recipes };
}

function summary(mcData) {
  return {
    items: Object.keys(mcData.itemsByName).length,
    blocks: Object.keys(mcData.blocksByName).length,
    mobs: Object.keys(mcData.entitiesByName).length,
    recipes: Object.keys(mcData.recipes).length,
  };
}

function isLog(block) { return block && /_(log|stem)$/.test(block.name) && !block.name.startsWith('stripped'); }
function isHostile(e) { return describeEntity(e).hostile && e.type !== 'player'; }

module.exports = { MOBS, describeEntity, itemInfo, summary, isLog, isHostile };
