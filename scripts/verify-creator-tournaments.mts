/**
 * Tournament management moves into Creator, and the public pages stop managing anything.
 *
 * ── The handoff, again ───────────────────────────────────────────────────────────────────────────
 * The public Tournament page WAS the management interface: rosters, groups, brackets, score entry
 * and Settings all rendered at /tournaments/<n> behind a capability flag on a component. That is the
 * same shape the Season side had, and it fails the same way — a public URL that edits a competition
 * if the right person opens it.
 *
 * Both halves are checked together: the Creator stage routes resolve for every format, and the
 * public page carries no management control, no score input and no hidden form.
 *
 * ── And the heading ──────────────────────────────────────────────────────────────────────────────
 * The listing announced "Tournament #2  T002  … · 2026" for a 2006 record: two internal identifiers
 * ahead of the name, and a year taken from `createdAt` rather than from the Competition Year. The
 * year in particular was wrong data, not just noise.
 *
 * Fixtures only, all removed afterwards. No real Tournament is touched.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-creator-tournaments.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createTournament } from '../src/lib/competition/tournament-create.ts'
import { getTournamentList } from '../src/lib/tournaments/list.ts'
import { currentStage, stagesFor, stageReachable } from '../src/lib/creator/workflow.ts'
import { tournamentTitleLine, tournamentStatusWords } from '../src/lib/creator/tournament-stage.ts'

assertLocalDatabase()

const ACTOR = { userId: 2, username: 'verify-creator-tournaments' }
const MARK = 'ZZVerify Tournament'
const YEAR = 2087
const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3000'
let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const series = await prisma.competitionSeries.findFirstOrThrow({ select: { id: true, name: true } })

async function cleanup() {
  const rows = await prisma.tournament.findMany({
    where: { name: { startsWith: MARK } }, select: { id: true },
  })
  for (const r of rows) {
    await prisma.swissMatch.deleteMany({ where: { tournamentId: r.id } }).catch(() => {})
    await prisma.playoffMatch.deleteMany({ where: { tournamentId: r.id } }).catch(() => {})
    await prisma.tournamentMatch.deleteMany({ where: { tournamentId: r.id } }).catch(() => {})
    await prisma.tournamentGroup.deleteMany({ where: { tournamentId: r.id } }).catch(() => {})
    await prisma.tournamentTeamMember.deleteMany({ where: { team: { tournamentId: r.id } } }).catch(() => {})
    await prisma.tournamentTeam.deleteMany({ where: { tournamentId: r.id } }).catch(() => {})
    await prisma.registration.deleteMany({ where: { tournamentId: r.id } }).catch(() => {})
    await prisma.tournament.delete({ where: { id: r.id } }).catch(() => {})
  }
}
await cleanup()

const getPublic = async (path: string) => {
  const res = await fetch(`${BASE}${path}`, { headers: { 'cache-control': 'no-cache' } })
  return { status: res.status, body: await res.text() }
}
let serverUp = true
try { serverUp = (await fetch(`${BASE}/tournaments`, { signal: AbortSignal.timeout(8000) })).ok } catch { serverUp = false }

const FORMATS = ['SINGLE_ELIM', 'DOUBLE_ELIM', 'GROUPS_PLAYOFFS', 'SWISS'] as const

try {
  section('Every format creates through the canonical service')
  const made: { format: string; id: number; number: number | null }[] = []
  for (const [i, format] of FORMATS.entries()) {
    const r = await createTournament(ACTOR, {
      name: `${MARK} ${format}`,
      competitionSeriesId: series.id,
      competitionYear: YEAR,
      participantFormat: 'INDIVIDUAL',
      tournamentFormat: format,
      raceLength: 5,
      accessMode: 'OPEN',
      swissRounds: format === 'SWISS' ? 4 : null,
      // Groups + Playoffs needs its group count at creation, like the Creator form supplies.
      groupCount: format === 'GROUPS_PLAYOFFS' ? 2 : null,
      qualifiersPerGroup: format === 'GROUPS_PLAYOFFS' ? 2 : null,
      playoffDoubleElim: format === 'GROUPS_PLAYOFFS' ? i % 2 === 0 : undefined,
    })
    check(`${format} is created`, r.ok === true && r.id != null, r.error)
    if (r.id != null) made.push({ format, id: r.id, number: r.number ?? null })
  }
  check('four Tournaments exist', made.length === 4, `${made.length}`)

  section('A team Tournament records its roster size')
  const team = await createTournament(ACTOR, {
    name: `${MARK} TEAMS`,
    competitionSeriesId: series.id, competitionYear: YEAR,
    participantFormat: 'TEAM', teamSize: 3, teamFormation: 'RANDOM',
    tournamentFormat: 'SINGLE_ELIM', raceLength: 5, accessMode: 'OPEN',
  })
  check('it is created', team.ok === true, team.error)
  const teamRow = await prisma.tournament.findUniqueOrThrow({ where: { id: team.id! } })
  check('...as a team Tournament', String(teamRow.participantFormat) === 'TEAM')
  check('...of three', teamRow.teamSize === 3, `${teamRow.teamSize}`)
  check('...drawn at random', String(teamRow.teamFormation) === 'RANDOM')
  check('...and OPEN with no join password',
    String(teamRow.accessMode) === 'OPEN' && teamRow.joinPasswordHash === null)

  section('The workflow matches the format')
  const stageIds = (f: string) => stagesFor('tournament', f).map((s) => s.id).join(' → ')
  check('single elimination skips groups and swiss',
    stageIds('SINGLE_ELIM') === 'setup → entrants → playoffs → complete', stageIds('SINGLE_ELIM'))
  check('double elimination is the same shape',
    stageIds('DOUBLE_ELIM') === 'setup → entrants → playoffs → complete', stageIds('DOUBLE_ELIM'))
  check('groups + playoffs has a groups stage',
    stageIds('GROUPS_PLAYOFFS') === 'setup → entrants → groups → playoffs → complete', stageIds('GROUPS_PLAYOFFS'))
  check('swiss has a swiss stage and no playoffs',
    stageIds('SWISS') === 'setup → entrants → swiss → complete', stageIds('SWISS'))

  check('a fresh Tournament starts at setup', currentStage('tournament', 'DRAFT') === 'setup')
  check('an open one is at entrants', currentStage('tournament', 'REGISTRATION_OPEN') === 'entrants')
  check('a swiss Tournament in progress is at swiss',
    currentStage('tournament', 'IN_PROGRESS', 'SWISS') === 'swiss')
  check('an elimination one in progress is at playoffs',
    currentStage('tournament', 'IN_PROGRESS', 'SINGLE_ELIM') === 'playoffs')
  check('swiss is unreachable on a single-elimination Tournament',
    !stageReachable('tournament', 'IN_PROGRESS', 'swiss', 'SINGLE_ELIM'))
  check('groups is unreachable on a swiss Tournament',
    !stageReachable('tournament', 'IN_PROGRESS', 'groups', 'SWISS'))

  section('The heading names the record, not the database')
  const line = tournamentTitleLine({
    number: 2, name: 'Prize Tournament',
    competitionSeries: { name: '8BRCAM' }, competitionYear: 2006,
  })
  check('it reads position, title, Competition, year',
    line === '2. Prize Tournament · 8BRCAM · 2006', line)
  check('...with no internal code', !/T0\d\d/.test(line))
  check('...and no "Tournament #"', !line.includes('Tournament #'))
  check('a lifecycle state reads in words', tournamentStatusWords('REGISTRATION_OPEN') === 'Registration Open')

  section('The listing carries the Competition Year, not the import year')
  const list = await getTournamentList()
  const mine = list.filter((t) => t.name.startsWith(MARK))
  check('the fixtures are listed', mine.length === 5, `${mine.length}`)
  check('every one reports the Competition Year',
    mine.every((t) => t.year === YEAR), JSON.stringify(mine.map((t) => t.year)))
  check('...and not the year the row was created',
    mine.every((t) => t.year !== new Date().getUTCFullYear()))
  check('every one names its Competition',
    mine.every((t) => t.competitionName === series.name), JSON.stringify(mine.map((t) => t.competitionName)))

  if (!serverUp) {
    console.log(`\n  ! ${BASE} is not responding — the served-output checks are skipped.`)
  } else {
    section('Creator has a route for every stage')
    for (const t of made) {
      for (const stage of stagesFor('tournament', t.format).map((s) => s.segment)) {
        const res = await fetch(`${BASE}/creator/tournaments/${t.id}/${stage}`, { redirect: 'manual' })
        check(`${t.format} /${stage} resolves`, res.status === 200 || res.status === 307 || res.status === 308,
          `status ${res.status}`)
      }
    }
    const teamsRoute = await fetch(`${BASE}/creator/tournaments/${team.id}/teams`, { redirect: 'manual' })
    check('a team Tournament has a teams route',
      teamsRoute.status === 200 || teamsRoute.status === 307 || teamsRoute.status === 308, `${teamsRoute.status}`)
    const newRoute = await fetch(`${BASE}/creator/tournaments/new`)
    check('the create form resolves', newRoute.status === 200, `${newRoute.status}`)

    section('The public Tournament page manages nothing')
    for (const t of made.filter((x) => x.number != null)) {
      const { status, body } = await getPublic(`/tournaments/${t.number}`)
      check(`/tournaments/${t.number} responds`, status === 200, `status ${status}`)
      for (const control of [
        'Save Group', 'Generate Bracket', 'Start Playoffs', 'Close Registration',
        'Add Entrant', 'Generate Teams', 'Publish', 'Close Tournament',
      ]) {
        check(`...no "${control}"`, !body.includes(control))
      }
      check('...and no form element', !/<form/i.test(body))
    }

    section('The listing no longer leads with an internal code')
    const listing = await getPublic('/tournaments')
    check('it responds', listing.status === 200, `${listing.status}`)
    check('no "Tournament #" heading', !listing.body.includes('Tournament #'))
  }
} finally {
  await cleanup()
  check('every fixture Tournament is removed',
    (await prisma.tournament.count({ where: { name: { startsWith: MARK } } })) === 0)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
