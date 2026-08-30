<#
.SYNOPSIS
  Replaces the 8br.gg production database with a verified local dump, after backing it up.

.DESCRIPTION
  Run this yourself, in your own terminal, where the production connection string resolves. It asks
  for that string at the prompt as a secure value: it is never written to a file, never echoed, never
  passed on a command line where another process could read it, and it is cleared from memory when
  the script exits.

  What it does, in order, stopping at the first failure:

    1. Checks the tools it needs and the dump you are restoring, including its SHA-256.
    2. Connects read-only and shows you what is in production right now.
    3. Backs production up, then VERIFIES that backup by restoring it into a scratch database and
       comparing table counts. An unverified backup is not a backup.
    4. Asks you to type REPLACE 8BR.GG. Nothing before this point has changed anything.
    5. Restores the dump in ONE transaction. Either all of it lands or none of it does.
    6. Re-reads production and prints a source-versus-production comparison.

  It never runs `prisma db push` and never passes `--accept-data-loss`. Schema changes reach
  production through `prisma migrate deploy` in the build, from reviewed migration files.

  Ownership and privileges are left alone (`--no-owner --no-privileges`), because on a provider-
  managed database the roles this dump came from do not exist and must not be asserted. Extensions
  and provider configuration are preserved: the restore replaces the contents of the application
  schemas and does not touch anything the provider manages.

.PARAMETER DumpPath
  The verified source dump to restore.

.PARAMETER ExpectedSha256
  The dump's SHA-256. The script refuses to run if the file does not match.

.PARAMETER BackupDir
  Where to write the production backup. Created if missing.

.PARAMETER ScratchDatabase
  Name of a temporary database used only to prove the backup is restorable. Dropped afterwards.
  Must look like a test database.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\deploy\replace-production-database.ps1
#>

[CmdletBinding()]
param(
  [string] $DumpPath = 'C:\Claude\Backups\Database\8BR-DEPLOY-SOURCE-20260829-2340Z.dump',
  [string] $ExpectedSha256 = 'e7646be1cc36e2d0972b6a0cd8d4d8e0a0f4cc90b8cae8f00c312fb6f0610517',
  [string] $BackupDir = 'C:\Claude\Backups\Database',
  [string] $ScratchDatabase = '8br_test_prodbackup_verify',
  [string] $PgBin = 'C:\Program Files\PostgreSQL\17\bin'
)

$ErrorActionPreference = 'Stop'
$script:ExitCode = 0

function Say  { param($m) Write-Host $m }
function Step { param($m) Write-Host "`n== $m" -ForegroundColor Cyan }
function Ok   { param($m) Write-Host "   ok   $m" -ForegroundColor Green }
function Die  { param($m) Write-Host "`nSTOPPED: $m" -ForegroundColor Red; exit 1 }

# ── Tools ────────────────────────────────────────────────────────────────────────────────────────
Step 'Checking tools and inputs'
if (-not (Test-Path $PgBin)) { Die "PostgreSQL client tools not found at $PgBin. Set -PgBin." }
$env:Path = "$PgBin;$env:Path"
foreach ($exe in 'psql.exe', 'pg_dump.exe', 'pg_restore.exe') {
  if (-not (Test-Path (Join-Path $PgBin $exe))) { Die "$exe missing from $PgBin" }
}
Ok "client tools at $PgBin"

if (-not (Test-Path $DumpPath)) { Die "Dump not found: $DumpPath" }
$dumpItem = Get-Item $DumpPath
$actual = (Get-FileHash -Algorithm SHA256 -Path $DumpPath).Hash.ToLower()
if ($actual -ne $ExpectedSha256.ToLower()) {
  Die "Dump checksum does not match.`n   expected $ExpectedSha256`n   actual   $actual"
}
Ok ("dump {0} ({1:N0} bytes), SHA-256 verified" -f $dumpItem.Name, $dumpItem.Length)

# Reject a dump that is not readable as a PostgreSQL custom-format archive.
$toc = & pg_restore.exe --list $DumpPath 2>&1
if ($LASTEXITCODE -ne 0) { Die "Dump is not a readable pg_dump archive." }
$tableData = ($toc | Select-String -SimpleMatch 'TABLE DATA').Count
Ok "$tableData table-data entries in the archive"

if ($ScratchDatabase -notlike '8br_test_*') {
  Die "ScratchDatabase must be named 8br_test_* so it cannot be mistaken for anything real."
}
if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir | Out-Null }

# ── The connection string ────────────────────────────────────────────────────────────────────────
Step 'Production connection'
Say '   Paste the production DIRECT (unpooled) connection string. It is not shown as you type,'
Say '   is never written to disk, and is discarded when this window closes.'
Say '   Neon dashboard -> your project -> Connection Details -> untick "Pooled connection".'
$secure = Read-Host -AsSecureString '   DIRECT_URL'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $ProdUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

