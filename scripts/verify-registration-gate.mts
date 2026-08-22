/**
 * The site-wide policy is the ONLY thing that opens public registration.
 *
 * ── What this is guarding against ────────────────────────────────────────────────────────────────
 * A Season used to carry its own `accessMode` and join password, so "may this member enter?" had two
 * answers that could disagree. A member could satisfy the global policy and still be refused for a
 * secret nobody had given them, and the refusal could not say which gate had said no. One gate now
 * decides, and this proves it decides everywhere — including for a legacy PASSWORD Season, which is
 * the case where the two answers used to diverge.
 *
 * ── And the legacy data is still there ───────────────────────────────────────────────────────────
 * "Not consulted" must not quietly become "deleted". A record created under the old rules keeps its
 * accessMode and its stored hash, and is still readable through the ordinary view. Preserving real
 * data was an explicit constraint, so it is asserted rather than assumed.
 *
 * Fixtures only, all removed afterwards.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-registration-gate.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import {
  getCompetitionRegistrationMode, setCompetitionRegistrationMode, publicRegistrationOpen,
  parseCompetitionRegistrationMode, COMPETITION_REGISTRATION_KEY,
} from '../src/lib/competition/registration-policy.ts'
import { registerSelf, getSeasonView } from '../src/lib/seasons/service.ts'
import { createDraft, structuresForCreation } from '../src/lib/creator/setup.ts'
import { hashJoinPassword } from '../src/lib/competition/join-password.ts'

assertLocalDatabase()

const ACTOR = { userId: 2, username: 'verify-registration-gate' }
const YEAR = 2096
let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const series = await prisma.competitionSeries.findFirstOrThrow({ select: { id: true } })

/*
 * Put the setting back EXACTLY as it was, including not existing.
 *
 * `getCompetitionRegistrationMode()` answers ADMIN_ONLY for an absent row, so restoring "what it
 * returned" would write a row where there was none — leaving verification residue in real site
 * settings that happens to behave the same way. Absence is a state; record it as one.
 */
const originalRow = await prisma.$queryRawUnsafe<{ value: string }[]>(
  `SELECT value FROM public.site_setting WHERE key = $1 LIMIT 1`, COMPETITION_REGISTRATION_KEY)
const originalMode = originalRow.length ? parseCompetitionRegistrationMode(originalRow[0].value) : null

async function cleanup() {
  const rows = await prisma.season.findMany({ where: { competitionYear: YEAR }, select: { id: true } })
  for (const r of rows) {
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: r.id } })
    await prisma.season.delete({ where: { id: r.id } }).catch(() => {})
  }
}
await cleanup()

/** A member who can actually be registered — a real linked account, not an invented id. */
const member = await prisma.player.findFirst({
  where: { linkedUserId: { not: null } },
  select: { id: true, primaryName: true, cueverseId: true, linkedUserId: true },
})

