#!/usr/bin/env bash
# Back up the whole Tallyko database to ./backups/tallyko-<timestamp>.sql.gz (keeps the last 14).
#   ./scripts/backup_db.sh          # development stack (docker-compose.yml)
#   ./scripts/backup_db.sh prod     # production stack (docker-compose.prod.yml)
# Schedule nightly with cron, e.g.:  0 2 * * * cd /opt/tallyko && ./scripts/backup_db.sh prod
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose)
[[ "${1:-}" == "prod" ]] && COMPOSE=(docker compose -f docker-compose.prod.yml)
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP="${KEEP:-14}"
mkdir -p "$BACKUP_DIR"

FILE="$BACKUP_DIR/tallyko-$(date +%Y%m%d-%H%M%S).sql.gz"
# Credentials are read inside the container from its own environment
"${COMPOSE[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists' | gzip > "$FILE"

if [[ ! -s "$FILE" ]]; then
  echo "Backup failed: $FILE is empty" >&2
  rm -f "$FILE"
  exit 1
fi
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"

# Keep only the newest $KEEP backups
ls -1t "$BACKUP_DIR"/tallyko-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
