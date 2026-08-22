/**
 * Who may enter a competition, and the fact that it is a different question from who may sign up.
 *
 * Two settings that sound alike and must never be wired together: `registrationMode` decides whether
 * a stranger can create an account, `competitionRegistrationMode` decides whether an existing member
 * can enter a Season or Tournament. A site can reasonably want open signup with admin-run
 * competitions, or a closed membership that runs itself. Coupling them would mean opening one opens
 * the other, which is exactly the kind of change nobody notices until it is public.
 *
 * The default is the important half. An unset value, an unreadable table or a typo all answer
 * ADMIN_ONLY, because guessing wrong that way costs an administrator one click, and guessing wrong
 * the other way puts a Register button on every open competition on the site.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-competition-registration-policy.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import {
  COMPETITION_REGISTRATION_KEY, parseCompetitionRegistrationMode,
  getCompetitionRegistrationMode, setCompetitionRegistrationMode, publicRegistrationOpen,
} from '../src/lib/competition/registration-policy.ts'
import { getRegistrationMode } from '../src/lib/account/registration-settings.ts'

assertLocalDatabase()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

// Whatever the owner has set stays set: captured now, restored at the end.
const before = (await prisma.$queryRawUnsafe<{ value: string }[]>(
  `SELECT value FROM public.site_setting WHERE key = $1 LIMIT 1`, COMPETITION_REGISTRATION_KEY,
))[0]?.value ?? null
const accountModeBefore = await getRegistrationMode()

try {
  section('Anything unrecognised means Admin Only')
  check('unset', parseCompetitionRegistrationMode(null) === 'ADMIN_ONLY')
  check('empty', parseCompetitionRegistrationMode('') === 'ADMIN_ONLY')
  check('a typo', parseCompetitionRegistrationMode('members_allowed') === 'ADMIN_ONLY')
  check('nonsense', parseCompetitionRegistrationMode('yes please') === 'ADMIN_ONLY')
  check('only the exact value opens it', parseCompetitionRegistrationMode('MEMBERS_ALLOWED') === 'MEMBERS_ALLOWED')

  section('With no row at all, the answer is still Admin Only')
  await prisma.$executeRawUnsafe(`DELETE FROM public.site_setting WHERE key = $1`, COMPETITION_REGISTRATION_KEY)
  check('a missing setting is closed, not open', (await getCompetitionRegistrationMode()) === 'ADMIN_ONLY')
  check('and no record offers public registration',
    (await publicRegistrationOpen({ lifecycleState: 'REGISTRATION_OPEN' })) === false)

  section('Admin Only closes public registration everywhere')
  await setCompetitionRegistrationMode('ADMIN_ONLY')
  check('the setting round-trips', (await getCompetitionRegistrationMode()) === 'ADMIN_ONLY')
  check('a Season taking entrants shows no Register control',
    (await publicRegistrationOpen({ lifecycleState: 'REGISTRATION_OPEN' })) === false)
  check('nor does a Tournament with registration open',
    (await publicRegistrationOpen({ lifecycleState: 'REGISTRATION_OPEN', registrationStatus: 'OPEN' })) === false)

  section('Members Allowed opens it — but only where the record is actually open')
  await setCompetitionRegistrationMode('MEMBERS_ALLOWED')
  check('the setting round-trips', (await getCompetitionRegistrationMode()) === 'MEMBERS_ALLOWED')
  check('a Season taking entrants offers it',
    (await publicRegistrationOpen({ lifecycleState: 'REGISTRATION_OPEN' })) === true)
  check('a Season past registration does not',
    (await publicRegistrationOpen({ lifecycleState: 'GROUP_STAGE_LIVE' })) === false)
  check('a completed Season does not',
    (await publicRegistrationOpen({ lifecycleState: 'COMPLETED' })) === false)
  check('a Tournament with registration open offers it',
    (await publicRegistrationOpen({ lifecycleState: 'REGISTRATION_OPEN', registrationStatus: 'OPEN' })) === true)
  check('a Tournament with registration closed does not',
    (await publicRegistrationOpen({ lifecycleState: 'REGISTRATION_OPEN', registrationStatus: 'CLOSED' })) === false)

  section('Switching back closes the controls and touches nothing else')
  const entrantsBefore = await prisma.seasonEntrant.count()
  const registrationsBefore = await prisma.registration.count()
  await setCompetitionRegistrationMode('ADMIN_ONLY')
  check('public registration is closed again',
    (await publicRegistrationOpen({ lifecycleState: 'REGISTRATION_OPEN' })) === false)
  check('existing Season entrants are untouched', (await prisma.seasonEntrant.count()) === entrantsBefore)
  check('existing Tournament registrations are untouched', (await prisma.registration.count()) === registrationsBefore)

  section('It is independent of public account creation')
  const accountMode = await getRegistrationMode()
  check('the account setting did not move while this one was flipped twice',
    accountMode === accountModeBefore, `${accountModeBefore} → ${accountMode}`)
  await setCompetitionRegistrationMode('MEMBERS_ALLOWED')
  check('...nor when it was opened', (await getRegistrationMode()) === accountModeBefore)
  check('the two use different keys',
    COMPETITION_REGISTRATION_KEY !== 'registrationMode', COMPETITION_REGISTRATION_KEY)
} finally {
  // Put the owner's setting back exactly as it was found.
  if (before == null) {
    await prisma.$executeRawUnsafe(`DELETE FROM public.site_setting WHERE key = $1`, COMPETITION_REGISTRATION_KEY)
  } else {
    await setCompetitionRegistrationMode(parseCompetitionRegistrationMode(before))
  }
  const after = (await prisma.$queryRawUnsafe<{ value: string }[]>(
    `SELECT value FROM public.site_setting WHERE key = $1 LIMIT 1`, COMPETITION_REGISTRATION_KEY,
  ))[0]?.value ?? null
  check('the setting is restored to how it was found', after === before, `${before} → ${after}`)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
