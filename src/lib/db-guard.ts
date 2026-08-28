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
 * `8br_prod_replica_20260828` is a COPY of the live database, restored locally so live-site bugs can
 * be reproduced against the data that actually produces them. It is listed here on purpose: a script
 * run against it destroys a copy, which is the point of having one. It is not a backup, not a
 * deployment source, and nothing in it may travel back the other way — the only thing that leaves
 * this worktree is reviewed code.
 */
export const APPROVED_LOCAL_DATABASES = [
  '8br_dev', '8br_dev_redesign', '8br_test', '8br_prod_replica_20260828',
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
  if (!APPROVED_LOCAL_DATABASES.includes(database as (typeof APPROVED_LOCAL_DATABASES)[number])) {
    return {
      allowed: false,
      summary,
      reason: `"${database}" is not an approved local database (${APPROVED_LOCAL_DATABASES.join(', ')}).`,
    }
  }

  return { allowed: true, summary }
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
