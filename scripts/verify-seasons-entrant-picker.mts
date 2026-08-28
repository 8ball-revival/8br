/**
 * Two Seasons bugs, and the rules that replace them.
 *
 * ── 1. The entrant picker offered people who were already entered ───────────────────────────────
 * The server had always excluded them. The CLIENT fetched the list once and never again: reopening
 * the dropdown was guarded by "only reload if the list is empty", so a populated stale list survived
 * being closed and reopened, and adding somebody did not remove them from it. Clicking the Player
 * you had just added produced "already entered" — a correct error from a stale menu, which reads as
 * a broken save.
 *
 * ── 2. /seasons opened an empty page while a Season sat in the database ─────────────────────────
 * It defaulted the Competition to 8BRCAM whenever the URL named none, so a Season created under any
 * other Competition was invisible; and it ordered by competition year then Season number, so a
 * Season created today for an earlier year sorted below records from years ago.
 *
 * These checks run against fixtures and create and destroy their own Season, so they can be run
 * repeatedly and prove the rules rather than the dataset.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-seasons-entrant-picker.mts
 */
import { readFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { searchSeasonCandidates } from '../src/lib/seasons/service.ts'
import { mostRecentlyCreatedSeason } from '../src/lib/seasons/browse.ts'

assertLocalDatabase('verify-seasons-entrant-picker')

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}
const section = (title: string) => console.log(`\n--- ${title} ---`)

const TAG = 'zzverify-picker'
const ids: number[] = []

async function cleanup() {
  await prisma.season.deleteMany({ where: { slug: { startsWith: TAG } } })
  await prisma.competitionSeries.deleteMany({ where: { slug: { startsWith: TAG } } })
}
await cleanup()

