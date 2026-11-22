#!/usr/bin/env bash
# TJ AI installer for Ubuntu (and Debian-based systems). Run:  bash install.sh
# It installs Node.js 18+, Java, ViaProxy, the bot's packages, creates .env and systemd services.
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
say()  { printf '\n\033[1;35m[TJ AI]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*"; exit 1; }

. /etc/os-release 2>/dev/null || true
say "Detected: ${PRETTY_NAME:-unknown Linux} ($(uname -m))"
command -v apt-get >/dev/null || die "This installer needs apt (Ubuntu/Debian)."

# ---------- 1. base packages ----------
say "Installing base packages"
$SUDO apt-get update -y || warn "apt update had errors, continuing"
$SUDO apt-get install -y curl ca-certificates unzip jq git build-essential python3 openssl || warn "some base packages failed"

# ---------- 2. Node.js 18+ ----------
node_major() { command -v node >/dev/null && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ "$(node_major)" -lt 18 ]; then
  say "Installing Node.js 20"
  if curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash - && $SUDO apt-get install -y nodejs; then :; else
    warn "NodeSource failed, trying nvm"
    export NVM_DIR="$HOME/.nvm"
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    . "$NVM_DIR/nvm.sh" && nvm install 20 && nvm alias default 20
  fi
fi
[ "$(node_major)" -ge 18 ] || die "Could not get Node.js 18+. On very old Ubuntu (18.04 or older) upgrade the OS or use Ubuntu 20.04+."
say "Node $(node -v)"

# ---------- 3. Java (for ViaProxy) ----------
java_major() {
  command -v java >/dev/null || { echo 0; return; }
  local v; v=$(java -version 2>&1 | awk -F\" '/version/{print $2; exit}')
  case "$v" in 1.*) echo "$v" | cut -d. -f2 ;; *) echo "${v%%.*}" ;; esac
}
if [ "$(java_major)" -lt 17 ]; then
  say "Installing Java"
  for pkg in openjdk-21-jre-headless openjdk-17-jre-headless openjdk-11-jre-headless openjdk-8-jre-headless; do
    $SUDO apt-get install -y "$pkg" >/dev/null 2>&1 && break
  done
fi
JV="$(java_major)"; [ "$JV" -ge 8 ] || die "Java could not be installed."
say "Java major version: $JV"

# ---------- 4. ViaProxy ----------
mkdir -p "$APP_DIR/viaproxy"
if ! ls "$APP_DIR"/viaproxy/ViaProxy*.jar >/dev/null 2>&1; then
  say "Downloading ViaProxy (latest release)"
  # Resolve the latest tag from the release redirect (no API rate limit), then read the asset names.
  TAG="$(curl -fsSIL -o /dev/null -w '%{url_effective}' https://github.com/ViaVersion/ViaProxy/releases/latest | sed 's|.*/tag/||')"
  [ -n "$TAG" ] || die "Could not reach GitHub."
  JARS="$(curl -fsSL "https://github.com/ViaVersion/ViaProxy/releases/expanded_assets/$TAG" | grep -o 'href="[^"]*\.jar"' | sed 's|href="||; s|"$||')"
  if [ "$JV" -ge 17 ]; then REL_PATH="$(echo "$JARS" | grep -vi java8 | head -1)"; else REL_PATH="$(echo "$JARS" | grep -i java8 | head -1)"; fi
  [ -n "$REL_PATH" ] || die "No ViaProxy jar found in release $TAG."
  curl -fL "https://github.com${REL_PATH}" -o "$APP_DIR/viaproxy/ViaProxy.jar" || die "ViaProxy download failed."
fi
JAR="$(ls "$APP_DIR"/viaproxy/ViaProxy*.jar | head -1)"

# ---------- 5. npm packages ----------
say "Installing bot packages (this can take a few minutes)"
cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund || die "npm install failed."

# ---------- 6. .env ----------
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  PASS="$(openssl rand -hex 8)"
  sed -i "s|^DASH_PASSWORD=.*|DASH_PASSWORD=$PASS|" "$APP_DIR/.env"
  if [ -t 0 ]; then
    read -r -p "Minecraft server IP/domain [127.0.0.1]: " H; read -r -p "Minecraft server port [25565]: " P
    [ -n "${H:-}" ] && sed -i "s|^MC_HOST=.*|MC_HOST=$H|" "$APP_DIR/.env"
    [ -n "${P:-}" ] && sed -i "s|^MC_PORT=.*|MC_PORT=$P|" "$APP_DIR/.env"
  fi
  say "Created .env  (dashboard password: $PASS)"
fi
chmod 600 "$APP_DIR/.env"

# ---------- 7. ViaProxy config + helper scripts ----------
set -a; . "$APP_DIR/.env"; set +a
chmod +x "$APP_DIR"/scripts/*.sh 2>/dev/null || true

# ---------- 8. systemd services ----------
if command -v systemctl >/dev/null && [ -d /run/systemd/system ]; then
  RUN_USER="${SUDO_USER:-$(id -un)}"
  NODE_BIN="$(command -v node)"; JAVA_BIN="$(command -v java)"
  say "Creating systemd services"
  # The app starts and stops ViaProxy itself (so the dashboard can change servers). Remove the old service if present.
  $SUDO systemctl disable --now tj-viaproxy >/dev/null 2>&1; $SUDO rm -f /etc/systemd/system/tj-viaproxy.service
  $SUDO tee /etc/systemd/system/tj-ai.service >/dev/null <<EOF
[Unit]
Description=TJ AI - Minecraft bot and dashboard
After=network-online.target
[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN src/index.js
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable tj-ai >/dev/null 2>&1
  SERVICES=1
else
  warn "No systemd found. Start manually with: node src/index.js"
  SERVICES=0
fi
[ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && chown -R "$SUDO_USER" "$APP_DIR"

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

$(printf '\033[1;35m')TJ AI is installed.$(printf '\033[0m')

Next steps
  1. Edit $APP_DIR/.env  (server IP/port, OpenRouter key). The dashboard password is already set in that file.
  2. Start it:        sudo systemctl start tj-ai      (logs: journalctl -u tj-ai -f)
  3. Open the site:   http://${IP:-your-server-ip}:${DASH_PORT:-3000}
  4. On the site you can add servers, pick any Minecraft version, change settings and control the bot.
  5. To join through ViaProxy with your Minecraft account: open the ViaProxy card on the dashboard,
     press "Add Minecraft account", and follow the sign-in link and code shown in its console.
EOF
