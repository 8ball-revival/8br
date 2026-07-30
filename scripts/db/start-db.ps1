# EGO — start the local development database.
# Uses the pgserver-bundled PostgreSQL 16.2 (no Docker required on this machine).
# Data lives in ./.pgdata (gitignored). Fixed port 54329, trust auth, database "ego".

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$DataDir = Join-Path $ProjectRoot '.pgdata'
$LogFile = Join-Path $DataDir 'server.log'
$Port = 54329

# Locate the PostgreSQL binaries that ship inside the pgserver pip package.
$Bin = (& py -c "import pgserver, os; print(os.path.join(os.path.dirname(pgserver.__file__), 'pginstall', 'bin'))").Trim()
$initdb     = Join-Path $Bin 'initdb.exe'
$pg_ctl     = Join-Path $Bin 'pg_ctl.exe'
$createdb   = Join-Path $Bin 'createdb.exe'
$pg_isready = Join-Path $Bin 'pg_isready.exe'

if (-not (Test-Path (Join-Path $DataDir 'PG_VERSION'))) {
  Write-Host "Initializing PostgreSQL data directory at $DataDir ..."
  New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
  & $initdb -D $DataDir -U postgres -A trust --encoding=UTF8
}

Write-Host "Starting PostgreSQL on 127.0.0.1:$Port ..."
& $pg_ctl -D $DataDir -l $LogFile -o "-p $Port -c listen_addresses=127.0.0.1" start

for ($i = 0; $i -lt 30; $i++) {
  & $pg_isready -h 127.0.0.1 -p $Port -U postgres 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Milliseconds 500
}

# Create the "ego" database if it does not already exist (harmless if it does).
& $createdb -h 127.0.0.1 -p $Port -U postgres ego 2>$null
Write-Host "Database ready: postgresql://postgres@127.0.0.1:$Port/ego"
