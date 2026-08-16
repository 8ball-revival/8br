# =============================================================================
# Shared helpers for the project-contained PostgreSQL cluster.
#
# Everything this project needs lives under C:\Claude. The only external
# dependency is the PostgreSQL 17 *binaries* (the installed application), which
# are allowed to stay in their normal system location.
#
# Dot-source this from the other db-*.ps1 scripts:
#   . "$PSScriptRoot\_common.ps1"
# =============================================================================

$ErrorActionPreference = 'Stop'

# --- paths (all derived from this script's location; nothing hardcoded) ------
$script:Root    = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:DataDir = Join-Path $Root '.local\postgres'
$script:PgPass  = Join-Path $Root '.local\pgpass.conf'
$script:LogFile = Join-Path $Root '.local\postgres.log'
$script:DbName  = '8br_dev'
$script:DbUser  = 'postgres'

# --- locate the PostgreSQL 17 binaries --------------------------------------
function Get-PgBin {
    if ($env:PGBIN -and (Test-Path (Join-Path $env:PGBIN 'pg_ctl.exe'))) { return $env:PGBIN }
    $candidates = @(
        'C:\Program Files\PostgreSQL\17\bin',
        'C:\Program Files\PostgreSQL\18\bin',
        'C:\Program Files\PostgreSQL\16\bin'
    )
    foreach ($c in $candidates) { if (Test-Path (Join-Path $c 'pg_ctl.exe')) { return $c } }
    $cmd = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
    if ($cmd) { return (Split-Path $cmd.Source -Parent) }
    throw "PostgreSQL binaries not found. Install PostgreSQL 17 or set `$env:PGBIN."
}
$script:PgBin = Get-PgBin

# --- read the port straight out of the cluster's own config -----------------
function Get-PgPort {
    $conf = Join-Path $DataDir 'postgresql.conf'
    if (-not (Test-Path $conf)) { return 55432 }
    $line = Select-String -Path $conf -Pattern '^\s*port\s*=\s*(\d+)' | Select-Object -Last 1
    if ($line) { return [int]$line.Matches[0].Groups[1].Value }
    return 55432
}
$script:PgPort = Get-PgPort

# --- credentials come from the git-ignored pgpass file; never printed -------
function Use-PgPassFile {
    if (-not (Test-Path $PgPass)) { throw "Missing $PgPass - cluster credentials unavailable." }
    $env:PGPASSFILE = $PgPass
}

function Test-ClusterExists {
    return (Test-Path (Join-Path $DataDir 'PG_VERSION'))
}

function Test-PgRunning {
    if (-not (Test-ClusterExists)) { return $false }
    & (Join-Path $PgBin 'pg_ctl.exe') -D $DataDir status *>$null
    return ($LASTEXITCODE -eq 0)
}

function Assert-Cluster {
    if (-not (Test-ClusterExists)) {
        throw "No contained cluster at $DataDir. See CONSOLIDATION-REPORT.md for how it was created."
    }
}
