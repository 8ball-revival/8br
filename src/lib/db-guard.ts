/**
 * A hard stop between local development and the production database.
 *
 * The failure this exists to prevent is mundane and expensive: a `.env` still holding a production
 * URL, or a script run in the wrong shell, and a `db push` or a seed reshapes the live database. It
 * has nearly happened in this project already. The guard makes that outcome impossible to reach by
 * accident rather than merely unlikely.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────────────────────────
 * A mutating development command may only touch a database that is BOTH on the loopback interface
 * AND named as an approved development database. Both, not either — a local database called `neondb`
 * is refused, and so is a remote one called `8br_dev`.
 *
 * It fails CLOSED. An unparseable URL, a missing URL, an unrecognised host: all refused. The cost of
 * a false refusal is a puzzled developer; the cost of a false permit is the live site.
 *
 * ── What it deliberately does not do ─────────────────────────────────────────────────────────────
 * It never runs on Vercel. Production is where the application is SUPPOSED to write to production,
 * and a guard that fired there would take the site down. It also offers no bypass flag: an escape
 * hatch on a safety check becomes the thing everyone types.
 *
 * Read-only production tooling (backups, inspection) does not call this and must not — those
 * workflows are separately named and carry their own read-only enforcement.
 */

/**
 * Databases a destructive local command may touch.
 *
 * The two dated entries are COPIES of the live database, restored locally so live-site bugs can be
 * reproduced against the data that actually produces them. They are listed here on purpose: a script
 * run against one destroys a copy, which is the point of having one. Neither is a backup, neither is
 * a deployment source, and nothing in either may travel back the other way — the only thing that
 * leaves this worktree is reviewed code.
 *
 * `8br_live_copy_20260829` is the CURRENT one and what localhost:3000 serves.
 * `8br_prod_replica_20260828` is its predecessor, kept rather than dropped so anything mid-diagnosis
 * against it still runs.
 */
export const APPROVED_LOCAL_DATABASES = [
  '8br_dev', '8br_dev_redesign', '8br_test',
  '8br_live_copy_20260829', '8br_prod_replica_20260828',
] as const

/**
 * The shape of a database that exists to be destroyed.
 *
 * A verification sweep creates fixture Seasons, enters results, rebuilds the rating ledger and
 * closes competitions. Against a curated copy that is not a test, it is an edit -- and it has
 * happened here: the sweep once closed and rated a Season that was under review, because the only
 * thing standing between it and the live copy was remembering to set an environment variable.
 *
 * So a suite that can write now has to be pointed at a database whose NAME says it is disposable.
 * The name is the permission. `8br_test_yahoo_20260829` passes; `8br_live_copy_20260829` cannot,
 * whatever else is configured, because no amount of intent changes what it is called.
 */
export const DISPOSABLE_TEST_DATABASE = /^8br_test_[a-z0-9][a-z0-9_]*$/

/**
 * Local databases a MUTATING TEST may never touch, even though the application may.
 *
 * These are curated copies. The running site writes to `8br_live_copy_20260829` all day and must --
 * that is what it serves. A test suite doing the same thing is a different act entirely, and this is
 * the line between the two.
 */
export const PROTECTED_LOCAL_DATABASES = [
  '8br_live_copy_20260829', '8br_prod_replica_20260828', '8br_dev_fixtures',
] as const

/** Hostnames that are the local machine. */
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1', ''] as const

/**
 * Databases that are production, named explicitly so a typo cannot reach them.
 *
 * The two dated entries are the ones this guard did not know about and should have: on the Neon
 * `main` branch, `eightballregistry_local_20260827` is the database 8br.gg is served from right now,
 * and `eightballregistry_prod_20260827` is the pre-replacement backup kept for rollback. Both were
 * reachable by name until this list included them — the remote-host check would still have caught a
 * Neon URL, but a guard that names production should name the one that is actually production.
 */
export const FORBIDDEN_DATABASES = [
  'neondb',
  'eightballregistry_launch_20260818_1458',
  'eightballregistry_local_20260827',
  'eightballregistry_prod_20260827',
] as const

/** Host fragments that mean a managed remote provider. */
export const REMOTE_HOST_MARKERS = ['neon.tech', 'aws.neon', 'vercel-storage', 'supabase', 'rds.amazonaws'] as const

export interface GuardVerdict {
  allowed: boolean
  /** Safe to log: host, port and database only — never credentials. */
  summary: string
  reason?: string
}

/**
 * Decide whether a mutation may proceed against this connection string.
 *
 * Pure and synchronous so it can be called from anywhere and tested without a database. The URL is
 * PARSED rather than pattern-matched: `host.includes('localhost')` would happily accept
 * `postgres://user:pw@prod.example.com/db?host=localhost`.
 */