try {
  section('The policy value itself')
  check('MEMBERS_ALLOWED parses', parseCompetitionRegistrationMode('MEMBERS_ALLOWED') === 'MEMBERS_ALLOWED')
  check('anything unrecognised falls back to ADMIN_ONLY',
    parseCompetitionRegistrationMode('members_allowed') === 'ADMIN_ONLY'
    && parseCompetitionRegistrationMode('') === 'ADMIN_ONLY'
    && parseCompetitionRegistrationMode(null) === 'ADMIN_ONLY'
    && parseCompetitionRegistrationMode(undefined) === 'ADMIN_ONLY')
  await setCompetitionRegistrationMode('MEMBERS_ALLOWED')
  check('it round-trips through the setting store', (await getCompetitionRegistrationMode()) === 'MEMBERS_ALLOWED')
  await setCompetitionRegistrationMode('ADMIN_ONLY')
  check('...and back again', (await getCompetitionRegistrationMode()) === 'ADMIN_ONLY')
  const stored = await prisma.$queryRawUnsafe<{ value: string }[]>(
    `SELECT value FROM public.site_setting WHERE key = $1`, COMPETITION_REGISTRATION_KEY)
  check('exactly one row holds it — the setter upserts, it does not accumulate', stored.length === 1)

  section('A new Creator Season is OPEN and passwordless')
  const allowed = structuresForCreation('season').map((s) => s.id as string)
  check('only the two Groups → Playoffs structures are on offer',
    allowed.length === 2 && allowed.includes('groups_playoffs') && allowed.includes('groups_playoffs_de'),
    allowed.join(', '))
  check('the retired Groups-only structure is refused at creation', !allowed.includes('groups_only'))

  const made = await createDraft(ACTOR, {
    type: 'season', competitionYear: YEAR, competitionSeriesId: series.id, purpose: 'live',
    structure: 'groups_playoffs', number: 1, division: null, accessMode: 'OPEN',
  })
  check('the Season is created', made.ok && made.id != null, made.error)
  const fresh = await prisma.season.findUniqueOrThrow({
    where: { id: made.id! },
    select: { accessMode: true, joinPasswordHash: true, lifecycleState: true },
  })
  check('...as OPEN', fresh.accessMode === 'OPEN', fresh.accessMode)
  check('...with no join password stored', fresh.joinPasswordHash === null)
  check('...and taking entrants', fresh.lifecycleState === 'REGISTRATION_OPEN', fresh.lifecycleState)

  section('ADMIN_ONLY closes public registration on an OPEN Season')
  await setCompetitionRegistrationMode('ADMIN_ONLY')
  check('the page would offer no control',
    (await publicRegistrationOpen({ lifecycleState: 'REGISTRATION_OPEN' })) === false)
  if (member) {
    const r = await registerSelf(
      Number(member.linkedUserId), { playerId: member.id, name: member.primaryName, handle: member.cueverseId },
      made.id!, null)
    check('...and the ACTION refuses too, not merely the button', !r.ok, JSON.stringify(r))
    check('...saying an administrator adds entries', /administrator/i.test(r.error ?? ''), r.error)
    check('no entrant was written',
      (await prisma.seasonEntrant.count({ where: { seasonId: made.id! } })) === 0)
  } else {
    console.log('  · skipped: no account-linked Player in this database')
  }

  section('MEMBERS_ALLOWED opens it — with no Season password to satisfy')
  await setCompetitionRegistrationMode('MEMBERS_ALLOWED')
  check('the page would offer the control',
    (await publicRegistrationOpen({ lifecycleState: 'REGISTRATION_OPEN' })) === true)
  if (member) {
    // No password argument at all: under the new rule there is nothing for one to satisfy.
    const r = await registerSelf(
      Number(member.linkedUserId), { playerId: member.id, name: member.primaryName, handle: member.cueverseId },
      made.id!)
    check('the member registers without one', r.ok === true, JSON.stringify(r))
    check('...and is an entrant',
      (await prisma.seasonEntrant.count({ where: { seasonId: made.id!, status: { not: 'WITHDRAWN' } } })) === 1)
  }

  section('Lifecycle still closes registration, whatever the policy says')
  check('a completed Season is not joinable',
    (await publicRegistrationOpen({ lifecycleState: 'COMPLETED' })) === false)
  check('nor one in group setup',
    (await publicRegistrationOpen({ lifecycleState: 'GROUP_SETUP' })) === false)
  check('nor one whose registration is closed',
    (await publicRegistrationOpen({ lifecycleState: 'REGISTRATION_CLOSED' })) === false)

  section('A legacy PASSWORD Season keeps its data and answers to the same gate')
  /*
   * Built the way the old form built one — accessMode PASSWORD with a real stored hash — because the
   * point is a record that PREDATES the rule, not a synthetic stand-in.
   */
  const legacy = await createDraft(ACTOR, {
    type: 'season', competitionYear: YEAR, competitionSeriesId: series.id, purpose: 'live',
    structure: 'groups_playoffs', number: 2, division: null, accessMode: 'OPEN',
  })
  check('the legacy fixture exists', legacy.ok && legacy.id != null, legacy.error)
  await prisma.season.update({
    where: { id: legacy.id! },
    data: { accessMode: 'PASSWORD', joinPasswordHash: hashJoinPassword('legacy-secret') },
  })

  const legacyRow = await prisma.season.findUniqueOrThrow({
    where: { id: legacy.id! },
    select: { accessMode: true, joinPasswordHash: true },
  })
  check('its accessMode is preserved', legacyRow.accessMode === 'PASSWORD')
  check('its stored password hash is preserved', (legacyRow.joinPasswordHash ?? '').length > 0)

  const legacyView = await getSeasonView(legacy.id!)
  check('it is still readable through the ordinary Season view', legacyView != null)
  check('...and still reports that it carries a password',
    legacyView?.requiresJoinPassword === true, String(legacyView?.requiresJoinPassword))

  if (member) {
    await setCompetitionRegistrationMode('MEMBERS_ALLOWED')
    // The WRONG password — under the old rule this was a refusal. The policy is the gate now.
    const r = await registerSelf(
      Number(member.linkedUserId), { playerId: member.id, name: member.primaryName, handle: member.cueverseId },
      legacy.id!, 'not-the-password')
    check('the policy admits the member despite the legacy password', r.ok === true, JSON.stringify(r))

    await setCompetitionRegistrationMode('ADMIN_ONLY')
    const other = await prisma.player.findFirst({
      where: { linkedUserId: { not: null }, id: { not: member.id } },
      select: { id: true, primaryName: true, cueverseId: true, linkedUserId: true },
    })
    if (other) {
      // The RIGHT password — and still refused, because the policy is the gate.
      const r2 = await registerSelf(
        Number(other.linkedUserId), { playerId: other.id, name: other.primaryName, handle: other.cueverseId },
        legacy.id!, 'legacy-secret')
      check('...and refuses under ADMIN_ONLY even with the correct password', !r2.ok, JSON.stringify(r2))
    }
  }
} finally {
  await cleanup()
  check('every fixture Season is removed',
    (await prisma.season.count({ where: { competitionYear: YEAR } })) === 0)
  if (originalMode == null) {
    await prisma.$executeRawUnsafe(`DELETE FROM public.site_setting WHERE key = $1`, COMPETITION_REGISTRATION_KEY)
  } else {
    await setCompetitionRegistrationMode(originalMode)
  }
  const restored = await prisma.$queryRawUnsafe<{ value: string }[]>(
    `SELECT value FROM public.site_setting WHERE key = $1`, COMPETITION_REGISTRATION_KEY)
  check('the site policy is restored to exactly what it was',
    originalMode == null ? restored.length === 0 : restored[0]?.value === originalMode,
    `expected ${originalMode ?? 'no row'}, found ${restored[0]?.value ?? 'no row'}`)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
