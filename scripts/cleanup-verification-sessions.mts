/**
 * Remove the sessions the Phase 2 browser verification created, and nothing else.
 *
 * ── Why this needs a script rather than a DELETE ────────────────────────────────────────────────
 * The sessions in question predate the marker prefix that new ones carry, so they cannot be swept by
 * pattern. They have to be identified by evidence, and the evidence has to be checked rather than
 * assumed — a script that deletes "everything recent" would take a real sign-in with it.
 *
 * ── The evidence, and why all three parts are required ──────────────────────────────────────────
 * A row is deleted only when EVERY one of these holds:
 *
 *   1. It belongs to the account the verification suites sign in as, and no other.
 *   2. It was created after the Phase 2 baseline fingerprint was taken. The nine rows that existed
 *      at that moment are enumerated below by id, so "after the baseline" is checked against the
 *      actual list rather than against a timestamp comparison that could drift.
 *   3. Its lifetime is the token expiration, within two seconds. The route computed `createdAt` and
 *      `expiresAt` from two separate `Date.now()` calls, so a millisecond of skew is expected — one
 *      row here is exactly one millisecond short. (The route now takes the instant once, so future
 *      sessions are exact.) A session that has been USED drifts by minutes or hours, because Payload
 *      extends it as it goes; the baseline rows range from seven minutes to a week out.
 *
 * Criterion 3 alone would not be enough, and it is worth being clear why: two of the nine baseline
 * sessions ALSO have an exact interval, because a login that is never used again never drifts. It is
 * the enumerated baseline in criterion 2 that carries the weight. All three are required together.
 *
 * Any row failing any of the three is left alone and reported, so a surprise is visible rather than
 * silently swept up.
 *
 * ── What it does NOT do ─────────────────────────────────────────────────────────────────────────
 * It does not replace the users table, the roles table, or any row in them. It deletes session rows
 * and nothing else, and it prints the account's identity and credential hashes before and after so
 * that "nothing else changed" is demonstrated rather than claimed.
 *
 * Run: npm run cleanup:verification-sessions           (reports, changes nothing)
 *      npm run cleanup:verification-sessions -- --apply
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const raw of readFileSync(file, 'utf8').split(String.fromCharCode(10))) {
      const line = raw.trim()
      const eq = line.indexOf('=')
      if (eq < 1 || line.startsWith('#')) continue
      const key = line.slice(0, eq).trim()
      if (!/^[A-Z0-9_]+$/.test(key)) continue
      let value = line.slice(eq + 1).trim()
      if (value.length > 1 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
        value = value.slice(1, -1)
      }
      out[key] = value
    }
  } catch { /* no such file */ }
  return out
}

const env = readEnvFile('.env.replica')
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL ?? ''
if (!process.env.DIRECT_URL) process.env.DIRECT_URL = env.DIRECT_URL ?? process.env.DATABASE_URL ?? ''

/*
  Deliberately NOT behind `assertDisposableTestDatabase`.

  This is the one script whose whole purpose is to tidy the working development database, so the
  disposable guard would refuse the only thing it is for. It is protected differently instead: it is
  read-only without `--apply`, it refuses any host that is not local, it deletes only rows that
  satisfy all three pieces of evidence, and it prints what it is about to do first.
*/
const url = process.env.DATABASE_URL ?? ''
const host = (() => { try { return new URL(url).hostname } catch { return '' } })()
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`\nRefusing to run against "${host || '(unparseable)'}". This script is for the local copy only.\n`)
  process.exit(1)
}

const APPLY = process.argv.includes('--apply')

/**
 * The nine sessions that existed when `.fingerprints/phase2-before.txt` was taken.
 *
 * Enumerated rather than inferred. They are also exactly the nine in the pre-work backup
 * `LOCAL-8br_live_copy_20260829-before-yahoo-20260829-202252Z.dump`, which is where this list comes
 * from — so "the baseline" is a thing on disk, not a memory of one.
 */
const BASELINE_SESSION_IDS = new Set([
  '1735d650-33b3-4eef-a667-67dd24e7f115',
  'eeaaf8cf-f7bb-4c06-9024-47ba8d15d0b1',
  '2c1226c0-4ba5-4e61-9896-2022a331077c',
  '5af78227-c41b-4d56-821a-6f35fe90915b',
  '40e994c6-bafd-44d5-89ac-38ba10b12394',
  '73891ce8-85dd-4bf1-aac3-dcd2860f1614',
  'bde4c403-1153-4b43-a0af-20534e72d7d5',
  'a850af8f-55b0-4046-9ac7-a42c25ed22c1',
  'd25eedcf-668c-4471-8e37-6f2ccbfa1890',
])

/** Payload's configured session lifetime here, in milliseconds. */
const TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

/**
 * How far from that a lifetime may be and still count as machine-issued.
 *
 * Two seconds. Wide enough for the millisecond of skew the route used to produce, and narrower than
 * anything a used session shows by three orders of magnitude — the closest baseline row is seven
 * minutes out.
 */
const LIFETIME_TOLERANCE_MS = 2000

const { E2E_SESSION_PREFIX } = await import('../src/lib/site-builder/e2e-marker')
const { prisma } = await import('../src/lib/prisma')

const email = env.SITE_BUILDER_E2E_EMAIL || process.env.SITE_BUILDER_E2E_EMAIL || ''
const verifier = await prisma.$queryRaw<{ id: number }[]>`
  SELECT "id" FROM payload.users WHERE "email" = ${email} LIMIT 1
`
if (!verifier.length) {
  console.error(`\nNo account found for "${email}". Nothing to do.\n`)
  process.exit(1)
}
const verifierId = verifier[0].id

