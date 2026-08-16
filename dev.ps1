# =============================================================================
# 8BR development launcher - fully self-contained under C:\Claude
#
#   .\dev.ps1              # start contained DB, then the Next.js dev server
#   .\dev.ps1 -Build       # start contained DB, then a production build + start
#   .\dev.ps1 -NoDb        # skip the database (assume it is already running)
#
# Starts the project-contained PostgreSQL cluster first, waits until it is
# accepting connections, then launches the website. The system-wide PostgreSQL
# service is never started, stopped, or modified.
# =============================================================================
param([switch]$Build, [switch]$NoDb)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not $NoDb) {
    & "$PSScriptRoot\scripts\db\db-start.ps1"
    if ($LASTEXITCODE -ne 0) { Write-Host "Database failed to start - aborting." -ForegroundColor Red; exit 1 }

    # wait until the server actually accepts connections
    . "$PSScriptRoot\scripts\db\_common.ps1"
    $ready = $false
    foreach ($i in 1..30) {
        & (Join-Path $PgBin 'pg_isready.exe') -h 127.0.0.1 -p $PgPort -d $DbName *>$null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { Write-Host "Database did not become ready in time." -ForegroundColor Red; exit 1 }
    Write-Host "Database ready on port $PgPort (data: $DataDir)" -ForegroundColor Green
}

if ($Build) {
    Write-Host "Building 8BR ..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Starting 8BR (production) ..." -ForegroundColor Cyan
    npm start
} else {
    Write-Host "Starting 8BR dev server ..." -ForegroundColor Cyan
    npm run dev
}
