/**
 * Creator setup: creating a Season or a Cup from the setup form.
 *
 * This exercises `createDraft` — the service the `/creator/new` action calls — rather than the form,
 * because the form is the part a person can see is wrong and the service is the part they cannot.
 * The properties under test are the ones a broken setup would violate silently:
 *
 *   • A Historical Reconstruction is created PRIVATE and flagged as a reconstruction, so it cannot
 *     appear anywhere public while it is being typed in.
 *   • A Live Competition is created public and visible.
 *   • The structure choice actually reaches the record (double elimination in particular, which is
 *     invisible until the bracket is built and expensive to discover then).
 *   • Every created record is EMPTY. Setup invents no entrants, no groups and no results.
 *   • The competition year is the year the operator typed, never today.
 *   • A duplicate submission with the same idempotency key returns the FIRST record, not a second.
 *   • Nothing created here counts towards the Rankings — a draft has no ledger rows.
 *   • The structures offered are only the ones the engine can actually run.
 *
 * Everything runs against throwaway records in a dedicated fixture Competition, and the suite
 * refuses to operate on anything outside it. The real reconstructed Seasons are never touched.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-creator-setup.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createDraft, structuresFor, STRUCTURES, draftHref } from '../src/lib/creator/setup.ts'
import { seasonIsLive, seasonIsArchived, tournamentIsLive } from '../src/lib/competition/lifecycle-rules.ts'

assertLocalDatabase('verify-creator-setup')

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

const FIXTURE_SLUG = 'zzsetup-competition'
const actor = { userId: 990501, username: 'creator-setup-verify' }
const HISTORIC_YEAR = 1987

const cleanupErrors: string[] = []

async function cleanup() {
  // Every Season in the fixture Competition, not only the ids this run tracked — a run that crashed
  // half way must not leave a "test data" Season behind for somebody to find in an archive later.
  const strays = await prisma.season.findMany({
    where: { competitionSeries: { slug: FIXTURE_SLUG } }, select: { id: true },
  }).catch(() => [] as { id: number }[])
  for (const { id } of strays) {
    await prisma.season.delete({ where: { id } })
      .catch((e) => cleanupErrors.push(`season ${id}: ${e instanceof Error ? e.message.slice(-160) : String(e)}`))
  }
  // Cups have no fixture Competition to scope by, so they are scoped by the name this suite writes.
  const cups = await prisma.tournament.findMany({
    where: { name: { startsWith: 'ZZSETUP ' } }, select: { id: true },
  }).catch(() => [] as { id: number }[])
  for (const { id } of cups) {
    await prisma.tournament.delete({ where: { id } })
      .catch((e) => cleanupErrors.push(`cup ${id}: ${e instanceof Error ? e.message.slice(-160) : String(e)}`))
  }
  await prisma.auditLog.deleteMany({ where: { actorUsername: actor.username } }).catch(() => {})
  await prisma.competitionSeries.deleteMany({ where: { slug: FIXTURE_SLUG, seasons: { none: {} } } }).catch(() => {})
}

async function main() {
  await cleanup()

  const comp = await prisma.competitionSeries.upsert({
    where: { slug: FIXTURE_SLUG },
    update: {},
    create: { slug: FIXTURE_SLUG, name: 'ZZ Setup Fixture', shortName: 'ZZS', active: true },
    select: { id: true },
  })

  // ── The structures offered
  section('Structures offered match what the engine can run')
  const seasonStructures = structuresFor('season').map((s) => s.id)
  const cupStructures = structuresFor('cup').map((s) => s.id)
  check('Seasons offer a group stage', seasonStructures.includes('groups_playoffs'))
  check('Seasons offer a double-elimination playoff', seasonStructures.includes('groups_playoffs_de'))
  check('Seasons are not offered Swiss', !seasonStructures.includes('swiss'))
  check('Cups offer single elimination', cupStructures.includes('single_elim'))
  check('Cups offer double elimination', cupStructures.includes('double_elim'))
  check('Cups offer Swiss', cupStructures.includes('swiss'))
  check('Cups are not offered a group stage', !cupStructures.some((id) => id.startsWith('groups')))
  check('Every structure belongs to at least one type', STRUCTURES.every((s) => s.seasons || s.cups))
  check('The two lists do not overlap', !seasonStructures.some((id) => cupStructures.includes(id)))

  // ── A Historical Reconstruction Season
  section('Historical Reconstruction Season')
  const recon = await createDraft(actor, {
    type: 'season',
    competitionYear: HISTORIC_YEAR,
    competitionSeriesId: comp.id,
    purpose: 'reconstruction',
    structure: 'groups_playoffs',
    title: 'ZZSETUP Reconstruction',
    division: 'A',
    description: 'Fixture.',
  })
  check('created', recon.ok && recon.id != null, recon.error ?? '')
  if (!recon.ok || recon.id == null) throw new Error('cannot continue without a Season')

  const s = await prisma.season.findUniqueOrThrow({
    where: { id: recon.id },
    select: {
      competitionYear: true, division: true, subtitle: true, reconstruction: true,
      publiclyVisible: true, playoffDoubleElim: true, lifecycleState: true, ladderAppliedAt: true,
      entrantsCount: true, competitionSeriesId: true,
      _count: { select: { entrants: true, groups: true, matches: true, playoffMatches: true, ratingLedger: true } },
    },
  })
  check('year is the year typed, not today', s.competitionYear === HISTORIC_YEAR, String(s.competitionYear))
  check('flagged as a reconstruction', s.reconstruction === true)
  check('NOT publicly visible', s.publiclyVisible === false)
  check('division recorded', s.division === 'A', String(s.division))
  check('custom title recorded', s.subtitle === 'ZZSETUP Reconstruction', String(s.subtitle))
  check('belongs to the chosen Competition', s.competitionSeriesId === comp.id)
  check('single-elimination playoffs, as chosen', s.playoffDoubleElim === false)
  check('no entrants invented', s._count.entrants === 0 && s.entrantsCount === 0)
  check('no groups invented', s._count.groups === 0)
  check('no matches invented', s._count.matches === 0)
  check('no playoff matches invented', s._count.playoffMatches === 0)
  check('contributes nothing to the Rankings', s._count.ratingLedger === 0)
  check('not finalised', s.ladderAppliedAt === null)

  section('A reconstruction is invisible on every public surface')
  const seasonRow = await prisma.season.findUniqueOrThrow({
    where: { id: recon.id },
    select: { lifecycleState: true, ladderAppliedAt: true, reopenedAt: true, publiclyVisible: true, reconstruction: true },
  })
  check('not Live', !seasonIsLive(seasonRow, seasonRow.publiclyVisible))
  check('not Archived', !seasonIsArchived(seasonRow))

  // ── Double elimination reaches the record
  section('Double-elimination Season')
  const de = await createDraft(actor, {
    type: 'season',
    competitionYear: HISTORIC_YEAR,
    competitionSeriesId: comp.id,
    purpose: 'reconstruction',
    structure: 'groups_playoffs_de',
    title: 'ZZSETUP Double Elim',
  })
  check('created', de.ok && de.id != null, de.error ?? '')
  if (de.id != null) {
    const row = await prisma.season.findUniqueOrThrow({
      where: { id: de.id }, select: { playoffDoubleElim: true, number: true },
    })
    check('double elimination recorded', row.playoffDoubleElim === true)
    check('took its own Season number', row.number != null)
  }

  // ── A Live Season
  section('Live Season')
  const live = await createDraft(actor, {
    type: 'season',
    competitionYear: HISTORIC_YEAR,
    competitionSeriesId: comp.id,
    purpose: 'live',
    structure: 'groups_playoffs',
    title: 'ZZSETUP Live',
    accessMode: 'OPEN',
  })
  check('created', live.ok && live.id != null, live.error ?? '')
  if (live.id != null) {
    const row = await prisma.season.findUniqueOrThrow({
      where: { id: live.id }, select: { reconstruction: true, publiclyVisible: true, _count: { select: { entrants: true } } },
    })
    check('not flagged as a reconstruction', row.reconstruction === false)
    check('publicly visible', row.publiclyVisible === true)
    check('still created empty', row._count.entrants === 0)
  }

  // ── Idempotency
  section('A duplicate submission does not create a second record')
  const key = 'zzsetup-idempotency-key'
  const first = await createDraft(actor, {
    type: 'season', competitionYear: HISTORIC_YEAR, competitionSeriesId: comp.id,
    purpose: 'reconstruction', structure: 'groups_playoffs', title: 'ZZSETUP Once', idempotencyKey: key,
  })
  const second = await createDraft(actor, {
    type: 'season', competitionYear: HISTORIC_YEAR, competitionSeriesId: comp.id,
    purpose: 'reconstruction', structure: 'groups_playoffs', title: 'ZZSETUP Once', idempotencyKey: key,
  })
  check('first submission created a record', first.ok && first.id != null)
  check('second submission returned the SAME record', second.id === first.id, `${first.id} vs ${second.id}`)
  check('second submission is reported as a duplicate', second.deduplicated === true)
  const named = await prisma.season.count({ where: { subtitle: 'ZZSETUP Once' } })
  check('exactly one record exists', named === 1, String(named))

  // ── Rejections
  section('Setup refuses what it cannot honour')
  const badStructure = await createDraft(actor, {
    type: 'season', competitionYear: HISTORIC_YEAR, competitionSeriesId: comp.id,
    purpose: 'reconstruction', structure: 'swiss' as never,
  })
  check('a Season cannot be Swiss', !badStructure.ok)
  const badComp = await createDraft(actor, {
    type: 'season', competitionYear: HISTORIC_YEAR, competitionSeriesId: 99_999_999,
    purpose: 'reconstruction', structure: 'groups_playoffs',
  })
  check('an unknown Competition is refused', !badComp.ok)
  const badYear = await createDraft(actor, {
    type: 'season', competitionYear: Number.NaN, competitionSeriesId: comp.id,
    purpose: 'reconstruction', structure: 'groups_playoffs',
  })
  check('a missing year is refused', !badYear.ok)
  const untitledCup = await createDraft(actor, {
    type: 'cup', competitionYear: HISTORIC_YEAR, competitionSeriesId: comp.id,
    purpose: 'reconstruction', structure: 'single_elim',
  })
  check('a Cup without a title is refused', !untitledCup.ok)

  // ── Cups
  section('Historical Reconstruction Cup')
  const cup = await createDraft(actor, {
    type: 'cup',
    competitionYear: HISTORIC_YEAR,
    competitionSeriesId: comp.id,
    purpose: 'reconstruction',
    structure: 'double_elim',
    title: 'ZZSETUP Cup',
    description: 'Fixture.',
  })
  check('created', cup.ok && cup.id != null, cup.error ?? '')
  if (cup.id != null) {
    const t = await prisma.tournament.findUniqueOrThrow({
      where: { id: cup.id },
      select: {
        name: true, competitionYear: true, reconstruction: true, publiclyVisible: true,
        tournamentFormat: true, playoffDoubleElim: true, description: true, lifecycleState: true,
        _count: { select: { registrations: true, matches: true } },
      },
    })
    check('year is the year typed', t.competitionYear === HISTORIC_YEAR, String(t.competitionYear))
    check('flagged as a reconstruction', t.reconstruction === true)
    check('NOT publicly visible', t.publiclyVisible === false)
    check('double elimination recorded', t.tournamentFormat === 'DOUBLE_ELIM', String(t.tournamentFormat))
    check('description recorded', t.description === 'Fixture.')
    check('no entrants invented', t._count.registrations === 0)
    check('no matches invented', t._count.matches === 0)
    check('not Live', !tournamentIsLive({ lifecycleState: t.lifecycleState, reconstruction: t.reconstruction }, t.publiclyVisible))
  }

  section('Swiss Cup')
  const swiss = await createDraft(actor, {
    type: 'cup', competitionYear: HISTORIC_YEAR, competitionSeriesId: comp.id,
    purpose: 'reconstruction', structure: 'swiss', title: 'ZZSETUP Swiss',
  })
  check('created', swiss.ok && swiss.id != null, swiss.error ?? '')
  if (swiss.id != null) {
    const t = await prisma.tournament.findUniqueOrThrow({ where: { id: swiss.id }, select: { tournamentFormat: true } })
    check('Swiss recorded', t.tournamentFormat === 'SWISS', String(t.tournamentFormat))
  }

  // ── Continuation
  section('Where setup continues')
  check('a Season continues in Creator', draftHref('season', 7) === '/creator/seasons/7')
  /*
   * The Tournament branch is unreachable from Creator now — creating one starts at
   * /tournaments/new — but the helper still has to name a route that EXISTS. /creator/tournaments/<id>
   * translates the internal id to the public number and lands in the Tournaments section;
   * /creator/cups/<id> was the old path and is only kept alive as a redirect.
   */
  check('a Tournament continues in the Tournaments section',
    draftHref('cup', 7) === '/creator/tournaments/7')

  // ── Nothing created here touched the Rankings
  section('Setup writes nothing to the Rankings')
  const fixtureIds = (await prisma.season.findMany({
    where: { competitionSeries: { slug: FIXTURE_SLUG } }, select: { id: true },
  })).map((r) => r.id)
  const ledgerRows = fixtureIds.length
    ? await prisma.ratingLedger.count({ where: { seasonId: { in: fixtureIds } } })
    : 0
  check('no ledger rows for any fixture Season', ledgerRows === 0, String(ledgerRows))
}

let exitCode = 0
try {
  await main()
} catch (e) {
  fail++
  console.log('\nFATAL ' + (e instanceof Error ? e.message : String(e)))
} finally {
  await cleanup()
  if (cleanupErrors.length) {
    fail++
    console.log('\nCLEANUP LEFT RECORDS BEHIND:')
    for (const e of cleanupErrors) console.log('  ' + e)
  }
  // Prove the fixture is gone. A verify suite that leaves data behind has changed the database it
  // was asked not to change.
  const leftSeasons = await prisma.season.count({ where: { competitionSeries: { slug: FIXTURE_SLUG } } }).catch(() => -1)
  const leftCups = await prisma.tournament.count({ where: { name: { startsWith: 'ZZSETUP ' } } }).catch(() => -1)
  check('fixture Seasons cleaned up', leftSeasons === 0, String(leftSeasons))
  check('fixture Cups cleaned up', leftCups === 0, String(leftCups))

  console.log(`\n${pass} passed, ${fail} failed`)
  exitCode = fail === 0 ? 0 : 1
  await prisma.$disconnect()
}
process.exit(exitCode)
