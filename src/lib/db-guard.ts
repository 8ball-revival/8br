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

/** Databases a destructive local command may touch. */
export const APPROVED_LOCAL_DATABASES = ['8br_dev_fixtures', '8br_test'] as const

/**
 * The ONLY databases a fixture, seed or reset may touch.
 *
 * Deliberately narrower than the list above and deliberately separate: reading is one risk, writing
 * invented data is another. Everything here holds dummy data and nothing else, so the worst outcome
 * of a mistake is a wasted minute re-seeding.
 */
export const FIXTURE_DATABASES = ['8br_dev_fixtures', '8br_test'] as const

/** Hostnames that are the local machine. */
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1', ''] as const

/** Databases that are production, named explicitly so a typo cannot reach them. */
/**
 * Named refusals, kept even though the host check would catch most of them.
 *
 * `eightballregistry_local_20260827` is the database serving 8br.gg. The two beside it are its
 * predecessors, retained only for rollback. `8br_dev_redesign` was the local authority until it was
 * preserved as a recovery copy; it is listed here so a stale `.env` pointing at it fails loudly
 * rather than quietly reviving a database that is supposed to be finished with.
 */
export const FORBIDDEN_DATABASES = [
  'neondb',
  'eightballregistry_local_20260827',
  'eightballregistry_prod_20260827',
  'eightballregistry_launch_20260818_1458',
  '8br_dev_redesign',
  '8br_dev_redesign_dirty_20260827',
  '8br_dev_postincident_20260827',
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


/**
 * Refuse to continue unless this process may write INVENTED data.
 *
 * The stricter sibling of `assertLocalDatabase`, for seeds, resets and fixtures — anything that puts
 * rows in a database that were never real. Two differences, both deliberate:
 *
 *   · It has no Vercel exemption. `assertLocalDatabase` returns early on Vercel because the deployed
 *     application is SUPPOSED to write to production. A fixture never is, anywhere, for any reason,
 *     so a seed that somehow runs in a deployment is refused rather than trusted.
 *   · It accepts only the fixture databases, which hold dummy data and nothing else. The wider
 *     development list is not good enough: reading real data locally is fine, overwriting it is not.
 *
 * There is no override flag. An escape hatch on a safety check becomes the thing everyone types.
 */
export function assertFixtureDatabase(
  context: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (isVercelRuntime(env)) {
    throw new Error(
      `${context}: refusing to run in a deployment.
`
      + '  Seeds and fixtures write invented data. Nothing deployed may do that, in any environment.',
    )
  }

  const verdict = inspectConnection(env.DATABASE_URL)
  const database = (env.DATABASE_URL ?? '').split('/').pop()?.split('?')[0] ?? ''
  const isFixtureDb = (FIXTURE_DATABASES as readonly string[]).includes(database)

  if (verdict.allowed && isFixtureDb) return

  throw new Error(
    `${context}: refusing to write fixtures to ${verdict.summary}.
`
    + `  ${verdict.allowed ? `"${database}" is not a fixture database.` : verdict.reason}
`
    + `  Fixtures may only be written to ${FIXTURE_DATABASES.join(' or ')} on localhost.
`
    + '  There is no override. Run `npm run dev:reset` to build a fixture database instead.',
  )
}


/**
 * The endpoint the production database lives on.
 *
 * Named as well as listed by database name, because the mistake worth catching is not "somebody
 * typed the production database's name" — it is a fresh database created on production's compute
 * and given an innocent name, which every name-based check would wave through.
 */
export const PRODUCTION_DB_ENDPOINT = 'ep-spring-sun'

/**
 * Refuse to let a PREVIEW deployment talk to production.
 *
 * Preview builds are made from whatever branch somebody pushed, they are shared by URL, and they run
 * the same code as production with none of the review. A preview pointed at the live database would
 * be a public, unreviewed, write-capable window onto the only copy of the competition record — and
 * the way that happens is not malice, it is an environment variable set on the wrong scope.
 *
 * Production itself is untouched by this: `VERCEL_ENV === 'production'` is exactly where the app is
 * supposed to reach production, so the check does not apply there.
 */
export function assertPreviewIsolation(env: NodeJS.ProcessEnv = process.env): void {
  /*
   * Two callers, one rule: nothing may reach production except production itself.
   *
   * A PREVIEW is refused because it is built from any pushed branch and shared by URL — a public,
   * unreviewed, write-capable window onto the only copy of the competition record.
   *
   * A LOCAL process is refused for the plainer reason: a developer's `.env` is the most likely place
   * a production URL ends up, and a local server that connects to production is one careless click
   * away from editing it. Production is served by Vercel, so nothing running off-Vercel has any
   * business there.
   *
   * `VERCEL_ENV === 'production'` is exactly where the app SHOULD reach production, so it returns.
   */
  if (env.VERCEL_ENV === 'production') return

  const url = env.DATABASE_URL ?? ''
  const database = url.split('/').pop()?.split('?')[0] ?? ''
  const looksLikeProduction =
    url.includes(PRODUCTION_DB_ENDPOINT)
    || (FORBIDDEN_DATABASES as readonly string[]).includes(database)

  if (looksLikeProduction) {
    const where = env.VERCEL_ENV === 'preview' ? 'Preview deployment' : 'Local process'
    throw new Error(
      [
        `${where} refused: DATABASE_URL points at production.`,
        `  database: ${database}`,
        '  Production is the sole authority for real data and is reached by the live site alone.',
        '  Development uses 8br_dev_fixtures; previews use the staging database.',
        '  Run `npm run dev:reset` to build a fixture database.',
      ].join('\n'),
    )
  }
}
