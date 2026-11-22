#!/usr/bin/env bash
# TJ AI installer for Ubuntu 24.04 LTS "Noble Numbat" (24.04.x, including 24.04.4).
#
#   bash install-ubuntu-24.04.sh                      install, then start with: sudo systemctl start tj-ai
#   bash install-ubuntu-24.04.sh --domain bot.example.com   also put nginx in front (HTTPS with certbot)
#   bash install-ubuntu-24.04.sh --force              skip the "is this Ubuntu 24.04" check
#
# Installs: Java 21 (Ubuntu package), Node.js 22 LTS (NodeSource), ViaProxy, the bot packages,
# .env with a random admin password, and a locked-down systemd service that runs as a normal user.
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOMAIN=""; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
say()  { printf '\n\033[1;35m[TJ AI]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*"; exit 1; }
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

# ---------- 0. checks ----------
. /etc/os-release 2>/dev/null || true
say "System: ${PRETTY_NAME:-unknown} ($(uname -m))"
if [ "${ID:-}" != "ubuntu" ] || [ "${VERSION_ID:-}" != "24.04" ]; then
  [ "$FORCE" -eq 1 ] || die "This script is for Ubuntu 24.04. Use install.sh for other versions, or add --force."
  warn "Not Ubuntu 24.04, continuing because of --force."
fi
case "$(uname -m)" in x86_64|aarch64) ;; *) die "Unsupported CPU: $(uname -m)" ;; esac
[ -n "$SUDO" ] && { command -v sudo >/dev/null || die "Run as root or install sudo."; sudo -v || die "sudo failed."; }
if [ -n "$DOMAIN" ] && ! echo "$DOMAIN" | grep -Eq '^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'; then die "Invalid domain: $DOMAIN"; fi

case "$APP_DIR" in /root/*) warn "The app is inside /root. The service user cannot read it there; move the folder to /opt/tj-ai or your home folder." ;; esac

# ---------- 1. packages ----------
say "Installing base packages"
$SUDO apt-get update -y || warn "apt update reported errors"
$SUDO apt-get install -y curl ca-certificates gnupg unzip jq git openssl build-essential python3 || die "Base packages failed to install."

# ---------- 2. Java 21 ----------
java_major() { command -v java >/dev/null || { echo 0; return; }; java -version 2>&1 | awk -F\" '/version/{print $2; exit}' | cut -d. -f1; }
if [ "$(java_major)" -lt 21 ]; then
  say "Installing Java 21"
  $SUDO apt-get install -y openjdk-21-jre-headless || die "Java 21 install failed."
fi
say "Java $(java_major)"

# ---------- 3. Node.js 22 ----------
node_major() { command -v node >/dev/null && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ "$(node_major)" -lt 20 ]; then
  say "Installing Node.js 22 LTS"
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - || die "Could not add the NodeSource repository."
  $SUDO apt-get install -y nodejs || die "Node.js install failed."
fi
say "Node $(node -v), npm $(npm -v)"

# ---------- 4. ViaProxy ----------
mkdir -p "$APP_DIR/viaproxy"
if ! ls "$APP_DIR"/viaproxy/ViaProxy*.jar >/dev/null 2>&1; then
  say "Downloading ViaProxy (latest release)"
  TAG="$(curl -fsSIL -o /dev/null -w '%{url_effective}' https://github.com/ViaVersion/ViaProxy/releases/latest | sed 's|.*/tag/||')"
  [ -n "$TAG" ] || die "Could not reach GitHub."
  JAR_PATH="$(curl -fsSL "https://github.com/ViaVersion/ViaProxy/releases/expanded_assets/$TAG" | grep -o 'href="[^"]*\.jar"' | sed 's|href="||; s|"$||' | grep -vi java8 | head -1)"
  [ -n "$JAR_PATH" ] || die "No ViaProxy jar found in release $TAG."
  curl -fL "https://github.com${JAR_PATH}" -o "$APP_DIR/viaproxy/ViaProxy.jar" || die "ViaProxy download failed."
fi
say "ViaProxy ready ($(ls "$APP_DIR"/viaproxy/ViaProxy*.jar | head -1 | xargs basename))"

# ---------- 5. bot packages ----------
say "Installing bot packages (a few minutes)"
( cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund ) || die "npm install failed."

