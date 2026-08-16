# Back up the project-contained database to C:\Claude\Backups\Database.
#
#   .\db-backup.ps1              # timestamped dump
#   .\db-backup.ps1 -Label pre-migration
#
# Writes a custom-format .dump (for db-restore.ps1) plus a plain .sql and the
# role globals. Backups live inside C:\Claude but are excluded from Git.
param([string]$Label = '')

. "$PSScriptRoot\_common.ps1"
Assert-Cluster

if (-not (Test-PgRunning)) { Write-Host "Cluster is not running. Run db-start.ps1 first." -ForegroundColor Red; exit 1 }

$outDir = (Resolve-Path (Join-Path $Root '..\Backups')).Path
$outDir = Join-Path $outDir 'Database'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$name  = if ($Label) { "$DbName-$stamp-$Label" } else { "$DbName-$stamp" }

Use-PgPassFile
& (Join-Path $PgBin 'pg_dump.exe')    -h 127.0.0.1 -p $PgPort -U $DbUser -d $DbName -Fc -f (Join-Path $outDir "$name.dump")
if ($LASTEXITCODE -ne 0) { Write-Host "pg_dump (custom) failed." -ForegroundColor Red; exit 1 }
& (Join-Path $PgBin 'pg_dump.exe')    -h 127.0.0.1 -p $PgPort -U $DbUser -d $DbName     -f (Join-Path $outDir "$name.sql")
& (Join-Path $PgBin 'pg_dumpall.exe') -h 127.0.0.1 -p $PgPort -U $DbUser --globals-only --no-role-passwords -f (Join-Path $outDir "$name-globals.sql")
$env:PGPASSFILE = $null

Write-Host "Backup written to $outDir" -ForegroundColor Green
Get-ChildItem $outDir -Filter "$name*" | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,2)}} | Format-Table -AutoSize
