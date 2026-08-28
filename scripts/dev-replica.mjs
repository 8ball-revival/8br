/**
 * Start the site against the local PRODUCTION REPLICA, on port 3002.
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
 * 3002, never 3000. The dummy development server owns 3000, and two servers showing different data
 * on adjacent ports is survivable only if you can never mistake one for the other.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = path.join(ROOT, '.env.replica')
const PORT = '3002'

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
const url = env.DATABASE_URL ?? ''
const database = url.split('/').pop()?.split('?')[0] ?? ''
if (!/(localhost|127\.0\.0\.1)/.test(url) || database !== '8br_prod_replica_20260828') {
  console.error(`✗ Refusing to start against "${database || '(no DATABASE_URL)'}".`)
  console.error('  This command runs the replica and only the replica: a local database on the')
  console.error('  loopback interface named 8br_prod_replica_20260828. Production is never a target')
  console.error('  here, and there is no flag that makes it one.')
  process.exit(1)
}

console.log(`Replica → ${database} on 127.0.0.1, serving http://localhost:${PORT}`)
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
