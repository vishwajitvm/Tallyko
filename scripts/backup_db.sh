#!/bin/bash
# Placeholder for database backups of tenant schemas

if [ -z "$1" ]; then
  echo "Usage: ./backup_db.sh <tenant_id>"
  exit 1
fi

TENANT_ID=$1
BACKUP_DIR="./backups"
mkdir -p "$BACKUP_DIR"

echo "Backing up database for tenant: $TENANT_ID"
# Target command structure:
# docker compose exec db pg_dump -U postgres -d tallyko_shared --schema=tenant_$TENANT_ID > "$BACKUP_DIR/tenant_$TENANT_ID_$(date +%F).sql"
