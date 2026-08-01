#!/usr/bin/env bash
# بسته‌بندی پروژه برای کپی روی سرور (بدون git / بدون node_modules)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${1:-ario-deploy.tgz}"

echo "==> ساخت $OUT …"
tar -czf "$OUT" \
  --exclude='node_modules' \
  --exclude='*/node_modules' \
  --exclude='dist' \
  --exclude='*/dist' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.prod' \
  --exclude='mobile/.env' \
  --exclude='backend/uploads/*' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  --exclude='ario-deploy.tgz' \
  --exclude='mobile/android' \
  --exclude='mobile/ios' \
  --exclude='mobile/cypress' \
  \
  backend \
  mobile \
  deploy \
  docker-compose.yml \
  docker-compose.prod.yml \
  .env.prod.example \
  package.json \
  DEPLOY.md \
  README.md \
  2>/dev/null || tar -czf "$OUT" \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env.prod' \
  --exclude='ario-deploy.tgz' \
  .

SIZE="$(du -h "$OUT" | awk '{print $1}')"
echo "✅ $OUT ($SIZE)"
echo ""
echo "روی لپ‌تاپ:"
echo "  scp $OUT root@IP_SERVER:/root/"
echo ""
echo "روی سرور:"
echo "  mkdir -p /root/application && cd /root/application"
echo "  tar -xzf /root/$OUT -C /root/application --strip-components=0"
echo "  # یا اگر داخل پوشه ario-* باز شد، همان را cd کن"
echo "  cp -n .env.prod.example .env.prod"
echo "  nano .env.prod   # DOMAIN=IP"
echo "  docker compose --env-file .env.prod up -d --build"
echo "  docker compose --env-file .env.prod exec backend node dist/seed.js"
