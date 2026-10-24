#!/usr/bin/env bash
# Start the full local stack with live reload (API :8000, web :8081)
set -e
cd "$(dirname "$0")/.."
docker compose up --build --watch
