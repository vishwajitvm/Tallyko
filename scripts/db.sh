#!/usr/bin/env bash
# Database commands, run inside the backend container.
#   ./scripts/db.sh migrate | rollback [--steps N] | status | make:migration "add x" | db:sync | fresh --seed | seed [names] | --help
# Production stack: DB_STACK=prod ./scripts/db.sh migrate
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose)
[[ "${DB_STACK:-}" == "prod" ]] && COMPOSE=(docker compose -f docker-compose.prod.yml)
exec "${COMPOSE[@]}" exec backend python manage.py "$@"
