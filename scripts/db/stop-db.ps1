# EGO — stop the local development database (pgserver-bundled PostgreSQL).

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$DataDir = Join-Path $ProjectRoot '.pgdata'

$Bin = (& py -c "import pgserver, os; print(os.path.join(os.path.dirname(pgserver.__file__), 'pginstall', 'bin'))").Trim()
$pg_ctl = Join-Path $Bin 'pg_ctl.exe'

& $pg_ctl -D $DataDir stop -m fast
Write-Host "Database stopped."