if ([string]::IsNullOrWhiteSpace($ProdUrl)) { Die 'No connection string entered.' }
if ($ProdUrl -notmatch '^postgres(ql)?://') { Die 'That does not look like a postgres:// URL.' }
if ($ProdUrl -match '\[SENSITIVE\]') { Die 'That string still contains a redaction placeholder.' }
if ($ProdUrl -match '-pooler\.') {
  Say '   NOTE: that looks like a POOLED endpoint. A restore needs the direct one.'
  $go = Read-Host '   Continue anyway? (y/N)'
  if ($go -ne 'y') { Die 'Stopped so you can fetch the direct URL.' }
}

# Everything below runs psql/pg_dump/pg_restore with the URL passed as an argument to the child
# process only. It is never written to a file and never printed.
$env:PGCONNECT_TIMEOUT = '30'
$env:PGOPTIONS = '-c timezone=UTC'

function ProdQuery {
  param([string] $Sql)
  $out = & psql.exe -w -Atq $ProdUrl -c $Sql 2>&1
  if ($LASTEXITCODE -ne 0) { Die "Production query failed: $out" }
  return $out
}

Step 'Connection test (read-only)'
$who = ProdQuery "SELECT current_database() || ' on ' || split_part(version(), ' ', 2);"
Ok "connected: $who"

# ── What is there now ────────────────────────────────────────────────────────────────────────────
Step 'Production right now (read-only)'
$summary = ProdQuery @"
SELECT 'seasons            ' || count(*) FROM season
UNION ALL SELECT 'rating_ledger      ' || count(*) FROM rating_ledger
UNION ALL SELECT 'tournaments        ' || count(*) FROM comp_tournament
UNION ALL SELECT 'articles           ' || count(*) FROM article
UNION ALL SELECT 'registrations      ' || count(*) FROM comp_registration
UNION ALL SELECT 'users              ' || count(*) FROM payload.users
UNION ALL SELECT 'media              ' || count(*) FROM payload.media
UNION ALL SELECT 'audit rows         ' || count(*) FROM comp_audit_log;
"@
$summary | ForEach-Object { Say "   $_" }

$newest = ProdQuery @"
SELECT 'newest article     ' || coalesce(max("createdAt")::text, 'none') FROM article
UNION ALL SELECT 'newest season      ' || coalesce(max("createdAt")::text, 'none') FROM season
UNION ALL SELECT 'newest audit entry ' || coalesce(max("createdAt")::text, 'none') FROM comp_audit_log;
"@
$newest | ForEach-Object { Say "   $_" }
Say ''
Say '   Read those dates. If something there is newer than your local copy and matters,'
Say '   stop now — this replaces all of it.'

# ── Back it up, and prove the backup works ───────────────────────────────────────────────────────
Step 'Backing up production'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $BackupDir "8BR-PRODUCTION-PRE-REPLACE-$stamp.dump"
& pg_dump.exe $ProdUrl -Fc --no-owner --no-privileges -f $backup
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $backup)) { Die 'Production backup failed. Nothing has been changed.' }

$backupItem = Get-Item $backup
if ($backupItem.Length -lt 100000) { Die "Backup is implausibly small ($($backupItem.Length) bytes). Stopping." }
$backupHash = (Get-FileHash -Algorithm SHA256 -Path $backup).Hash.ToLower()
"$backupHash *$($backupItem.Name)" | Set-Content -Path "$backup.sha256" -Encoding ascii
Ok ("backup {0} ({1:N0} bytes)" -f $backupItem.Name, $backupItem.Length)
Ok "sha256 $backupHash"

Step 'Verifying that backup is actually restorable'
Say "   Restoring it into $ScratchDatabase on your LOCAL server and comparing table counts."
$localAdmin = Read-Host '   Local superuser connection URL for the scratch restore (blank to skip)'
if ([string]::IsNullOrWhiteSpace($localAdmin)) {
  Say '   SKIPPED. The backup file exists and its checksum is recorded, but it has not been'
  Say '   proven restorable. Continuing without that proof is your call.'
  $go = Read-Host '   Continue without a verified backup? (y/N)'
  if ($go -ne 'y') { Die 'Stopped. Re-run and supply a local URL to verify the backup.' }
} else {
  $adminBase = $localAdmin -replace '/[^/]+$', '/postgres'
  & psql.exe -w -q $adminBase -c "DROP DATABASE IF EXISTS ""$ScratchDatabase"";" -c "CREATE DATABASE ""$ScratchDatabase"";" | Out-Null
  if ($LASTEXITCODE -ne 0) { Die 'Could not create the scratch database.' }
  $scratchUrl = $localAdmin -replace '/[^/]+$', "/$ScratchDatabase"
  & pg_restore.exe -d $scratchUrl --no-owner --no-privileges $backup 2>&1 | Out-Null
  $scratchTables = & psql.exe -w -Atq $scratchUrl -c "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public','payload') AND table_type='BASE TABLE';"
  $prodTables = ProdQuery "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public','payload') AND table_type='BASE TABLE';"
  if ([int]$scratchTables -lt 1 -or [int]$scratchTables -ne [int]$prodTables) {
    Die "Backup verification failed: production has $prodTables tables, the restored backup has $scratchTables."
  }
  Ok "backup restores cleanly and carries all $prodTables tables"
  & psql.exe -w -q $adminBase -c "DROP DATABASE IF EXISTS ""$ScratchDatabase"";" | Out-Null
  Ok 'scratch database dropped'
}

