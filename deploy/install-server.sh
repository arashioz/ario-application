#!/usr/bin/env bash
# نصب سریع روی سرور — بعد از استخراج tar یا کپی فایل‌ها
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f docker-compose.yml ]]; then
  echo "این اسکریپت را از ریشه پروژه اجرا کن (کنار docker-compose.yml)"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker نصب نیست. اول Docker را نصب کن."
  exit 1
fi

if [[ ! -f .env.prod ]]; then
  cp .env.prod.example .env.prod
fi

# IP را اگر خالی است پر کن
# shellcheck disable=SC1091
source .env.prod
if [[ -z "${DOMAIN:-}" || "$DOMAIN" == "YOUR.SERVER.IP" || "$DOMAIN" == "localhost" ]]; then
  IP="$(curl -4 -fsS --max-time 3 ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
  IP="$(echo "$IP" | tr -d '[:space:]')"
  if [[ -n "$IP" ]]; then
    sed -i.bak "s/^DOMAIN=.*/DOMAIN=${IP}/" .env.prod
    echo "==> DOMAIN=$IP"
  else
    echo "DOMAIN را در .env.prod دستی بگذار (IP سرور)"
    exit 1
  fi
fi

# دیتای نسخهٔ دیگر Mongo با این ایمیج ممکن است ناسازگار باشد
if docker volume ls -q | grep -q mongo; then
  echo "==> اگر mongodb unhealthy شد، یک‌بار volume را پاک کن:"
  echo "    docker compose --env-file .env.prod down"
  echo "    docker volume rm \$(docker volume ls -q | grep mongo | head -1)"
fi

chmod +x deploy/*.sh deploy/nginx/docker-entrypoint.d/*.sh 2>/dev/null || true
./deploy/up.sh
