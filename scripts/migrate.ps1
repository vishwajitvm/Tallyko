# Windows script for running Alembic DB migrations inside Docker

Write-Host "Running database migrations..." -ForegroundColor Green
docker compose exec backend alembic upgrade head