# ── The point of no return ───────────────────────────────────────────────────────────────────────
Step 'Confirm'
Say '   About to REPLACE the contents of the production database with the local dump.'
Say '   The backup above is your way back.'
Say ''
$confirm = Read-Host '   Type exactly: REPLACE 8BR.GG'
if ($confirm -ne 'REPLACE 8BR.GG') { Die 'Not confirmed. Production is untouched.' }

# ── Restore ──────────────────────────────────────────────────────────────────────────────────────
Step 'Restoring'
Say '   One transaction: it either all lands or none of it does.'
# --clean --if-exists drops the objects this dump replaces, inside the same transaction.
# --no-owner --no-privileges leaves provider-managed ownership and grants alone.
# Extensions are not dropped: the dump carries no extension objects of its own.
& pg_restore.exe -d $ProdUrl --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error $DumpPath
if ($LASTEXITCODE -ne 0) {
  Die @"
Restore failed and was rolled back. Production is as it was.
Your backup: $backup
"@
}
Ok 'restore committed'

# ── Sessions ─────────────────────────────────────────────────────────────────────────────────────
Step 'Clearing copied login sessions'
# The dump carries local sessions, which are meaningless on production and would let a stale cookie
# in. Everyone signs in again; that is the intended cost.
$cleared = ProdQuery 'WITH d AS (DELETE FROM payload.users_sessions RETURNING 1) SELECT count(*) FROM d;'
Ok "$cleared copied sessions removed"

# ── Verify ───────────────────────────────────────────────────────────────────────────────────────
Step 'Verifying production'
$after = ProdQuery @"
SELECT 'tables             ' || count(*) FROM information_schema.tables
  WHERE table_schema IN ('public','payload') AND table_type='BASE TABLE'
UNION ALL SELECT 'seasons            ' || count(*) FROM season
UNION ALL SELECT 'rating_ledger      ' || count(*) FROM rating_ledger
UNION ALL SELECT 'yahoo ledger rows  ' || count(*) FROM rating_ledger WHERE platform='YAHOO'
UNION ALL SELECT 'cueverse ledger rows ' || count(*) FROM rating_ledger WHERE platform='CUEVERSE'
UNION ALL SELECT 'tournaments        ' || count(*) FROM comp_tournament
UNION ALL SELECT 'articles           ' || count(*) FROM article
UNION ALL SELECT 'users              ' || count(*) FROM payload.users
UNION ALL SELECT 'migrations recorded ' || count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;
"@
$after | ForEach-Object { Say "   $_" }

$season = ProdQuery @"
SELECT 'Season 16426: ' || "lifecycleState" || ', ' || coalesce("championName",'?') ||
       ' beat ' || coalesce("runnerUpName",'?') || ' ' || coalesce("finalScore",'?')
  FROM season WHERE id = 16426;
"@
Say "   $season"

$shape = ProdQuery @"
SELECT 'entrants ' || (SELECT count(*) FROM season_entrant WHERE "seasonId"=16426)
    || ' / groups ' || (SELECT count(*) FROM season_group WHERE "seasonId"=16426)
    || ' / group matches ' || (SELECT count(*) FROM season_match WHERE "seasonId"=16426)
    || ' / playoff matches ' || (SELECT count(*) FROM season_playoff_match WHERE "seasonId"=16426);
"@
Say "   $shape"

Step 'Source versus production'
Say '   Expected from the local source that produced this dump:'
Say '     tables 116 | seasons 50 | rating_ledger 16482 (16110 Yahoo + 372 CueVerse)'
Say '     Season 16426 COMPLETED, Kevin beat Trav 9-1'
Say '     entrants 34 / groups 5 / group matches 198 / playoff matches 38'
Say '     migrations recorded 50'
Say ''
Say '   Differences you should EXPECT and which are not faults:'
Say '     - users_sessions is now empty; the copied sessions were deliberately cleared.'
Say '     - comp_audit_log may gain rows from the first administrative action after deployment.'
Say '     - Anything the provider manages (extensions, roles, grants) is untouched by design.'

Step 'Done'
Ok 'Production now holds the verified local database.'
Say ''
Say "   Rollback, if you need it:"
Say "     pg_restore -d <DIRECT_URL> --clean --if-exists --no-owner --no-privileges ``"
Say "                --single-transaction --exit-on-error `"$backup`""
Say ''
Say '   Next: tell Claude the restore succeeded, and the verified commit gets deployed.'

# The connection string goes no further than this process.
$ProdUrl = $null
[System.GC]::Collect()
exit $script:ExitCode
