#!/usr/bin/env bash
# گرفتن گواهی Let's Encrypt و سوییچ nginx به SSL واقعی
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.prod ]]; then
  echo "فایل .env.prod پیدا نشد. اول بساز:"
  echo "  cp .env.prod.example .env.prod"
  exit 1
fi

# shellcheck disable=SC1091
source .env.prod

DOMAIN="${DOMAIN:?DOMAIN را در .env.prod تنظیم کن}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:?CERTBOT_EMAIL را تنظیم کن}"

if [[ "$DOMAIN" == "localhost" || "$DOMAIN" == "127.0.0.1" ]]; then
  echo "برای Let's Encrypt دامنه واقعی لازم است (نه localhost)."
  exit 1
fi

echo "==> بالا آوردن استک با SSL موقت (self-signed)…"
SSL_MODE=selfsigned DOMAIN="$DOMAIN" docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

echo "==> درخواست گواهی برای ${DOMAIN}…"
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile ssl run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$CERTBOT_EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

echo "==> سوییچ به Let's Encrypt و ری‌استارت nginx…"
# SSL_MODE را در .env.prod به letsencrypt تغییر بده
if grep -q '^SSL_MODE=' .env.prod; then
  sed -i.bak 's/^SSL_MODE=.*/SSL_MODE=letsencrypt/' .env.prod
else
  echo 'SSL_MODE=letsencrypt' >> .env.prod
fi

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d nginx

echo "==> تمدید خودکار: cron پیشنهاد می‌شود:"
echo "  0 3 * * * cd $ROOT && docker compose -f docker-compose.prod.yml --env-file .env.prod --profile ssl run --rm certbot renew && docker compose -f docker-compose.prod.yml --env-file .env.prod exec nginx nginx -s reload"

echo "✅ SSL آماده: https://${DOMAIN}"