export function inspectConnection(rawUrl: string | undefined | null): GuardVerdict {
  if (!rawUrl || !rawUrl.trim()) {
    return { allowed: false, summary: '(no DATABASE_URL)', reason: 'No database URL is set.' }
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    // Unparseable means unknown, and unknown is refused.
    return { allowed: false, summary: '(unparseable URL)', reason: 'The database URL could not be parsed.' }
  }

  const host = url.hostname
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  // The summary is what gets printed. Deliberately no username and no password.
  const summary = `${host || '(socket)'}:${url.port || '5432'}/${database || '(none)'}`

  if (FORBIDDEN_DATABASES.includes(database as (typeof FORBIDDEN_DATABASES)[number])) {
    return { allowed: false, summary, reason: `"${database}" is a production database.` }
  }
  for (const marker of REMOTE_HOST_MARKERS) {
    if (host.includes(marker)) {
      return { allowed: false, summary, reason: `Host looks like a managed remote provider (${marker}).` }
    }
  }
  if (!LOOPBACK_HOSTS.includes(host as (typeof LOOPBACK_HOSTS)[number])) {
    return { allowed: false, summary, reason: `Host "${host}" is not the local machine.` }
  }
  const named = APPROVED_LOCAL_DATABASES.includes(database as (typeof APPROVED_LOCAL_DATABASES)[number])
  // A disposable clone is approved by its NAME rather than by being listed, because a new one is
  // created and dropped for every sweep and a list would always be one run out of date.
  if (!named && !DISPOSABLE_TEST_DATABASE.test(database)) {
    return {
      allowed: false,
      summary,
      reason: `"${database}" is not an approved local database (${APPROVED_LOCAL_DATABASES.join(', ')})`
        + ' and is not a disposable clone named 8br_test_<something>.',
    }
  }

  return { allowed: true, summary }
}

/**
 * Decide whether a MUTATING TEST may proceed against this connection string.
 *
 * Stricter than `inspectConnection` in one specific way: being a legitimate local development
 * database is no longer enough. The target has to be disposable by name, and the curated copies are
 * refused explicitly rather than merely failing the pattern -- so the error says WHY, and says it
 * about the database somebody actually pointed at.
 */
export function inspectDisposable(rawUrl: string | undefined | null): GuardVerdict {
  const base = inspectConnection(rawUrl)
  if (!base.allowed) return base

  const database = base.summary.slice(base.summary.lastIndexOf('/') + 1)
  if (PROTECTED_LOCAL_DATABASES.includes(database as (typeof PROTECTED_LOCAL_DATABASES)[number])) {
    return {
      allowed: false,
      summary: base.summary,
      reason: `"${database}" is a curated local copy, not a test database.`
        + ' Restore a fresh clone named 8br_test_<something> and point the suite at that instead.',
    }
  }
  if (!DISPOSABLE_TEST_DATABASE.test(database)) {
    return {
      allowed: false,
      summary: base.summary,
      reason: `"${database}" is not named as a disposable test database.`
        + ' A suite that can write may only run against 8br_test_<something>.',
    }
  }
  return { allowed: true, summary: base.summary }
}

/** Are we running as the deployed application rather than a developer's machine? */
export function isVercelRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL === '1' || env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview'
}

/**
 * Refuse to continue unless this process may safely mutate its database.
 *
 * Call at the top of any destructive local script — seeds, resets, pushes, fixtures.
 *
 * On Vercel this returns immediately: the deployed app is meant to write to production, and a guard
 * firing there would break the live site.
 */
export function assertLocalDatabase(
  context: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (isVercelRuntime(env)) return

  const verdict = inspectConnection(env.DATABASE_URL)
  if (verdict.allowed) return

  throw new Error(
    `${context}: refusing to run against ${verdict.summary}.\n`
    + `  ${verdict.reason}\n`
    + `  Destructive development commands may only touch ${APPROVED_LOCAL_DATABASES.join(', ')} on localhost.\n`
    + '  There is no override. Point DATABASE_URL at a local database instead.',
  )
}

/**
 * Refuse to continue unless this process may safely mutate a THROWAWAY database.
 *
 * Call at the top of the verification sweep, and of any suite that writes. Unlike
 * `assertLocalDatabase` this never exempts Vercel: a test sweep has no business running there at
 * all, so there is nothing to exempt.
 */
export function assertDisposableTestDatabase(
  context: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const verdict = inspectDisposable(env.DATABASE_URL)
  if (verdict.allowed) return

  throw new Error(
    `${context}: refusing to run a mutating suite against ${verdict.summary}.\n`
    + `  ${verdict.reason}\n`
    + '  Suites that can write may only run against a disposable clone named 8br_test_<something>\n'
    + '  on localhost. There is no override.',
  )
}
