#!/usr/bin/env bash
# دیپلوی با docker-compose.yml روی IP سرور
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
COMPOSE="docker compose --env-file .env.prod"

if [[ ! -f .env.prod ]]; then
  cp .env.prod.example .env.prod
  echo "فایل .env.prod ساخته شد."
fi

# shellcheck disable=SC1091
source .env.prod

if [[ -z "${DOMAIN:-}" || "$DOMAIN" == "YOUR.SERVER.IP" || "$DOMAIN" == "localhost" ]]; then
  DETECTED="$(curl -4 -fsS --max-time 3 ifconfig.me 2>/dev/null || curl -4 -fsS --max-time 3 icanhazip.com 2>/dev/null || true)"
  DETECTED="$(echo "$DETECTED" | tr -d '[:space:]')"
  if [[ -n "$DETECTED" && "$DETECTED" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "==> IP عمومی: $DETECTED"
    sed -i.bak "s/^DOMAIN=.*/DOMAIN=${DETECTED}/" .env.prod
    DOMAIN="$DETECTED"
  else
    echo "در .env.prod بنویس: DOMAIN=IP.سرور.تو"
    exit 1
  fi
fi

if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && [[ "${SSL_MODE:-}" == "letsencrypt" ]]; then
  sed -i.bak 's/^SSL_MODE=.*/SSL_MODE=selfsigned/' .env.prod
  SSL_MODE=selfsigned
fi

echo "==> docker compose up (Mongo 7 + backend + nginx)…"
$COMPOSE down --remove-orphans 2>/dev/null || true
$COMPOSE up -d --build

echo "==> صبر برای backend…"
for i in $(seq 1 40); do
  if $COMPOSE exec -T backend wget -qO- http://127.0.0.1:3001/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "==> Seed…"
$COMPOSE exec -T backend node dist/seed.js || true

# shellcheck disable=SC1091
source .env.prod
echo ""
echo "✅ آماده"
if [[ "${SSL_MODE:-selfsigned}" == "off" ]]; then
  echo "   http://${DOMAIN}/"
else
  echo "   https://${DOMAIN}/  (هشدار گواهی → Proceed)"
fi
echo "   admin / admin123"
