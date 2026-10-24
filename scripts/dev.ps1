# Start the full local stack with live reload (API :8000, web :8081)
Set-Location (Join-Path $PSScriptRoot "..")
docker compose up --build --watch
