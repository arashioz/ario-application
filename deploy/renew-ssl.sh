#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
docker compose --env-file .env.prod --profile ssl run --rm certbot renew
docker compose --env-file .env.prod exec nginx nginx -s reload
echo "✅ renew done"
