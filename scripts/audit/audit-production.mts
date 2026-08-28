/**
 * Is the competition record still intact?
 *
 * ── What this is, and what it is not ────────────────────────────────────────────────────────────
 * These are the assertions that used to sit inside the verification suites and made them impossible
 * to run without a copy of production: the 2005 season still has its champion, the tribute article
 * still has its body, the ladder still holds the same people. They are questions about the RECORD,
 * not about the application, and only production can answer them.
 *
 * They are not part of `npm run verify`. Development proves behaviour against invented fixtures and
 * must never need real data to do it. This runs when somebody wants to know the record is unharmed —
 * after a deployment, after a migration, or on suspicion.
 *
 * Read-only, enforced by PostgreSQL for the whole session. It creates nothing: no fixtures, no audit
 * rows, no sessions. It refuses to run without an explicit connection and an explicit --confirm.
 *
 * Usage:
 *   PRODUCTION_AUDIT_URL="postgresql://..." npm run audit:production -- --confirm
 */
import { openAudit, assertReadOnly } from './_guard.mts'

const ctx = await openAudit()
const { db, check, section } = ctx

await assertReadOnly(ctx)

const one = async <T>(sql: string): Promise<T> => {
  const rows = await db.$queryRawUnsafe<Record<string, T>[]>(sql)
  return Object.values(rows[0] ?? {})[0] as T
}
const num = async (sql: string): Promise<number> => Number(await one<bigint | number>(sql))

section('The archive still has its seasons and its champions')

/*
 * Season 443 is 8BRCAM Season 1, 2005 — the oldest record on the site and the one every historical
 * reconstruction was measured against. If it has lost its champion, something has rewritten history.
 */
const s443 = await db.$queryRawUnsafe<{ number: number; championName: string | null; lifecycleState: string }[]>(
  `select number, "championName", "lifecycleState" from public.season where id = 443`)
check('the 2005 Season 1 is still there', s443.length === 1)
check('...still completed', s443[0]?.lifecycleState === 'COMPLETED', s443[0]?.lifecycleState)
check('...and still has its champion', (s443[0]?.championName ?? '') !== '', s443[0]?.championName ?? 'none')
check('...and still holds its playoff bracket',
  await num(`select count(*) from public.season_playoff_match where "seasonId" = 443`) > 0)

const completed = await num(`select count(*) from public.season where "lifecycleState" = 'COMPLETED'`)
const withChampion = await num(
  `select count(*) from public.season where "lifecycleState" = 'COMPLETED' and "championPlayerId" is not null`)
check('every completed Season has a champion', completed === withChampion, `${withChampion} of ${completed}`)
check('...and there are still 48 of them', completed === 48, String(completed))

/*
 * Completed Seasons were deliberately published on 2026-08-27; before that the archive was
 * unreachable to anyone signed out. A completed Season that has gone private again is a regression.
 */
check('every completed Season is still public',
  await num(`select count(*) from public.season where "lifecycleState" = 'COMPLETED' and not "publiclyVisible"`) === 0)

section('The ladder still holds the same people')

const ledgerRows = await num(`select count(*) from public.rating_ledger`)
const rankedPlayers = await num(`select count(distinct "playerId") from public.rating_ledger`)
check('the rating ledger still has 16,110 rows', ledgerRows === 16110, String(ledgerRows))
check('...covering 498 ranked players', rankedPlayers === 498, String(rankedPlayers))
check('...and every row still names its platform',
  await num(`select count(*) from public.rating_ledger where platform is null`) === 0)

section('Accounts and identity')

const users = await num(`select count(*) from payload.users`)
const players = await num(`select count(*) from public."Player"`)
const managementOnly = await num(`select count(*) from public."Player" where "managementOnly" and "linkedUserId" is not null`)
const deleted = await num(`select count(*) from public.member_moderation where status = 'DELETED'`)
check('there are still 516 accounts', users === 516, String(users))
check('...and a Player for each', players === users, `${players} players, ${users} accounts`)
check('Member Management still resolves to 508', users - managementOnly - deleted === 508,
  String(users - managementOnly - deleted))

/*
 * Aliases carry a normalised key for matching and, since 2026-08-27, an optional spelling for
 * display. A key is mandatory; a missing key means an alias nothing can resolve.
 */
check('every alias still has a match key',
  await num(`select count(*) from public."PlayerAlias" where alias is null or btrim(alias) = ''`) === 0)

section('Editorial')

check('the Major League Pool tribute is still published',
  await num(`select count(*) from public.break_post where title ilike '%MAJOR LEAGUE POOL%' and state = 'PUBLISHED'`) === 1)
check('...and still has a body',
  await num(`select count(*) from public.break_post where title ilike '%MAJOR LEAGUE POOL%' and "bodyText" is not null and length("bodyText") > 100`) === 1)

section('Settings')

const settings = await db.$queryRawUnsafe<{ key: string; value: string }[]>(
  `select key, value from public.site_setting order by key`)
check('there are exactly two settings rows', settings.length === 2, JSON.stringify(settings.map((s) => s.key)))
check('...registration is still PRIVATE', settings.find((s) => s.key === 'registrationMode')?.value === 'PRIVATE')
check('...and still has a code set', (settings.find((s) => s.key === 'registrationCode')?.value ?? '') !== '')

section('No development data has reached production')

/*
 * The whole point of the fixture environment. Every fixture handle is DEV_-prefixed and every
 * fixture address is on example.test, so their absence here is a positive statement that the two
 * worlds have stayed apart.
 */
check('no DEV_ fixture players',
  await num(`select count(*) from public."Player" where "cueverseId" like 'DEV\\_%'`) === 0)
check('no example.test accounts',
  await num(`select count(*) from payload.users where email like '%@example.test'`) === 0)
check('no zzverify fixture tournaments',
  await num(`select count(*) from public.comp_tournament where name ilike 'zzverify%'`) === 0)
check('no fixture tournaments left in the snapshot cache',
  await num(`select count(*) from public.comp_tournament_snapshot s, jsonb_array_elements(s.payload::jsonb) e
             where (e->>'name') ilike 'zzverify%'`) === 0)

const failed = ctx.failures()
console.log(`\n${failed === 0 ? 'RESULT: the record is intact' : `RESULT: ${failed} check(s) failed`}`)
await db.$disconnect()
process.exit(failed === 0 ? 0 : 1)
