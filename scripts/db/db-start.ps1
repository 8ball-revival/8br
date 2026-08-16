# Start the project-contained PostgreSQL cluster (C:\Claude\8BR\.local\postgres).
# Does not touch the system-wide PostgreSQL service.
. "$PSScriptRoot\_common.ps1"
Assert-Cluster

if (Test-PgRunning) {
    Write-Host "Already running on port $PgPort (data: $DataDir)" -ForegroundColor Green
    exit 0
}

Write-Host "Starting contained PostgreSQL on port $PgPort ..." -ForegroundColor Cyan
& (Join-Path $PgBin 'pg_ctl.exe') -D $DataDir -l $LogFile -w -o "-p $PgPort" start
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to start. Last log lines:" -ForegroundColor Red
    if (Test-Path $LogFile) { Get-Content $LogFile -Tail 20 }
    exit 1
}
Write-Host "Started. data=$DataDir port=$PgPort" -ForegroundColor Green
