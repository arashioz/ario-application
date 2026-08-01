#!/bin/sh
# قبل از استارت nginx: انتخاب قالب HTTP/SSL و آماده‌سازی گواهی
set -eu

DOMAIN="${DOMAIN:-localhost}"
SSL_MODE="${SSL_MODE:-selfsigned}" # selfsigned | letsencrypt | off

SSL_DIR="/etc/nginx/ssl"
LE_LIVE="/etc/letsencrypt/live/${DOMAIN}"
OUT="/etc/nginx/conf.d/default.conf"
TPL_DIR="/etc/nginx/ario-templates"

mkdir -p /var/www/certbot "$SSL_DIR" /etc/nginx/conf.d

SSL_CERT="${SSL_DIR}/fullchain.pem"
SSL_KEY="${SSL_DIR}/privkey.pem"

ensure_self_signed() {
  if [ ! -f "$SSL_CERT" ] || [ ! -f "$SSL_KEY" ]; then
    echo "[nginx] Generating self-signed certificate for ${DOMAIN}"
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout "$SSL_KEY" -out "$SSL_CERT" \
      -subj "/CN=${DOMAIN}" >/dev/null 2>&1
  fi
}

if [ "$SSL_MODE" = "off" ]; then
  echo "[nginx] SSL_MODE=off — HTTP only"
  envsubst '${DOMAIN}' < "${TPL_DIR}/http-only.conf.template" > "$OUT"
else
  if [ "$SSL_MODE" = "letsencrypt" ] && [ -f "${LE_LIVE}/fullchain.pem" ] && [ -f "${LE_LIVE}/privkey.pem" ]; then
    SSL_CERT="${LE_LIVE}/fullchain.pem"
    SSL_KEY="${LE_LIVE}/privkey.pem"
    echo "[nginx] Using Let's Encrypt certs for ${DOMAIN}"
  else
    # قبل از گرفتن گواهی واقعی، یا حالت selfsigned
    ensure_self_signed
    if [ "$SSL_MODE" = "letsencrypt" ]; then
      echo "[nginx] Let's Encrypt certs not found yet — temporary self-signed"
    else
      echo "[nginx] Using self-signed certs for ${DOMAIN}"
    fi
  fi
  export DOMAIN SSL_CERT SSL_KEY
  envsubst '${DOMAIN} ${SSL_CERT} ${SSL_KEY}' < "${TPL_DIR}/ssl.conf.template" > "$OUT"
fi

# جلوگیری از اجرای دوباره / تداخل
rm -f /etc/nginx/conf.d/*.template 2>/dev/null || true

echo "[nginx] Config ready: DOMAIN=${DOMAIN} SSL_MODE=${SSL_MODE}"
