# Stop the project-contained PostgreSQL cluster only.
# The system-wide PostgreSQL service is never touched.
. "$PSScriptRoot\_common.ps1"
Assert-Cluster

if (-not (Test-PgRunning)) {
    Write-Host "Contained cluster is not running." -ForegroundColor Yellow
    exit 0
}

Write-Host "Stopping contained PostgreSQL (port $PgPort) ..." -ForegroundColor Cyan
& (Join-Path $PgBin 'pg_ctl.exe') -D $DataDir -w -m fast stop
if ($LASTEXITCODE -ne 0) { Write-Host "Stop failed." -ForegroundColor Red; exit 1 }
Write-Host "Stopped." -ForegroundColor Green
