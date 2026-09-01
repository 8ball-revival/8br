# =============================================================================
# Launcher for the live-copy development server, for tools that can only start
# a process by absolute path (the Browser pane's launch.json among them).
#
# It does nothing of its own: it sets the working directory and runs the
# existing `npm run dev:replica`, which is the ONLY command that loads
# `.env.replica` and which carries the guard that refuses any database that is
# not the local copy. Nothing here weakens that guard or bypasses it.
# =============================================================================
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
npm run dev:replica
