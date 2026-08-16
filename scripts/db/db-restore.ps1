# Restore a dump into the project-contained database.
#
#   .\db-restore.ps1                          # newest .dump in C:\Claude\Backups\Database
#   .\db-restore.ps1 -Path "C:\...\x.dump"    # a specific dump
#   .\db-restore.ps1 -Force                   # skip the confirmation prompt
#
# DESTRUCTIVE: drops and recreates the target database. Only ever touches the
# contained cluster on its dedicated port - never the system PostgreSQL.
param([string]$Path = '', [switch]$Force)

. "$PSScriptRoot\_common.ps1"
Assert-Cluster

if (-not (Test-PgRunning)) { Write-Host "Cluster is not running. Run db-start.ps1 first." -ForegroundColor Red; exit 1 }

if (-not $Path) {
    $dir = Join-Path (Resolve-Path (Join-Path $Root '..\Backups')).Path 'Database'
    $newest = Get-ChildItem $dir -Filter '*.dump' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $newest) { Write-Host "No .dump files found in $dir" -ForegroundColor Red; exit 1 }
    $Path = $newest.FullName
}
if (-not (Test-Path $Path)) { Write-Host "Dump not found: $Path" -ForegroundColor Red; exit 1 }

Write-Host "About to REPLACE database '$DbName' on the contained cluster." -ForegroundColor Yellow
Write-Host "  data dir : $DataDir"
Write-Host "  port     : $PgPort"
Write-Host "  dump     : $Path"
if (-not $Force) {
    $answer = Read-Host "Type 'yes' to continue"
    if ($answer -ne 'yes') { Write-Host "Aborted." -ForegroundColor Yellow; exit 0 }
}

Use-PgPassFile
$psql = Join-Path $PgBin 'psql.exe'

& $psql -h 127.0.0.1 -p $PgPort -U $DbUser -d postgres -v ON_ERROR_STOP=1 `
    -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DbName' AND pid <> pg_backend_pid()" *>$null
& $psql -h 127.0.0.1 -p $PgPort -U $DbUser -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DbName"
if ($LASTEXITCODE -ne 0) { Write-Host "Drop failed." -ForegroundColor Red; exit 1 }
& $psql -h 127.0.0.1 -p $PgPort -U $DbUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DbName ENCODING 'UTF8' TEMPLATE template0"
if ($LASTEXITCODE -ne 0) { Write-Host "Create failed." -ForegroundColor Red; exit 1 }

& (Join-Path $PgBin 'pg_restore.exe') -h 127.0.0.1 -p $PgPort -U $DbUser -d $DbName --no-owner --no-privileges $Path
$rc = $LASTEXITCODE

$tables = & $psql -h 127.0.0.1 -p $PgPort -U $DbUser -d $DbName -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
$env:PGPASSFILE = $null

if ($rc -ne 0) { Write-Host "pg_restore reported warnings/errors (exit $rc). Tables now: $tables" -ForegroundColor Yellow }
else { Write-Host "Restore complete. Public tables: $tables" -ForegroundColor Green }
