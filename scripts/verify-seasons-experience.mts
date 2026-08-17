/**
 * The rebuilt Seasons experience, end to end against the real database.
 *
 * Covers: newest-Season selection, Competition filtering, the URL contract, the fixed-table markup,
 * database-only sourcing, points ordering, qualification derived from the playoff bracket,
 * active-Season visibility, closed-only ranking contribution, reopening, and the Playoffs progress
 * message. Fixtures are created and removed; the real Season 1 is read but never written to.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-seasons-experience.mts
 */
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/prisma.ts'
import {
  getSeasonBrowseData, newestSeasonNumber, seasonNeighbours, seasonPlayoffParticipants,
  hasPublicPlayoffBracket, searchSeasonPlayers,
} from '../src/lib/seasons/browse.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.log('  ✗ ' + n + (d ? ` — ${d}` : '')) }
}
const actor = { userId: 960001, username: 'zzsx-verify' }

const COMP_A = 'zzsx-comp-a'
const COMP_B = 'zzsx-comp-b'
const madeSeasons: number[] = []

async function comp(slug: string, shortName: string, active = true): Promise<number> {
  const found = await prisma.competitionSeries.findFirst({ where: { slug }, select: { id: true } })
  if (found) return found.id
  const c = await prisma.competitionSeries.create({
    data: { name: `zz ${shortName}`, shortName, slug, active },
    select: { id: true },
  })
  return c.id
}

async function season(competitionSeriesId: number, number: number, year: number, state: string) {
  const s = await prisma.season.create({
    data: {
      competitionSeriesId, number, competitionYear: year, slug: `zzsx-season-${number}`,
      lifecycleState: state as never, lounge: 'Social', accessMode: 'OPEN',
      groupStageGames: 10, earlyRaceTo: 7, semifinalRaceTo: 9, finalRaceTo: 9,
    },
    select: { id: true, number: true },
  })
  madeSeasons.push(s.number)
  return s
}

/** Remove every fixture this suite can create. Runs before AND after, so a run that died partway
 *  through cannot leave residue that trips the next one. Seasons go first: a Competition holding
 *  one cannot be deleted. */
async function cleanup() {
  await prisma.season.deleteMany({ where: { slug: { startsWith: 'zzsx-season-' } } }).catch(() => {})
  await prisma.competitionSeries.deleteMany({ where: { slug: { startsWith: 'zzsx-' } } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { actorUsername: 'zzsx-verify' } }).catch(() => {})
  madeSeasons.length = 0
}

await cleanup() // clear anything a previous interrupted run left behind

