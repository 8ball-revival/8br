/**
 * The development verification command.
 *
 * ── Why this wrapper exists ─────────────────────────────────────────────────────────────────────
 * Most of these suites write. They create Seasons, enter results, rebuild the rating ledger and
 * delete what they made — and when one is run straight against the development database, it leaves
 * marks. That is not hypothetical: during this very refactor, running individual suites with
 * `--env-file=.env` emptied the fixture ledger, and the failures that followed looked like broken
 * code rather than a damaged database.
 *
 * The fix is not "remember to point them somewhere else". It is that verification OWNS its target:
 * this builds a disposable clone of the fixture database, runs everything against the clone, and
 * drops it. The development database is never the thing being written to, so it cannot be damaged by
 * a test, and a suite that leaves rows behind harms nothing.
 *
 * ── What it refuses ─────────────────────────────────────────────────────────────────────────────
 * Anything that is not the local fixture database. Production, staging, an unknown local name and a
 * missing URL are all refused before a clone is created, because the first thing this does after
 * checking is DROP DATABASE.
 *
 * Usage:
 *   npm run verify                 build a clone, run everything, drop the clone
 *   npm run verify -- --keep       leave the clone in place afterwards, to inspect a failure
 */
import { execFileSync, execSync, spawn } from 'node:child_process'
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KEEP = process.argv.includes('--keep')
const CLONE = '8br_test'
const ENV_FILE = '.env.verify'

/*
 * `.env` is read here rather than required on the command line: `npm run verify` should just work,
 * and a command whose safety check depends on the caller having exported the right variable is a
 * safety check waiting to be bypassed by a forgetful shell.
 */
function readEnvFile(file) {
  if (!existsSync(file)) return {}
  const out = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const dotenv = readEnvFile(path.join(ROOT, '.env'))
const source = process.env.DATABASE_URL || dotenv.DATABASE_URL
const payloadSecret = process.env.PAYLOAD_SECRET || dotenv.PAYLOAD_SECRET
const database = (source ?? '').split('/').pop()?.split('?')[0] ?? ''

if (!source || !/(localhost|127\.0\.0\.1)/.test(source) || database !== '8br_dev_fixtures') {
  console.error(`✗ Refusing to verify against "${database || '(no DATABASE_URL)'}".`)
  console.error('  Verification clones its target and drops the clone, so it runs only against the')
  console.error('  local fixture database. Run `npm run dev:reset` if you do not have one.')
  process.exit(1)
}

/*
 * SQL goes through a FILE rather than -c.
 *
 * Database names have to be double-quoted in SQL, the connection URL has to be quoted for the
 * shell, and nesting the two collapses: `-c "create database "8br_test" ..."` reaches psql as
 * unquoted junk. A file has no quoting problem to get wrong.
 */
const adminUrl = source.replace(/\/[^/?]+(\?|$)/, '/postgres$1')
const SQL_FILE = path.join(ROOT, '.verify-sql.tmp')
const psql = (url, sql) => {
  writeFileSync(SQL_FILE, `${sql};\n`)
  try {
    execSync(`psql "${url}" -v ON_ERROR_STOP=1 -f "${SQL_FILE}"`, { stdio: 'pipe' })
  } finally {
    if (existsSync(SQL_FILE)) unlinkSync(SQL_FILE)
  }
}

function dropClone() {
  try {
    psql(adminUrl, `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${CLONE}'`)
    psql(adminUrl, `drop database if exists "${CLONE}"`)
  } catch { /* nothing to drop */ }
}

/** Wait for the server to answer, rather than sleeping a guessed number of seconds. */
async function waitForServer(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://localhost:3000/', { signal: AbortSignal.timeout(2000) })
      if (res.ok || res.status < 500) return
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('server did not start')
}

/** `next start` outlives its npm parent on Windows, so the port is cleared by owner. */
function killPort(port) {
  try {
    const out = execSync(`netstat -ano -p tcp | findstr LISTENING | findstr :${port}`, { encoding: 'utf8' })
    const pids = new Set(out.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/).pop()))
    for (const pid of pids) {
      if (pid && pid !== '0') {
        try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }) } catch { /* already gone */ }
      }
    }
  } catch { /* nothing listening */ }
}

console.log(`Cloning ${database} -> ${CLONE}`)
dropClone()

/*
 * The dev server is stopped BEFORE the clone, not merely disconnected.
 *
 * A template copy needs the source to have no open connections, and terminating them is not enough:
 * a running Next server has a pool that reconnects in the gap between the terminate and the create,
 * so the copy fails with "is being accessed by other users". Verification starts its own server
 * afterwards anyway, so taking the port first is both simpler and what makes this reliable.
 */
killPort(3000)
psql(adminUrl, `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${database}'`)
psql(adminUrl, `create database "${CLONE}" template "${database}"`)

const cloneUrl = source.replace(/\/[^/?]+(\?|$)/, `/${CLONE}$1`)
writeFileSync(path.join(ROOT, ENV_FILE), `DATABASE_URL="${cloneUrl}"\n${payloadSecret ? `PAYLOAD_SECRET="${payloadSecret}"\n` : ''}`)

/*
 * The env file is written from the CURRENT environment rather than copied from `.env`, so the only
 * difference between them is the database. It is deleted afterwards: a stray file naming a database
 * is how the next person runs a suite against the wrong one.
 */
/*
 * Some suites fetch pages as well as querying, so verification runs its own server — against the
 * CLONE, like everything else. Left to the operator, that server is the step that gets forgotten,
 * and the suites that need it fail in a way that looks like a broken page rather than a missing
 * process. A build is required first; `next start` serves whatever `.next` already holds.
 */
let server = null
try {
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' })
  server = spawn('npm', ['run', 'start'], {
    cwd: ROOT,
    stdio: 'ignore',
    shell: true,
    env: { ...process.env, DATABASE_URL: cloneUrl },
  })
  await waitForServer()
} catch {
  console.warn('  (could not start a server; page-level suites will report it)')
}

let status = 0
try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/run-all-verify.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, VERIFY_ENV_FILE: ENV_FILE, DATABASE_URL: cloneUrl },
  })
} catch (e) {
  status = e.status ?? 1
} finally {
  if (server) { try { process.kill(server.pid) } catch { /* already gone */ } killPort(3000) }
  if (existsSync(path.join(ROOT, ENV_FILE))) unlinkSync(path.join(ROOT, ENV_FILE))
  if (KEEP) {
    console.log(`\nClone kept: ${CLONE}`)
  } else {
    dropClone()
    console.log(`\nClone dropped. ${database} was not written to.`)
  }
}

process.exit(status)
