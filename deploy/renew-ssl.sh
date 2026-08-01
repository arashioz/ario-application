#!/usr/bin/env bash
# تمدید گواهی Let's Encrypt و ری‌لود nginx
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
docker compose -f docker-compose.prod.yml --env-file .env.prod --profile ssl run --rm certbot renew
docker compose -f docker-compose.prod.yml --env-file .env.prod exec nginx nginx -s reload
echo "✅ renew done"
