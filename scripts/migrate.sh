#!/bin/bash
# Placeholder for running Alembic DB migrations inside Docker

echo "Running database migrations..."
docker compose exec backend alembic upgrade head
