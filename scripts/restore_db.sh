#!/usr/bin/env bash
# Restore a backup made by backup_db.sh. OVERWRITES the current database.
#   ./scripts/restore_db.sh backups/tallyko-20261023-020000.sql.gz [prod]
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:?Usage: restore_db.sh <backup.sql.gz> [prod]}"
[[ -f "$FILE" ]] || { echo "No such file: $FILE" >&2; exit 1; }
COMPOSE=(docker compose)
[[ "${2:-}" == "prod" ]] && COMPOSE=(docker compose -f docker-compose.prod.yml)

read -r -p "This replaces ALL data in the database with $FILE. Type RESTORE to continue: " answer
[[ "$answer" == "RESTORE" ]] || { echo "Cancelled."; exit 1; }

gunzip -c "$FILE" | "${COMPOSE[@]}" exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
"${COMPOSE[@]}" restart backend
echo "Restored $FILE"
