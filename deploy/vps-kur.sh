#!/usr/bin/env bash
# Ablam Kariyer — VPS kurulumu (Ubuntu 22.04+, root ile). Tekrar çalıştırılabilir.
#
# Kod /opt/ablam-kariyer altında durur (deploy/vps-gonder.sh oraya kopyalar),
# "kariyer" kullanıcısıyla systemd servisi olarak koşar. Bu betik:
#   1. Node 22 (NodeSource) kurar
#   2. kariyer kullanıcısını ve dizini hazırlar
#   3. bağımlılıkları (npm ci) ve Playwright Chromium'u (sistem kütüphaneleriyle) kurar
#   4. servisi yükler ve etkinleştirir
# .env.local'ı bu betik KOPYALAMAZ — vps-gonder.sh gönderir; yoksa servis başlamaz.
set -euo pipefail

DIZIN=/opt/ablam-kariyer
KULLANICI=kariyer

echo "== Node"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "== kullanıcı ve dizin"
id -u "$KULLANICI" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$KULLANICI"
mkdir -p "$DIZIN"
[ -f "$DIZIN/package.json" ] || { echo "HATA: $DIZIN içinde kod yok — önce deploy/vps-gonder.sh çalıştırın"; exit 1; }
[ -f "$DIZIN/.env.local" ] || { echo "HATA: $DIZIN/.env.local yok — vps-gonder.sh göndermeli"; exit 1; }
chown -R "$KULLANICI:$KULLANICI" "$DIZIN"
chmod 600 "$DIZIN/.env.local"

echo "== bağımlılıklar"
# Chromium'un sistem kütüphaneleri root ister; tarayıcının kendisi servisle aynı yola iner
export PLAYWRIGHT_BROWSERS_PATH="$DIZIN/.browsers"
sudo -u "$KULLANICI" -H env PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" bash -c "cd '$DIZIN' && npm ci --omit=dev --no-audit --no-fund"
cd "$DIZIN" && npx playwright-core install-deps chromium
sudo -u "$KULLANICI" -H env PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" bash -c "cd '$DIZIN' && npx playwright-core install chromium"

echo "== servis"
cp "$DIZIN/deploy/ablam-kariyer.service" /etc/systemd/system/ablam-kariyer.service
systemctl daemon-reload
systemctl enable ablam-kariyer >/dev/null
echo "kurulum tamam. Başlatmak için: systemctl restart ablam-kariyer && journalctl -u ablam-kariyer -f"