try {
  const series = await prisma.competitionSeries.create({
    data: { name: 'ZZ Verify Picker Series', slug: `${TAG}-series`, shortName: 'ZZV' },
  })

  /** A Season of our own, so nothing here depends on which fixtures happen to exist. */
  const makeSeason = async (o: {
    slug: string; number: number; year: number; platform?: 'CUEVERSE' | 'YAHOO'
    publiclyVisible?: boolean; division?: string | null
  }) => {
    const s = await prisma.season.create({
      data: {
        number: o.number,
        competitionYear: o.year,
        competitionSeriesId: series.id,
        slug: o.slug,
        platform: (o.platform ?? 'CUEVERSE') as never,
        publiclyVisible: o.publiclyVisible ?? true,
        division: o.division ?? 'A',
        lifecycleState: 'REGISTRATION_OPEN' as never,
      },
    })
    ids.push(s.id)
    return s
  }

  // ── 1. The entrant picker ─────────────────────────────────────────────────────────────────────
  section('Existing entrants are never offered as choices')

  const season = await makeSeason({ slug: `${TAG}-a`, number: 901, year: 2026 })
  const players = await prisma.player.findMany({
    where: { active: true, managementOnly: false },
    take: 3,
    orderBy: { id: 'asc' },
    select: { id: true, primaryName: true, cueverseId: true },
  })
  check('there are Players to pick from', players.length === 3, String(players.length))

  const before = await searchSeasonCandidates(season.id, '')
  check('an empty Season offers every Player',
    players.every((p) => before.some((c) => c.playerId === p.id)))

  const [first, second, third] = players
  await prisma.seasonEntrant.create({
    data: { seasonId: season.id, playerId: first.id, username: first.cueverseId ?? first.primaryName, status: 'APPROVED' as never },
  })

  const afterAdd = await searchSeasonCandidates(season.id, '')
  check('an entered Player is gone from the candidates', !afterAdd.some((c) => c.playerId === first.id))
  check('...and everybody else is still offered',
    afterAdd.some((c) => c.playerId === second.id) && afterAdd.some((c) => c.playerId === third.id))

  /*
   * Searching is where a client-side filter would fail: the list comes back from the server for the
   * new query, so the exclusion has to live there rather than in whatever the dropdown was holding.
   */
  const searched = await searchSeasonCandidates(season.id, (first.cueverseId ?? first.primaryName).slice(0, 4))
  check('searching for them by handle does not surface them', !searched.some((c) => c.playerId === first.id))
  const searchedByName = await searchSeasonCandidates(season.id, first.primaryName.slice(0, 4))
  check('...nor by preferred name', !searchedByName.some((c) => c.playerId === first.id))

  section('Removing an entrant makes them available again')

  const entrant = await prisma.seasonEntrant.findFirstOrThrow({ where: { seasonId: season.id, playerId: first.id } })
  await prisma.seasonEntrant.delete({ where: { id: entrant.id } })
  const afterRemove = await searchSeasonCandidates(season.id, '')
  check('the removed Player is offered once more', afterRemove.some((c) => c.playerId === first.id))

  /*
   * A withdrawal is not a removal — the row stays, with a status. It must still free the Player,
   * because an administrator who withdrew somebody by mistake has to be able to put them back.
   */
  await prisma.seasonEntrant.create({
    data: { seasonId: season.id, playerId: second.id, username: second.cueverseId ?? second.primaryName, status: 'WITHDRAWN' as never },
  })
  const afterWithdraw = await searchSeasonCandidates(season.id, '')
  check('a WITHDRAWN entrant is offered again', afterWithdraw.some((c) => c.playerId === second.id))

  section('Identity is the canonical Player id, never a name')

  /*
   * Two Players can share a preferred name, and a handle can be edited. If exclusion were keyed on
   * either, adding one person would remove somebody else from the list — or fail to remove them.
   */
  const board = readFileSync('src/components/creator/season-entrants-board.tsx', 'utf8')
  const registration = readFileSync('src/components/seasons/season-registration.tsx', 'utf8')
  const hook = readFileSync('src/components/seasons/use-entrant-candidates.ts', 'utf8')

  check('the picker excludes by playerId', /exclude\(c\.playerId\)/.test(board) && /exclude\(c\.playerId\)/.test(registration))
  check('...and the hook filters on playerId', /c\.playerId !== playerId/.test(hook))
  check('...never on a name or handle',
    !/exclude\((c\.)?(primaryName|cueverseId)/.test(board + registration + hook))

  section('The dropdown cannot serve a stale list')

  /*
   * The exact defect: `if (candidates.length === 0) load('')`. A populated list was left alone, so
   * closing and reopening showed whatever had been fetched before the roster changed.
   */
  check('neither picker reloads only-when-empty',
    !/candidates\.length === 0\) load/.test(board) && !/candidates\.length === 0\) load/.test(registration))
  check('both refetch whenever the dropdown opens',
    /openList = \(\) => \{ setOpen\(true\); reload\(\) \}/.test(board)
    && /openList = \(\) => \{ setOpen\(true\); reload\(\) \}/.test(registration))
  check('a roster change refetches the candidates',
    /rosterVersion/.test(board) && /rosterVersion/.test(registration) && /rosterVersion/.test(hook))

  section('The server keeps the final say')

  check('adding still goes through the server action, not a client-side filter',
    /addSeasonEntrantAction\(seasonId, c\.playerId\)/.test(board))
  const service = readFileSync('src/lib/seasons/service.ts', 'utf8')
  check('the duplicate refusal is still there', /is already entered/.test(service))
  check('...and the server still excludes entrants from candidates',
    /entered\.has\(r\.id\)/.test(service))

  // ── 2. Where /seasons opens ───────────────────────────────────────────────────────────────────
  section('Seasons opens the most recently CREATED Season')

  const older = await makeSeason({ slug: `${TAG}-old`, number: 950, year: 2030 })
  const newer = await makeSeason({ slug: `${TAG}-new`, number: 1, year: 2001 })
  /*
   * Deliberately inverted: the newer row has the LOWER year and number. Under the old ordering —
   * year then number — the 2030 Season would win, which is exactly how a Season created today ended
   * up buried.
   */
  await prisma.season.update({ where: { id: older.id }, data: { createdAt: new Date('2020-01-01T00:00:00Z') } })
  await prisma.season.update({ where: { id: newer.id }, data: { createdAt: new Date('2099-01-01T00:00:00Z') } })

  const newestAll = await mostRecentlyCreatedSeason({ includePrivate: true })
  check('the most recently created Season wins, not the highest year',
    newestAll?.id === newer.id, `${newestAll?.id} vs ${newer.id}`)

  const scoped = await mostRecentlyCreatedSeason({ competitionSlug: series.slug, includePrivate: true })
  check('an explicit Competition is respected', scoped?.id === newer.id)
  check('...and it reports the Competition it landed in', scoped?.competitionSlug === series.slug)

  /* Ties are broken by id descending, so two Seasons created together cannot alternate per request. */
  const tieA = await makeSeason({ slug: `${TAG}-tie-a`, number: 960, year: 2026 })
  const tieB = await makeSeason({ slug: `${TAG}-tie-b`, number: 961, year: 2026 })
  const sameMoment = new Date('2099-06-01T00:00:00Z')
  await prisma.season.update({ where: { id: tieA.id }, data: { createdAt: sameMoment } })
  await prisma.season.update({ where: { id: tieB.id }, data: { createdAt: sameMoment } })
  const tie = await mostRecentlyCreatedSeason({ competitionSlug: series.slug, includePrivate: true })
  check('a tie on createdAt is broken by the higher id',
    tie?.id === Math.max(tieA.id, tieB.id), `${tie?.id}`)

  section('Visibility decides where a visitor is sent')

  await prisma.season.update({ where: { id: tieA.id }, data: { publiclyVisible: false } })
  await prisma.season.update({ where: { id: tieB.id }, data: { publiclyVisible: false } })

  const anonymous = await mostRecentlyCreatedSeason({ competitionSlug: series.slug, includePrivate: false })
  check('an anonymous visitor is never sent to a private Season',
    anonymous != null && anonymous.id !== tieA.id && anonymous.id !== tieB.id, String(anonymous?.id))
  check('...and gets the newest one they may see', anonymous?.id === newer.id, String(anonymous?.id))

  const staff = await mostRecentlyCreatedSeason({ competitionSlug: series.slug, includePrivate: true })
  check('staff are sent to the newest Season including private ones',
    staff?.id === Math.max(tieA.id, tieB.id), String(staff?.id))

  section('Filters and the empty case')

  const yahooOnly = await makeSeason({ slug: `${TAG}-yahoo`, number: 970, year: 2026, platform: 'YAHOO', division: 'B' })
  await prisma.season.update({ where: { id: yahooOnly.id }, data: { createdAt: new Date('2100-01-01T00:00:00Z') } })

  const cueverse = await mostRecentlyCreatedSeason({ competitionSlug: series.slug, platform: 'CUEVERSE', includePrivate: true })
  check('an explicit platform is respected', cueverse?.platform === 'CUEVERSE', String(cueverse?.platform))
  const yahoo = await mostRecentlyCreatedSeason({ competitionSlug: series.slug, platform: 'YAHOO', includePrivate: true })
  check('...both ways', yahoo?.id === yahooOnly.id, String(yahoo?.id))
  const divisionB = await mostRecentlyCreatedSeason({ competitionSlug: series.slug, division: 'B', includePrivate: true })
  check('an explicit division is respected', divisionB?.id === yahooOnly.id, String(divisionB?.id))

  check('a filter matching nothing returns null, rather than falling back',
    (await mostRecentlyCreatedSeason({ competitionSlug: `${TAG}-does-not-exist` })) === null)
  check('...which is what keeps the empty state',
    (await mostRecentlyCreatedSeason({ competitionSlug: series.slug, division: 'Z' })) === null)

  section('The landing page asks the right questions')

  const page = readFileSync('src/app/(frontend)/seasons/page.tsx', 'utf8')
  check('it no longer defaults the Competition', !/DEFAULT_COMPETITION_SLUG/.test(page))
  check('it resolves by most-recently-created', /mostRecentlyCreatedSeason/.test(page))
  check('it asks who the visitor is before choosing', /resolveStaffAccess/.test(page))
  check('...and only offers private Seasons to a manager', /can\('manage_competitions'\)/.test(page))
  check('it names no Season id', !/\/seasons\/9\b/.test(page))
  check('it carries the incoming query through', /Object\.entries\(sp\)/.test(page))

  const browse = readFileSync('src/lib/seasons/browse.ts', 'utf8')
  check('ordering is createdAt then id, both descending',
    /createdAt: 'desc'[\s\S]{0,80}id: 'desc'/.test(browse))
  /*
   * The Season PICKER must keep its own order — year then number is what a reader scanning a
   * Competition expects. Changing that to createdAt would fix this page and scramble the dropdown.
   */
  check('the Season picker keeps year-then-number ordering',
    /const NEWEST_FIRST = \[[\s\S]{0,120}competitionYear: 'desc'/.test(browse))
  check('Previous/Next still walk chronological order', /const OLDEST_FIRST/.test(browse))
} finally {
  await cleanup()
  const left = await prisma.season.count({ where: { slug: { startsWith: TAG } } })
  check('the fixtures this suite made are gone', left === 0, `${left} left`)
}

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} check(s) failed`}`)
await prisma.$disconnect()
process.exit(failures === 0 ? 0 : 1)
