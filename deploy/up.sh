#!/usr/bin/env bash
# دیپلوی روی IP سرور (بدون دامنه) — HTTPS خودامضا
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

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
    echo "==> IP عمومی تشخیص داده شد: $DETECTED"
    if grep -q '^DOMAIN=' .env.prod; then
      sed -i.bak "s/^DOMAIN=.*/DOMAIN=${DETECTED}/" .env.prod
    else
      echo "DOMAIN=${DETECTED}" >> .env.prod
    fi
    DOMAIN="$DETECTED"
  else
    echo "DOMAIN را در .env.prod با IP سرور پر کن، مثلاً:"
    echo "  DOMAIN=203.0.113.10"
    echo "  SSL_MODE=selfsigned"
    exit 1
  fi
fi

# روی IP هرگز letsencrypt نزن
if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  if [[ "${SSL_MODE:-}" == "letsencrypt" ]]; then
    echo "==> Let's Encrypt روی IP ممکن نیست — SSL_MODE=selfsigned"
    sed -i.bak 's/^SSL_MODE=.*/SSL_MODE=selfsigned/' .env.prod
    SSL_MODE=selfsigned
  fi
fi

# اگر گواهی قبلی با CN دیگر است، volume ssl را برای ساخت مجدد خالی نکن مگر کاربر بخواهد
# (entrypoint خودش با تغییر DOMAIN دوباره می‌سازد)

echo "==> بیلد و اجرا روی ${DOMAIN} (SSL_MODE=${SSL_MODE:-selfsigned})…"
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

echo "==> صبر برای healthy شدن بک‌اند…"
for i in $(seq 1 40); do
  if docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T backend wget -qO- http://127.0.0.1:3001/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "==> Seed (admin / admin123)…"
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T backend node dist/seed.js || true

# shellcheck disable=SC1091
source .env.prod
SSL_MODE="${SSL_MODE:-selfsigned}"

echo ""
echo "✅ آماده روی IP"
if [[ "$SSL_MODE" == "off" ]]; then
  echo "   http://${DOMAIN}/"
else
  echo "   https://${DOMAIN}/"
  echo "   مرورگر هشدار گواهی می‌دهد → Advanced → Proceed / ادامه"
fi
echo "   ورود: admin / admin123"
echo ""
echo "فایر وال: پورت 80 و 443 را باز کن."
