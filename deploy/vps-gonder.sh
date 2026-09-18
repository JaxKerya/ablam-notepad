#!/usr/bin/env bash
# Ablam Kariyer — kodu VPS'e gönderir, bağımlılıkları tazeler, servisi yeniden başlatır.
# Yerelde (Git Bash / Linux / macOS) çalışır. Kullanım:
#   deploy/vps-gonder.sh root@SUNUCU_IP [~/.ssh/anahtar]
#
# Proje kökünden çalıştırılır; node_modules, .next, .git ve .claude gönderilmez.
# .env.local GÖNDERİLİR (sunucu bu dosyayla çalışıyor) — bu betik dışında bir
# yere kopyalamayın. İlk kurulumda ardından sunucuda deploy/vps-kur.sh çalıştırılır.
set -euo pipefail

HEDEF="${1:?kullanım: vps-gonder.sh root@sunucu [anahtar]}"
ANAHTAR="${2:-}"
DIZIN=/opt/ablam-kariyer
SSH=(ssh -o BatchMode=yes)
[ -n "$ANAHTAR" ] && SSH+=(-i "$ANAHTAR")

[ -f package.json ] || { echo "proje kökünden çalıştırın"; exit 1; }
[ -f .env.local ] || { echo ".env.local yok"; exit 1; }

echo "== gönderiliyor"
"${SSH[@]}" "$HEDEF" "mkdir -p $DIZIN"
tar --exclude=node_modules --exclude=.next --exclude=.git --exclude=.claude \
    --exclude=tsconfig.tsbuildinfo --exclude=next-env.d.ts --exclude=.env.local --exclude=AGENTS.md --exclude=CLAUDE.md \
    -czf - . | "${SSH[@]}" "$HEDEF" "tar -xzf - -C $DIZIN"
if ! "${SSH[@]}" "$HEDEF" "test -f $DIZIN/.env.local"; then
  echo "== .env.local sunucuda yok, gönderiliyor"
  "${SSH[@]}" "$HEDEF" "cat > $DIZIN/.env.local" < .env.local
fi

echo "== sunucuda güncelleme"
"${SSH[@]}" "$HEDEF" bash -s <<'EOF'
set -e
DIZIN=/opt/ablam-kariyer
chown -R kariyer:kariyer "$DIZIN" 2>/dev/null || true
chmod 600 "$DIZIN/.env.local"
if id -u kariyer >/dev/null 2>&1 && [ -d "$DIZIN/node_modules" ]; then
  sudo -u kariyer -H bash -c "cd '$DIZIN' && npm ci --omit=dev --no-audit --no-fund" | tail -1
  systemctl restart ablam-kariyer && echo "servis yeniden başladı"
else
  echo "ilk kurulum: şimdi sunucuda 'bash $DIZIN/deploy/vps-kur.sh' çalıştırın"
fi
EOF
