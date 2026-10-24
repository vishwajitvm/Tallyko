# Create .env with fresh random secrets (needed for production; local dev also works without it).
Set-Location (Join-Path $PSScriptRoot "..")
if (Test-Path .env) { Write-Host ".env already exists - leaving it unchanged."; exit 0 }
function New-Secret([int]$Length) {
    $chars = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    $bytes = New-Object byte[] $Length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}
(Get-Content .env.example) `
    -replace '^JWT_SECRET=.*', ("JWT_SECRET=" + (New-Secret 64)) `
    -replace '^POSTGRES_PASSWORD=.*', ("POSTGRES_PASSWORD=" + (New-Secret 32)) |
    Set-Content -Encoding utf8 .env
Write-Host "Created .env with random JWT_SECRET and POSTGRES_PASSWORD. Edit DOMAIN / ACME_EMAIL / APK_API_URL before deploying." -ForegroundColor Green
