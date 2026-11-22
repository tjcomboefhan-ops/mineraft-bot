// npm run detect  -> prints what the bot sees on your server
const cfg = require('./config');
require('./detect').detect(cfg.host, cfg.port).then((d) => {
  console.log(JSON.stringify(d, null, 2));
  if (d.online) console.log(d.supported ? 'Mineflayer supports this version: direct mode works.' : 'Version not supported by Mineflayer: use ViaProxy mode.');
});
