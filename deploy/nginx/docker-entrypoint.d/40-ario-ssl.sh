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

is_ip() {
  echo "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'
}

ensure_self_signed() {
  MARKER="${SSL_DIR}/.cn"
  OLD_CN=""
  [ -f "$MARKER" ] && OLD_CN="$(cat "$MARKER")"
  if [ ! -f "$SSL_CERT" ] || [ ! -f "$SSL_KEY" ] || [ "$OLD_CN" != "$DOMAIN" ]; then
    echo "[nginx] Generating self-signed certificate for ${DOMAIN}"
    CONF="${SSL_DIR}/openssl.cnf"
    if is_ip "$DOMAIN"; then
      cat > "$CONF" <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = ${DOMAIN}

[v3_req]
subjectAltName = @alt

[alt]
IP.1 = ${DOMAIN}
DNS.1 = localhost
IP.2 = 127.0.0.1
EOF
    else
      cat > "$CONF" <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = ${DOMAIN}

[v3_req]
subjectAltName = @alt

[alt]
DNS.1 = ${DOMAIN}
DNS.2 = localhost
IP.1 = 127.0.0.1
EOF
    fi
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout "$SSL_KEY" -out "$SSL_CERT" \
      -config "$CONF" >/dev/null 2>&1
    echo "$DOMAIN" > "$MARKER"
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
    if [ "$SSL_MODE" = "letsencrypt" ] && is_ip "$DOMAIN"; then
      echo "[nginx] Let's Encrypt روی IP پشتیبانی نمی‌شود — self-signed"
    fi
    ensure_self_signed
    echo "[nginx] Using self-signed certs for ${DOMAIN}"
  fi
  export DOMAIN SSL_CERT SSL_KEY
  envsubst '${DOMAIN} ${SSL_CERT} ${SSL_KEY}' < "${TPL_DIR}/ssl.conf.template" > "$OUT"
fi

rm -f /etc/nginx/conf.d/*.template 2>/dev/null || true

echo "[nginx] Config ready: DOMAIN=${DOMAIN} SSL_MODE=${SSL_MODE}"
