/**
 * No test account, and no credential, left anywhere.
 *
 * ── Why this is a standing suite and not a one-off grep ──────────────────────────────────────────
 * Testing an authenticated surface means an account existed for a while, and the ways it leaves a
 * trace are not obvious: a handle hard-coded in a helper, an address in a fixture, a token pasted
 * into a script "just to get it working", a Player row whose user is gone. Each is easy to create
 * and invisible afterwards. This makes the absence of all of them something the suite can state.
 *
 * It also guards the reverse mistake: a cleanup that removes real accounts. Members created through
 * the Member Management page during testing belong to the operator and must survive.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

/** Every tracked source file, so a credential cannot hide in a helper nobody reads. */
function sourceFiles(): string[] {
  const out: string[] = []
  const skip = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'backups', 'tmp-shots'])
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue
      const full = `${dir}/${e.name}`
      if (e.isDirectory()) walk(full)
      else if (/\.(ts|tsx|mts|mjs|js|jsx|json|sql|md|env\..*)$/.test(e.name) && statSync(full).size < 2_000_000) out.push(full)
    }
  }
  for (const root of ['src', 'scripts', 'prisma']) { try { walk(root) } catch { /* absent */ } }
  return out
}

/*
 * The scan excludes itself.
 *
 * It has to name the things it is looking for, so its own text matches every pattern in it. Any
 * other file matching is a finding.
 */
const SELF = 'scripts/verify-no-test-credentials.mts'
const FILES = sourceFiles().filter((f) => !f.endsWith('verify-no-test-credentials.mts'))
const read = (f: string) => { try { return readFileSync(f, 'utf8') } catch { return '' } }
const hits = (pattern: RegExp) => FILES.filter((f) => pattern.test(read(f)))
void SELF