# ---------- 6. .env ----------
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  PASS="$(openssl rand -base64 12 | tr -d '/+=' | head -c 16)"
  sed -i "s|^DASH_PASSWORD=.*|DASH_PASSWORD=$PASS|" "$APP_DIR/.env"
  if [ -t 0 ]; then
    read -r -p "Minecraft server IP/domain [127.0.0.1]: " H; read -r -p "Minecraft server port [25565]: " P
    [ -n "${H:-}" ] && sed -i "s|^MC_HOST=.*|MC_HOST=$H|" "$APP_DIR/.env"
    [ -n "${P:-}" ] && sed -i "s|^MC_PORT=.*|MC_PORT=$P|" "$APP_DIR/.env"
  fi
  say "Created .env. First admin login -> username: admin   password: $PASS"
else
  warn ".env already exists, left unchanged."
fi
if [ -n "$DOMAIN" ]; then   # behind nginx: listen only locally and trust nginx for the visitor IP
  sed -i 's|^DASH_HOST=.*|DASH_HOST=127.0.0.1|; s|^TRUST_PROXY=.*|TRUST_PROXY=loopback|' "$APP_DIR/.env"
fi
chmod 600 "$APP_DIR/.env"
DASH_PORT="$(grep -E '^DASH_PORT=' "$APP_DIR/.env" | cut -d= -f2)"; DASH_PORT="${DASH_PORT:-3000}"

# ---------- 7. systemd service ----------
HAVE_SYSTEMD=0; [ -d /run/systemd/system ] && command -v systemctl >/dev/null && HAVE_SYSTEMD=1
if [ "$HAVE_SYSTEMD" -eq 1 ]; then
  RUN_USER="${SUDO_USER:-}"
  if [ -z "$RUN_USER" ] || [ "$RUN_USER" = "root" ]; then
    RUN_USER="tjai"
    id "$RUN_USER" >/dev/null 2>&1 || $SUDO useradd --system --no-create-home --shell /usr/sbin/nologin "$RUN_USER"
  fi
  $SUDO chown -R "$RUN_USER":"$(id -gn "$RUN_USER")" "$APP_DIR"
  say "Creating systemd service (runs as $RUN_USER)"
  $SUDO tee /etc/systemd/system/tj-ai.service >/dev/null <<EOF
[Unit]
Description=TJ AI - Minecraft bot and dashboard
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
WorkingDirectory=$APP_DIR
Environment=HOME=$APP_DIR
ExecStart=$(command -v node) src/index.js
Restart=always
RestartSec=5
# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable tj-ai >/dev/null 2>&1
else
  warn "systemd not running here. Start manually with: cd $APP_DIR && node src/index.js"
fi

# ---------- 8. firewall (never turns ufw on by itself, that could lock you out of SSH) ----------
if command -v ufw >/dev/null && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
  if [ -n "$DOMAIN" ]; then $SUDO ufw allow 'Nginx Full' >/dev/null 2>&1 || $SUDO ufw allow 80,443/tcp >/dev/null
  else $SUDO ufw allow "${DASH_PORT}/tcp" >/dev/null; fi
  say "ufw: opened the dashboard port"
fi

# ---------- 9. optional nginx + HTTPS ----------
if [ -n "$DOMAIN" ]; then
  say "Setting up nginx for $DOMAIN"
  $SUDO apt-get install -y nginx certbot python3-certbot-nginx || die "nginx/certbot install failed."
  $SUDO tee /etc/nginx/sites-available/tj-ai >/dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 20k;
    location / {
        proxy_pass http://127.0.0.1:${DASH_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  $SUDO ln -sf /etc/nginx/sites-available/tj-ai /etc/nginx/sites-enabled/tj-ai
  $SUDO nginx -t && $SUDO systemctl reload nginx || die "nginx config test failed."
  if $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
    say "HTTPS is on for $DOMAIN"
  else
    warn "certbot failed (the domain must point to this server first). Re-run: sudo certbot --nginx -d $DOMAIN"
  fi
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
URL="http://${IP:-your-server-ip}:${DASH_PORT}"; [ -n "$DOMAIN" ] && URL="https://$DOMAIN"
cat <<EOF

$(printf '\033[1;35m')TJ AI is installed on Ubuntu 24.04.$(printf '\033[0m')

  1. Edit $APP_DIR/.env   (Minecraft server address, OpenRouter key, ALLOW_IPS = your own IP)
  2. Start:   sudo systemctl start tj-ai        Logs: journalctl -u tj-ai -f
  3. Open:    $URL
  4. Log in with  admin  and the password printed above (also in .env). Add other accounts on the dashboard.
  5. Locked out by the anti-bot guard?  cd $APP_DIR && npm run bans && npm run unban -- <ip>
EOF
[ -z "$DOMAIN" ] && echo "  Tip: without HTTPS your password travels in clear text. Re-run with --domain your.domain to add nginx + HTTPS."
