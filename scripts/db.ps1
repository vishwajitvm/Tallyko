# Database commands, run inside the backend container.
#   .\scripts\db.ps1 migrate | rollback --steps 2 | status | make:migration "add x" | db:sync | fresh --seed | seed | --help
# Production stack:  $env:DB_STACK = "prod"; .\scripts\db.ps1 migrate
Set-Location (Join-Path $PSScriptRoot "..")
$compose = @("compose")
if ($env:DB_STACK -eq "prod") { $compose += @("-f", "docker-compose.prod.yml") }
& docker @compose exec backend python manage.py @args
exit $LASTEXITCODE
