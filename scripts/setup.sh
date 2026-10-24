#!/usr/bin/env bash
# Create .env with fresh random secrets (needed for production; local dev also works without it).
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env ]]; then
  echo ".env already exists — leaving it unchanged."
  exit 0
fi
cp .env.example .env
rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
sed -i.bak -e "s/^JWT_SECRET=.*/JWT_SECRET=$(rand 64)/" -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(rand 32)/" .env && rm -f .env.bak
echo "Created .env with random JWT_SECRET and POSTGRES_PASSWORD. Edit DOMAIN / ACME_EMAIL / APK_API_URL before deploying."