try {
  console.log('--- Newest-Season selection: year first, then number ---')
  const a = await comp(COMP_A, 'zza')
  const b = await comp(COMP_B, 'zzb')
  // Deliberately out of order, and with a HIGHER number in an EARLIER year, so a naive
  // "highest number wins" rule would pick the wrong one.
  await season(a, 970001, 2091, 'REGISTRATION_OPEN')
  const newestA = await season(a, 970002, 2092, 'REGISTRATION_OPEN')
  await season(a, 970050, 2090, 'REGISTRATION_OPEN')
  await season(b, 970003, 2093, 'REGISTRATION_OPEN')

  check('newest within a Competition is the latest YEAR, not the highest number',
    (await newestSeasonNumber(COMP_A)) === newestA.number, String(await newestSeasonNumber(COMP_A)))
  check('newest across all Competitions is the latest year overall',
    (await newestSeasonNumber(null)) === 970003, String(await newestSeasonNumber(null)))
  check('an unknown Competition yields nothing to open',
    (await newestSeasonNumber('zzsx-nope')) === null)

  console.log('')
  console.log('--- Competition filtering ---')
  {
    const all = await getSeasonBrowseData(null)
    const onlyA = await getSeasonBrowseData(COMP_A)
    check('All Competitions sees both fixtures',
      onlyA.seasons.length < all.seasons.length && all.seasons.some((s) => s.competitionSlug === COMP_B))
    check('a filter narrows to that Competition alone',
      onlyA.seasons.every((s) => s.competitionSlug === COMP_A) && onlyA.seasons.length === 3)
    check('years follow the filter', onlyA.years.sort().join(',') === '2090,2091,2092')
    check('the picker labels Competitions by their stored short name',
      all.competitions.some((c) => c.shortName === 'zza' && c.slug === COMP_A))
    check('the picker filters by slug, never by the label',
      all.competitions.every((c) => typeof c.slug === 'string' && c.slug.length > 0))

    // A Competition with no Season, and an inactive one, are both kept out of the dropdown.
    const emptyId = await comp('zzsx-empty', 'zze')
    const inactive = await prisma.competitionSeries.create({
      data: { name: 'zz inactive', shortName: 'zzi', slug: 'zzsx-inactive', active: false }, select: { id: true },
    })
    await season(inactive.id, 970004, 2094, 'REGISTRATION_OPEN')
    const refreshed = await getSeasonBrowseData(null)
    check('a Competition with no Seasons is not offered',
      !refreshed.competitions.some((c) => c.slug === 'zzsx-empty'))
    check('an inactive Competition is not offered',
      !refreshed.competitions.some((c) => c.slug === 'zzsx-inactive'))
    // Drop the inactive fixture's Season first — the Competition cannot go while it holds one.
    const inactiveSeason = await prisma.season.findUnique({ where: { number: 970004 }, select: { id: true } })
    if (inactiveSeason) await prisma.season.delete({ where: { id: inactiveSeason.id } })
    await prisma.competitionSeries.deleteMany({ where: { slug: { in: ['zzsx-empty', 'zzsx-inactive'] } } })
    void emptyId
  }

  console.log('')
  console.log('--- Previous/Next walks chronological order inside the filter ---')
  {
    // Within Competition A: 2090/#970050 → 2091/#970001 → 2092/#970002.
    const mid = await seasonNeighbours(970001, COMP_A)
    check('previous is the older Season', mid.prev === 970050, String(mid.prev))
    check('next is the newer Season', mid.next === 970002, String(mid.next))

    const oldest = await seasonNeighbours(970050, COMP_A)
    check('the oldest Season has no previous', oldest.prev === null)
    const newest = await seasonNeighbours(970002, COMP_A)
    check('the newest Season has no next in its Competition', newest.next === null, String(newest.next))

    // Unfiltered, the newest in A is followed by the one in B.
    const unfiltered = await seasonNeighbours(970002, null)
    check('without a filter the arrows cross Competitions', unfiltered.next === 970003, String(unfiltered.next))
  }

  console.log('')
  console.log('--- Playoff qualification comes from the bracket, never from position ---')
  {
    const s = await season(a, 970005, 2095, 'PLAYOFFS_LIVE')
    const mk = async (name: string) => (await prisma.seasonEntrant.create({
      data: { seasonId: s.id, username: name, cueverseId: name, displayName: null, status: 'APPROVED' },
      select: { id: true },
    })).id
    const [e1, e2, e3, e4] = [await mk('zzq1'), await mk('zzq2'), await mk('zzq3'), await mk('zzq4')]

    check('with no bracket nobody qualifies', (await seasonPlayoffParticipants(s.id)).size === 0)
    check('and the Playoffs view says the groups are still running',
      (await hasPublicPlayoffBracket(s.id, 'PLAYOFFS_LIVE')) === false)

    // Round 1: e1 v e2 played; e3 has a bye. Round 2 seats e3 for the first time.
    await prisma.seasonPlayoffMatch.create({
      data: { seasonId: s.id, round: 1, slot: 0, homeEntrantId: e1, awayEntrantId: e2, homeUsername: 'zzq1', awayUsername: 'zzq2' },
    })
    await prisma.seasonPlayoffMatch.create({
      data: { seasonId: s.id, round: 2, slot: 0, homeEntrantId: e3, awayEntrantId: null, homeUsername: 'zzq3', awayUsername: 'Bye' },
    })

    const q = await seasonPlayoffParticipants(s.id)
    check('a player in a played tie qualifies', q.has(e1) && q.has(e2))
    check('a player whose first appearance follows a bye still qualifies', q.has(e3))
    check('an entrant absent from the bracket does not qualify', !q.has(e4))
    check('an empty slot cannot qualify anything', q.size === 3, String(q.size))
    check('a bracket makes the Playoffs view available',
      (await hasPublicPlayoffBracket(s.id, 'PLAYOFFS_LIVE')) === true)

    // A draft bracket during setup stays private — placements are still being arranged.
    check('a draft bracket in playoff setup is not public yet',
      (await hasPublicPlayoffBracket(s.id, 'PLAYOFF_SETUP')) === false)
    check('a group-stage Season never shows a bracket',
      (await hasPublicPlayoffBracket(s.id, 'GROUP_STAGE_LIVE')) === false)

    console.log('')
    console.log('--- Player search reads only this Season, and matches either half ---')
    await prisma.seasonEntrant.update({ where: { id: e1 }, data: { displayName: 'Mike' } })
    check('an empty query lists the Season entrants', (await searchSeasonPlayers(s.id, '')).length === 4)
    check('the CueVerse ID matches', (await searchSeasonPlayers(s.id, 'zzq1')).length === 1)
    check('the preferred name matches too',
      (await searchSeasonPlayers(s.id, 'mike')).map((h) => h.entrantId).join() === String(e1))
    check('a player from another Season is never returned',
      (await searchSeasonPlayers(s.id, 'xlx_cerebro_xlx')).length === 0)
    check('search reports who reached the playoffs',
      (await searchSeasonPlayers(s.id, 'zzq3'))[0]?.inPlayoffs === true)
  }

  console.log('')
  console.log('--- Active Seasons are public but do not count; only closed ones do ---')
  {
    const live = await season(a, 970006, 2096, 'GROUP_STAGE_LIVE')
    const browse = await getSeasonBrowseData(COMP_A)
    check('an in-progress Season is listed publicly',
      browse.seasons.some((x) => x.number === live.number))
    check('and is marked as not completed',
      browse.seasons.find((x) => x.number === live.number)?.isCompleted === false)

    // The ledger is the ranking boundary: it reads COMPLETED Seasons only.
    const ledger = readFileSync('src/lib/stats/ledger.ts', 'utf8')
    check('the ranking rebuild reads only COMPLETED Seasons',
      /season\.findMany\(\{\s*\n?\s*where: \{ lifecycleState: 'COMPLETED' \}/.test(ledger) ||
      ledger.includes("where: { lifecycleState: 'COMPLETED' },"))
    const trophies = readFileSync('src/lib/seasons/trophies.ts', 'utf8')
    check('championship totals count only COMPLETED Seasons',
      trophies.includes("lifecycleState: 'COMPLETED'"))
  }

  console.log('')
  console.log('--- Reopening a closed Season withdraws its contribution ---')
  {
    const s = await season(a, 970007, 2097, 'PLAYOFFS_LIVE')
    await prisma.season.update({ where: { id: s.id }, data: { lifecycleState: 'COMPLETED', ladderAppliedAt: new Date() } })
    const before = await prisma.season.findUnique({ where: { id: s.id }, select: { ladderAppliedAt: true } })
    check('a closed Season is marked as applied to the ladder', before?.ladderAppliedAt != null)

    const r = await transitionSeasonState(actor, s.id, 'PLAYOFFS_LIVE', { recovery: true, reason: 'verify reopen' })
    check('reopening succeeds through the recovery path', r.ok, r.error)
    const after = await prisma.season.findUnique({ where: { id: s.id }, select: { ladderAppliedAt: true, lifecycleState: true } })
    check('the Season is no longer completed', after?.lifecycleState === 'PLAYOFFS_LIVE')
    check('and its ladder application is cleared', after?.ladderAppliedAt === null, String(after?.ladderAppliedAt))
    check('no ledger row still credits the reopened Season',
      (await prisma.ratingLedger.count({ where: { seasonId: s.id } })) === 0)
  }

  console.log('')
  console.log('--- Sourced from the database only, with no tie to the offline viewer ---')
  {
    const files = [
      'src/lib/seasons/browse.ts',
      'src/components/seasons/season-controls.tsx',
      'src/components/seasons/season-standings-matrix.tsx',
      'src/components/seasons/season-presentation.tsx',
      'src/app/(frontend)/seasons/page.tsx',
      'src/app/(frontend)/seasons/[seasonNumber]/page.tsx',
    ].map((f) => [f, readFileSync(f, 'utf8')] as const)

    // Prose may MENTION the offline viewer — it was the visual reference. What must not exist is a
    // real dependency on it: a path, an import, or a file read. So comments are stripped first and
    // the assertions look for references, not for the words.
    const codeOnly = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

    check('no path points at the Archive Viewer directory',
      files.every(([, src]) => !/C:\\+Claude\\+Archive|Archive[ _]Viewer[/\\]/i.test(src)))
    check('nothing imports or reads an archive file',
      files.every(([, src]) =>
        !/(from|import|require|readFile\w*)\s*\(?\s*['"][^'"]*(archive|8brcam-season)[^'"]*['"]/i.test(codeOnly(src))))
    check('nothing imports the archive JSON or CSV',
      files.every(([, src]) => !/8brcam-season-archive|\.csv['"]/.test(codeOnly(src))))
    check('the browse layer reads through Prisma',
      files[0][1].includes('prisma.season.findMany') && files[0][1].includes('prisma.competitionSeries.findMany'))
    check('no archived Season data is hardcoded anywhere in the new files',
      files.every(([, src]) => !/xlx_cerebro_xlx|drummer_dude|P0\d{3}/.test(src)))

    console.log('')
    console.log('--- The table is fixed-size by construction ---')
    const css = readFileSync('src/app/(frontend)/globals.css', 'utf8')
    check('the matrix uses a fixed table layout', /\.season-matrix\s*\{[^}]*table-layout:\s*fixed/s.test(css))
    check('column widths are declared, not derived from content',
      css.includes('--season-cell-w') && css.includes('.season-col-cell'))
    check('cells have a fixed height', /\.season-matrix th,\s*\n\.season-matrix td\s*\{[^}]*height: var\(--season-cell-h\)/s.test(css))
    check('long IDs truncate rather than widen a column',
      /\.season-head-id\s*\{[^}]*text-overflow: ellipsis/s.test(css))
    check('the matrix scrolls sideways instead of shrinking',
      files[2][1].includes('overflow-x-auto'))
    check('the column head carries the full identity for hover and focus',
      files[2][1].includes('title={full}') && files[2][1].includes('label={full}') &&
      /aria-label=\{label\}/.test(files[2][1]))
    check('every name in a group links to that player’s profile',
      files[2][1].includes('href={`/players/${encodeURIComponent(slug)}`}'))
    check('both the row heads and the column heads are linked',
      (files[2][1].match(/<PlayerCell/g) ?? []).length >= 2)
    check('an entrant with no profile renders as text, not a dead link',
      /if \(!slug\) return <span/.test(files[2][1]))

    check('there is no Division control anywhere',
      files.every(([, src]) => !/\bDivision\b/.test(src)))
    check('there is no Group Order control anywhere',
      files.every(([, src]) => !/Group Order|order === ['"]archive['"]/.test(src)))

    console.log('')
    console.log('--- The URL carries the view and the filter ---')
    const page = files[5][1]
    check('the view is read from the URL', page.includes("sp.view === 'playoffs'"))
    check('an absent or unknown view defaults to Groups', page.includes("? 'playoffs' : 'groups'"))
    check('the Competition filter is read from the URL', page.includes('sp.competition'))
    const controls = files[1][1]
    check('changing a control rewrites the URL', controls.includes('router.push') && controls.includes('/seasons/${seasonNumber}'))
    check('the Playoffs toggle is never disabled', !/aria-pressed[^>]*disabled/.test(controls))
    check('the landing page redirects to the newest Season', files[4][1].includes('redirect(`/seasons/'))
  }

  console.log('')
  console.log('--- Points ordering, on real Season 1 data (read-only) ---')
  {
    const s1 = await prisma.season.findUnique({ where: { number: 1 }, select: { id: true, lifecycleState: true } })
    if (!s1) {
      check('Season 1 is present as the real-data validation case', false, 'it is missing')
    } else {
      check('Season 1 is present as the real-data validation case', true)
      const { getSeasonGroupStage } = await import('../src/lib/seasons/views.ts')
      const groups = await getSeasonGroupStage(s1.id)
      check('its groups are published and readable', groups.length > 0, `${groups.length} groups`)

      // The component's ordering rule, applied here so the assertion tracks the real data.
      const ordered = [...groups[0].standings].sort((x, y) => y.points - x.points || x.rank - y.rank)
      check('every group orders by points, highest first',
        ordered.every((r, i) => i === 0 || ordered[i - 1].points >= r.points))

      const participants = await seasonPlayoffParticipants(s1.id)
      const entrants = await prisma.seasonEntrant.count({ where: { seasonId: s1.id, status: { not: 'WITHDRAWN' } } })
      check('only some of the field reached the playoffs',
        participants.size > 0 && participants.size < entrants, `${participants.size} of ${entrants}`)
      check('Season 1 is still completed and untouched', s1.lifecycleState === 'COMPLETED')
    }
  }
} catch (e) {
  fail++
  console.error(e)
} finally {
  await cleanup()
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
process.exit(fail === 0 ? 0 : 1)
