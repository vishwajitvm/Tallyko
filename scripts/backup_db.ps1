# Back up the whole Tallyko database to .\backups\tallyko-<timestamp>.sql (keeps the last 14).
#   .\scripts\backup_db.ps1          # development stack
#   .\scripts\backup_db.ps1 prod     # production stack (docker-compose.prod.yml)
param([string]$Stack = "dev", [int]$Keep = 14)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$composeArgs = @("compose")
if ($Stack -eq "prod") { $composeArgs += @("-f", "docker-compose.prod.yml") }
$backupDir = Join-Path (Get-Location) "backups"
New-Item -ItemType Directory -Force $backupDir | Out-Null
$file = Join-Path $backupDir ("tallyko-{0}.sql" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

# Write through cmd so the dump keeps its exact bytes (PowerShell pipes would re-encode it)
$cmd = "docker $($composeArgs -join ' ') exec -T db sh -c ""pg_dump -U `$POSTGRES_USER -d `$POSTGRES_DB --no-owner --clean --if-exists"" > ""$file"""
cmd /c $cmd
if (-not (Test-Path $file) -or (Get-Item $file).Length -eq 0) {
    Remove-Item $file -ErrorAction SilentlyContinue
    throw "Backup failed"
}
Write-Host "Backup written: $file" -ForegroundColor Green

Get-ChildItem $backupDir -Filter "tallyko-*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | Remove-Item
