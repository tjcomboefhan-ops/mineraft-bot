# TJ AI Player

A Minecraft player bot that levels up as it learns, with a protected website to control it.
Say `Hey TJ AI, follow me` in game chat, or use the dashboard.

## Install

**Ubuntu 24.04 LTS (24.04.x):**

    unzip tj-ai.zip && cd tj-ai
    bash install-ubuntu-24.04.sh                       # add  --domain your.domain  for nginx + HTTPS
    sudo systemctl start tj-ai

Installs Java 21, Node.js 22, ViaProxy, the packages, a `.env` with a random admin password, and a
hardened systemd service that runs as a normal user (not root). It never turns the firewall on by
itself (that could lock you out of SSH); if `ufw` is already active it opens the dashboard port.

**Other Ubuntu/Debian versions (20.04+):** `bash install.sh`, then `sudo systemctl start tj-ai`.

Open `http://SERVER-IP:3000` (or your domain). Log in as `admin` with the password the installer printed.
Keep the folder out of `/root` (the service user cannot read it there). Use `/opt/tj-ai` or your home folder.

## Accounts

Only an admin can create accounts. **Admin** has full control. **Viewer** can only look at the bot's
status. Admins manage accounts on the dashboard (create, change role, reset password, delete).
Passwords are hashed with scrypt, need 10+ characters, and sessions last 12 hours.

## Anti-bot protection

Every visitor IP earns strike points for suspicious behavior. 10 points within 10 minutes blocks the IP automatically.

| Behavior | Result |
|---|---|
| Probing for `/.env`, `/wp-login.php`, `/phpmyadmin`, `.php` files, `.git` and similar | Instant block |
| Attack-tool user agents (sqlmap, nikto, nmap, ffuf...) | Instant block |
| Path traversal or injection patterns in the URL | Instant block |
| Filling in the hidden login field (bots do, humans can't see it) | Instant block |
| Wrong password | +2 (so 5 wrong passwords block) |
| Login submitted faster than a human can type | +5 |
| Invalid or expired session token, viewer trying admin actions | +2 each |
| Malformed or oversized requests | +2 / +5 |
| Many unknown URLs (404 scanning) | +1 each |
| More than 300 requests per minute (the dashboard uses about 60) | +6, and a block above 600 |

Bans escalate: 1 hour, then 24 hours, then 7 days. They are saved in `data/blocked.json` and survive restarts.
Admins see blocked IPs and the event log in the Security card, and can unblock or block IPs by hand, or switch the guard off.

- **Add your own IP to `ALLOW_IPS` in `.env`** so you can never lock yourself out. `127.0.0.1` is always allowed.
- **Behind nginx or Cloudflare set `TRUST_PROXY=loopback`.** Without it every visitor looks like 127.0.0.1, which is never blocked.
  `install-ubuntu-24.04.sh --domain ...` sets this for you. Leave it empty when visitors connect directly.
- **Locked out?** On the server: `npm run bans`, `npm run unban -- 1.2.3.4`, `npm run resetpw -- admin NewPassword12`.
- Use HTTPS. Without it, passwords travel in clear text.

## Joining any server version

Add servers on the dashboard (address, port, join mode, version) and press Join.

- **Auto-detect:** the bot pings the server. Versions Mineflayer supports (1.8.8 to 26.1) join directly with Microsoft login.
  Anything else goes through ViaProxy.
- **ViaProxy:** the bot connects as a version Mineflayer knows (default 1.21.4) and ViaProxy translates.
  The bundled ViaProxy lists servers from 1.7 up to 26.3. Server version can stay on `auto`, or be typed, e.g. `1.8.9`.
- **Your Minecraft account in ViaProxy:** Dashboard > ViaProxy > Add Minecraft account, then follow the link and code in its console.
  Never share `viaproxy/saves.json`.

## Dashboard

Animated level ring with count-up numbers, level-up celebration, live status, server profiles, manual controls
(follow, come, fight, explore, collect wood, craft, go to, drive by hand, chat and `/commands`), settings,
ViaProxy console, accounts and the security center. Animations switch off automatically for visitors who set
"reduce motion" in their system.

## Levels

XP comes from walking, discovering items/mobs/blocks, chatting, fighting, collecting logs, crafting, exploring and finishing
tasks. Stages unlock by level: 1 movement, 5 wood, 10 crafting, 16 fighting on command, 25 exploring.
Self-defense works at every level. Dashboard buttons ignore level locks.

## Not built yet

- Seeing rendered pictures of mobs and blocks (appearance comes from text notes for now).
- Building from blueprints and multiple AI players.
- Training model weights (this version uses memory and skill learning).