try {
  section('No credential is written down anywhere in the tree')

  /*
   * A password would be a literal. A session token is a JWT — three base64 segments — and the header
   * of every JWT this app issues starts the same way, which makes one greppable even though the rest
   * of it is random.
   */
  const jwt = hits(/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\./)
  check('no session token is stored in the source tree', jwt.length === 0, jwt.join(', '))

  const invalidEmails = hits(/@local\.invalid/)
  check('no test account address remains', invalidEmails.length === 0, invalidEmails.join(', '))

  const generated = hits(/\b(Zz|Zt)-[A-Za-z0-9_-]{20,}/)
  check('no generated password remains', generated.length === 0, generated.join(', '))

  const envLike = hits(/CREATOR_TEST_TOKEN\s*=\s*['"][A-Za-z0-9._-]{20,}/)
  check('no token is baked into a script default', envLike.length === 0, envLike.join(', '))

  /*
   * Not "no file called tmp-*" — one such script is a committed archive utility that predates this
   * work. What must not survive is a script that still names a fixture account, which is the thing
   * that would quietly recreate or reference one.
   */
  const FIXTURE_HANDLES = /zz_ui_test_admin|zz_ui_probe|zz_browser_test_admin|browser-harness/
  const fixtureScripts = FILES.filter((f) => f.startsWith('scripts/') && FIXTURE_HANDLES.test(read(f)))
  check('no leftover script still references a fixture account', fixtureScripts.length === 0, fixtureScripts.join(', '))

  section('No test account remains in the database')
  const raw = <T>(sql: string, ...a: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...a)
  const n = async (sql: string, ...a: unknown[]) => Number((await raw<{ c: bigint }>(sql, ...a))[0].c)

  /*
   * The fixture handles by name, rather than by prefix.
   *
   * Banning everything beginning "zz_" caught zz_lazyass_zz, who played four archived Seasons
   * between 2011 and 2013. A naming convention chosen for fixtures cannot be assumed unused by
   * people who were playing years before it existed.
   */
  check('no user with a testing handle',
    await n(`SELECT count(*) c FROM payload.users WHERE username IN ('zz_ui_test_admin','zz_ui_probe','zz_browser_test_admin','browser-harness')`) === 0)
  check('...nor a non-deliverable test address',
    await n(`SELECT count(*) c FROM payload.users WHERE email LIKE '%@local.invalid'`) === 0)
  check('...nor a Player profile for one',
    (await prisma.player.count({
      where: { cueverseId: { in: ['zz_ui_test_admin', 'zz_ui_probe', 'zz_browser_test_admin', 'browser-harness'] } },
    })) === 0)
  check('...nor an alias', (await prisma.playerAlias.count({ where: { alias: { startsWith: 'zz_' } } })) === 0)
  check('...nor a fixture audit entry',
    (await prisma.auditLog.count({ where: { actorUsername: { in: ['browser-harness', 'zz_ui_test_admin', 'zz_ui_probe', 'zz_browser_test_admin'] } } })) === 0)

  section('Nothing was orphaned by the cleanup')
  check('no session belongs to a user that is gone',
    await n(`SELECT count(*) c FROM payload.users_sessions s WHERE NOT EXISTS (SELECT 1 FROM payload.users u WHERE u.id = s._parent_id)`) === 0)
  check('no role row does either',
    await n(`SELECT count(*) c FROM payload.users_roles r WHERE NOT EXISTS (SELECT 1 FROM payload.users u WHERE u.id = r.parent_id)`) === 0)

  const linked = await prisma.player.findMany({ where: { linkedUserId: { not: null } }, select: { cueverseId: true, linkedUserId: true } })
  const live = new Set((await raw<{ id: number }>(`SELECT id FROM payload.users`)).map((u) => u.id))
  const orphans = linked.filter((p) => !live.has(Number(p.linkedUserId)))
  check('no Player is linked to a user that no longer exists', orphans.length === 0, orphans.map((o) => o.cueverseId).join(', '))

  const aliasOrphans = await n(
    `SELECT count(*) c FROM "PlayerAlias" a WHERE NOT EXISTS (SELECT 1 FROM "Player" p WHERE p.id = a."playerId")`,
  ).catch(async () => n(
    `SELECT count(*) c FROM player_alias a WHERE NOT EXISTS (SELECT 1 FROM player p WHERE p.id = a.player_id)`,
  ))
  check('no alias belongs to a deleted profile', aliasOrphans === 0, String(aliasOrphans))

  section('The operator’s own accounts survived')
  /*
   * Identified by their creation entry, not by their handle.
   *
   * The first version of this check listed five handles. One of them (rtc_robbinz) then failed it —
   * not because the cleanup removed the account, but because the operator RENAMED it, which they are
   * free to do at any time. A test that treats a renameable label as an identity reports a deletion
   * that never happened.
   *
   * The audit log records every member created through the page. Each one must still have a live
   * profile, found either under the handle it was created with or under the alias that handle became.
   */
  const created = await prisma.auditLog.findMany({
    where: { action: 'member.create' },
    select: { newValue: true, createdAt: true },
  })
  const createdHandles = created
    .map((c) => (c.newValue as { cueverseId?: string } | null)?.cueverseId)
    /*
     * `zz…` is the fixture marker used across every suite here, with or without the underscore.
     * Those accounts are created and removed by the suites that own them, so their creation entries
     * outlive them by design and are not evidence of anything.
     */
    .filter((h): h is string => typeof h === 'string' && !/^zz/i.test(h))

  const missing: string[] = []
  for (const handle of createdHandles) {
    const key = handle.trim().toLowerCase()
    const byId = await prisma.player.count({ where: { cueverseIdNormalized: key } })
    if (byId > 0) continue
    /*
     * A rename leaves the old handle behind as a searchable alias, stripped of separators — and
     * stored with its original casing, so the comparison has to ignore case. Matching exactly
     * reported a live account (Aaron, now under another handle) as missing.
     */
    const byAlias = await prisma.playerAlias.count({
      where: { alias: { equals: key.replace(/[^a-z0-9]/g, ''), mode: 'insensitive' } },
    })
    if (byAlias > 0) continue
    /*
     * A merged member is meant to be gone.
     *
     * Six handles were absorbed into the accounts the owner confirmed they belonged to. The merge
     * keeps the record and retires the duplicate identity, so finding no Player under the old
     * handle is the merge having worked, not a member having been lost.
     */
    /*
     * A merged member is meant to be gone, and its handle lives on as an alias.
     *
     * Looking only at the retired row's own name missed HaVoK_73, whose row carries a different
     * Preferred Name. The alias is the durable trace of the old handle, so that is what to look for.
     */
    const merged = await prisma.playerMerge.count({
      where: {
        OR: [
          { mergedPlayer: { primaryName: { equals: handle, mode: 'insensitive' } } },
          { canonicalPlayer: { aliases: { some: { alias: { equals: handle, mode: 'insensitive' } } } } },
        ],
      },
    })
    if (merged === 0) missing.push(handle)
  }
  check(`every member created through the page still exists (${createdHandles.length} checked)`,
    missing.length === 0, missing.join(', '))

  section('Global settings are exactly as they were')
  /*
   * Not "a sensible default" — the same two rows, with the same values. Registration was already
   * PRIVATE with a code set, so nothing needed changing to run the tests and nothing was changed.
   */
  const settings = await raw<{ key: string; value: string }>(`SELECT key, value FROM site_setting ORDER BY key`)
  check('site_setting still holds exactly two rows', settings.length === 2, JSON.stringify(settings))
  check('...registration is still PRIVATE',
    settings.find((s) => s.key === 'registrationMode')?.value === 'PRIVATE')
  check('...with its original code intact',
    settings.find((s) => s.key === 'registrationCode')?.value === 'luna')
} catch (e) {
  /*
   * A throw is a failed suite, not a short one.
   *
   * Without this, an exception halfway through skipped every remaining check and still printed a
   * clean-looking RESULT line — the counter only knows about checks that ran.
   */
  fail++
  console.log('  ✗ the suite threw before finishing — ' + (e as Error).message.split('\n')[0])
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