/** The account's identity and credentials, hashed, so before and after can be compared safely. */
async function identityFingerprint(): Promise<{ user: string; roles: string; users: number; sessions: number }> {
  const [user] = await prisma.$queryRaw<{ t: string }[]>`
    SELECT "id" || '|' || coalesce("email",'') || '|' || coalesce("hash",'') || '|' || coalesce("salt",'')
           || '|' || coalesce("username",'') AS t
    FROM payload.users WHERE "id" = ${verifierId}
  `
  const [roles] = await prisma.$queryRaw<{ t: string }[]>`
    SELECT coalesce(string_agg("parent_id" || ':' || "value", E'\n' ORDER BY "parent_id", "value"), '') AS t
    FROM payload.users_roles
  `
  const [{ n: users }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM payload.users`
  const [{ n: sessions }] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM payload.users_sessions`
  return {
    user: createHash('sha256').update(user.t).digest('hex').slice(0, 16),
    roles: createHash('sha256').update(roles.t).digest('hex').slice(0, 16),
    users: Number(users),
    sessions: Number(sessions),
  }
}

const before = await identityFingerprint()

const rows = await prisma.$queryRaw<{
  id: string; parent: number; created: Date | null; expires: Date
}[]>`
  SELECT "id", "_parent_id" AS parent, "created_at" AS created, "expires_at" AS expires
  FROM payload.users_sessions ORDER BY "created_at"
`

const classified = rows.map((row) => {
  const isVerifierAccount = row.parent === verifierId
  const isBaseline = BASELINE_SESSION_IDS.has(row.id)
  const lifetime = row.created ? row.expires.getTime() - row.created.getTime() : null
  const exactLifetime = lifetime !== null && Math.abs(lifetime - TOKEN_LIFETIME_MS) <= LIFETIME_TOLERANCE_MS

  return {
    ...row,
    isVerifierAccount,
    isBaseline,
    lifetime,
    exactLifetime,
    // All three, or it stays.
    verificationCreated: isVerifierAccount && !isBaseline && exactLifetime,
  }
})

/*
  Sessions issued AFTER the marker existed identify themselves.

  Everything above is the evidence needed for the rows that predate it. A marked row needs none —
  nothing else in the application produces that prefix — so it is included without argument.
*/
const marked = classified.filter((c) => c.id.startsWith(E2E_SESSION_PREFIX))
for (const m of marked) m.verificationCreated = true

const toDelete = classified.filter((c) => c.verificationCreated)
const kept = classified.filter((c) => !c.verificationCreated)

console.log(`\n  account:              ${email} (id ${verifierId})`)
console.log(`  sessions now:         ${rows.length}`)
console.log(`  baseline (keep):      ${classified.filter((c) => c.isBaseline).length} of the 9 enumerated`)
console.log(`  verification-created: ${toDelete.length}`)
console.log(`  other, left alone:    ${kept.length - classified.filter((c) => c.isBaseline).length}\n`)

console.log('  kept:')
for (const c of kept) {
  const why = c.isBaseline
    ? 'in the pre-Phase-2 baseline'
    : !c.isVerifierAccount
      ? `belongs to user ${c.parent}, not the verification account`
      : !c.exactLifetime
        ? `lifetime is ${Math.round(((c.lifetime ?? 0) - TOKEN_LIFETIME_MS) / 1000)}s off the token lifetime — a session that has been used`
        : 'not identified as verification-created'
  console.log(`    ${c.id}  ${c.created?.toISOString() ?? '(no created_at)'}  ${why}`)
}

if (toDelete.length) {
  console.log(`\n  ${APPLY ? 'deleting' : 'would delete'}:`)
  for (const c of toDelete) {
    const skew = (c.lifetime ?? 0) - TOKEN_LIFETIME_MS
    console.log(`    ${c.id}  ${c.created?.toISOString()}  machine-issued lifetime (${skew === 0 ? 'exact' : `${skew}ms skew`}), after the baseline, verification account`)
  }
}

if (!APPLY) {
  console.log('\n  Nothing was changed. Re-run with --apply to delete the rows listed above.\n')
  await prisma.$disconnect()
  process.exit(0)
}

if (toDelete.length) {
  const deleted = await prisma.$executeRaw`
    DELETE FROM payload.users_sessions
    WHERE "id" = ANY(${toDelete.map((c) => c.id)}::text[])
  `
  console.log(`\n  deleted ${deleted} session row${deleted === 1 ? '' : 's'}`)
}

const after = await identityFingerprint()

console.log('\n  ── proof ─────────────────────────────────────────────────────')
console.log(`  users, count:         ${before.users} → ${after.users}   ${before.users === after.users ? 'unchanged' : 'CHANGED'}`)
console.log(`  identity + hash+salt: ${before.user} → ${after.user}   ${before.user === after.user ? 'unchanged' : 'CHANGED'}`)
console.log(`  every role assignment:${before.roles} → ${after.roles}   ${before.roles === after.roles ? 'unchanged' : 'CHANGED'}`)
console.log(`  sessions, count:      ${before.sessions} → ${after.sessions}`)
console.log(`  baseline intact:      ${(await prisma.$queryRaw<{ n: bigint }[]>`
  SELECT count(*)::bigint AS n FROM payload.users_sessions WHERE "id" = ANY(${[...BASELINE_SESSION_IDS]}::text[])
`)[0].n} of 9\n`)

const ok = before.users === after.users && before.user === after.user && before.roles === after.roles
console.log(ok
  ? '  Identity, credentials and roles are byte-identical. Only session rows were removed.\n'
  : '  SOMETHING ELSE CHANGED. Investigate before continuing.\n')

await prisma.$disconnect()
process.exit(ok ? 0 : 1)
