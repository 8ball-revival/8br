/**
 * Start the site against the local COPY OF THE LIVE DATABASE, on port 3000.
 *
 * ── Why a launcher rather than `node --env-file=.env.replica next dev` ──────────────────────────
 * Next spawns worker processes and passes the parent's flags down through NODE_OPTIONS, and Node
 * refuses `--env-file=` there — so the obvious one-liner starts, forwards itself into its own child,
 * and dies with "not allowed in NODE_OPTIONS". Reading the file here and handing the values to the
 * child as ordinary environment variables sidesteps the flag entirely.
 *
 * ── Why not just call the file `.env` ───────────────────────────────────────────────────────────
 * Next would pick that up automatically, which is precisely the problem: a file named `.env` is the
 * one every other command in this repository also reads. The replica must be something you opt into
 * by name. `npm run dev:replica` is the only thing that loads `.env.replica`, so no test, seed or
 * script can wander into a copy of live data by default.
 *
 * ── The port ────────────────────────────────────────────────────────────────────────────────────
 * 3000 — the primary development environment, by explicit decision.
 *
 * It was 3002 while the dummy fixtures server owned 3000, on the reasoning that two servers showing
 * different data are only safe if you cannot mistake one for the other. That reasoning is now
 * inverted: development happens against a copy of the real record, so the real record is what the
 * default port serves, and the fixtures server is the one you start deliberately.
 *
 * What that costs is worth naming. Port 3000 now shows real people's names, handles and results by
 * default, so a screen share or a screenshot is showing member data rather than DEV_ placeholders.
 * The guard below is unchanged and is what keeps this to a COPY: the live database is never a
 * target, whatever port anything is on.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = path.join(ROOT, '.env.replica')
const PORT = '3000'

if (!existsSync(ENV_FILE)) {
  console.error('✗ .env.replica is missing.')
  console.error('  This worktree runs against a local replica of the live database, and that file is')
  console.error('  the only thing that says which one. It is deliberately untracked: it is never')
  console.error('  committed, and it is never recreated from the repository.')
  process.exit(1)
}

/** A deliberately small parser: KEY="value" and KEY=value, ignoring blanks and comments. */
const env = {}
for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

/*
 * The one check worth making before anything starts.
 *
 * The whole arrangement rests on this process only ever talking to a local copy. If the file has
 * been edited to point somewhere else, the useful failure is here — before a server is listening and
 * before anything has been written — rather than at whatever the first mutating request happens to
 * be. The guard is the same one every destructive script uses; this is not a second opinion.
 */
const LOCAL_COPY = '8br_live_copy_20260829'
const url = env.DATABASE_URL ?? ''
const database = url.split('/').pop()?.split('?')[0] ?? ''
if (!/(localhost|127\.0\.0\.1)/.test(url) || database !== LOCAL_COPY) {
  console.error(`✗ Refusing to start against "${database || '(no DATABASE_URL)'}".`)
  console.error(`  This command runs the local copy and only the local copy: a database on the`)
  console.error(`  loopback interface named ${LOCAL_COPY}. Production is never a target here, and`)
  console.error('  there is no flag that makes it one.')
  process.exit(1)
}

console.log(`Local copy → ${database} on 127.0.0.1, serving http://localhost:${PORT}`)
console.log('Email, Blob writes, cron, webhooks and every external integration are absent by')
console.log('omission: none of their credentials exist in this process.\n')

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'dev', '-p', PORT],
  {
    cwd: ROOT,
    stdio: 'inherit',
    /*
     * `NODE_OPTIONS` is cleared rather than inherited. Whatever started this may have set flags that
     * Next's own workers reject, and a replica that fails to boot because of an unrelated option in
     * the parent shell is a confusing way to lose an afternoon.
     */
    env: { ...process.env, ...env, NODE_OPTIONS: '--no-deprecation' },
  },
)

child.on('exit', (code) => process.exit(code ?? 0))
