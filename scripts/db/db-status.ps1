# Report the state of the project-contained PostgreSQL cluster.
# Confirms the running server is using the data directory inside C:\Claude.
. "$PSScriptRoot\_common.ps1"

Write-Host "=== Contained PostgreSQL status ===" -ForegroundColor Cyan
Write-Host ("  project root : {0}" -f $Root)
Write-Host ("  data dir     : {0}" -f $DataDir)
Write-Host ("  port         : {0}" -f $PgPort)
Write-Host ("  binaries     : {0}" -f $PgBin)
Write-Host ("  cluster      : {0}" -f $(if (Test-ClusterExists) { 'present' } else { 'MISSING' }))

if (-not (Test-ClusterExists)) { exit 1 }

if (-not (Test-PgRunning)) {
    Write-Host "  running      : NO" -ForegroundColor Yellow
    exit 2
}
Write-Host "  running      : YES" -ForegroundColor Green

Use-PgPassFile
$psql = Join-Path $PgBin 'psql.exe'

# Ask the server itself where its data lives - the authoritative check.
$live = & $psql -h 127.0.0.1 -p $PgPort -U $DbUser -d $DbName -At `
        -c "SELECT setting FROM pg_settings WHERE name='data_directory'" 2>$null
Write-Host ("  server says  : {0}" -f $live)

$norm = ($live -replace '/','\')
if ($norm -and $norm.TrimEnd('\') -ieq $DataDir.TrimEnd('\')) {
    Write-Host "  CONTAINED    : YES - data directory is inside C:\Claude" -ForegroundColor Green
} else {
    Write-Host "  CONTAINED    : NO  - unexpected data directory!" -ForegroundColor Red
    exit 3
}

$tables = & $psql -h 127.0.0.1 -p $PgPort -U $DbUser -d $DbName -At `
          -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>$null
Write-Host ("  database     : {0} ({1} public tables)" -f $DbName, $tables)
$env:PGPASSFILE = $null
