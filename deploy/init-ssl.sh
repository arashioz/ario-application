#!/usr/bin/env bash
# گرفتن گواهی Let's Encrypt (فقط با دامنه واقعی — نه IP)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
COMPOSE="docker compose --env-file .env.prod"

if [[ ! -f .env.prod ]]; then
  echo "اول: cp .env.prod.example .env.prod"
  exit 1
fi

# shellcheck disable=SC1091
source .env.prod

DOMAIN="${DOMAIN:?DOMAIN را در .env.prod تنظیم کن}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:?CERTBOT_EMAIL را تنظیم کن}"

if [[ "$DOMAIN" == "localhost" || "$DOMAIN" == "127.0.0.1" ]] || [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Let's Encrypt دامنه واقعی می‌خواهد (نه IP)."
  exit 1
fi

echo "==> استک با SSL موقت…"
SSL_MODE=selfsigned DOMAIN="$DOMAIN" $COMPOSE up -d --build

echo "==> درخواست گواهی ${DOMAIN}…"
$COMPOSE --profile ssl run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$CERTBOT_EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

sed -i.bak 's/^SSL_MODE=.*/SSL_MODE=letsencrypt/' .env.prod
$COMPOSE up -d nginx

echo "✅ https://${DOMAIN}"
