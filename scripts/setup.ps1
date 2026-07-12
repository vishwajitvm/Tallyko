# Local environment bootstrap script for Tallyko on Windows

Write-Host "Bootstrapping local environment..." -ForegroundColor Green

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example"
} else {
    Write-Host ".env already exists."
}

if (-not (Test-Path "backend/.env")) {
    Copy-Item "backend/.env.example" "backend/.env"
    Write-Host "Created backend/.env from backend/.env.example"
}

if (-not (Test-Path "frontend/.env")) {
    Copy-Item "frontend/.env.example" "frontend/.env"
    Write-Host "Created frontend/.env from frontend/.env.example"
}

Write-Host "Environment initialized successfully. Run dev.ps1 to start containers." -ForegroundColor Green
