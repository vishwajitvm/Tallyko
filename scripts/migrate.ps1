# Apply pending database migrations (they also run automatically when the backend starts)
& (Join-Path $PSScriptRoot "db.ps1") migrate @args
