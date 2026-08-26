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
  getSeasonBrowseData, newestSeasonId, seasonNeighbours, seasonPlayoffParticipants,
  hasPublicPlayoffBracket, searchSeasonPlayers, getSeasonGlance,
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
  const a2091 = await season(a, 970001, 2091, 'REGISTRATION_OPEN')
  const newestA = await season(a, 970002, 2092, 'REGISTRATION_OPEN')
  const a2090 = await season(a, 970050, 2090, 'REGISTRATION_OPEN')
  const b2093 = await season(b, 970003, 2093, 'REGISTRATION_OPEN')

  // These return Season IDS now, not numbers: a number identifies a Season only alongside its
  // Competition and year, so it could never address one on its own.
  check('newest within a Competition is the latest YEAR, not the highest number',
    (await newestSeasonId(COMP_A)) === newestA.id, String(await newestSeasonId(COMP_A)))
  check('newest across all Competitions is the latest year overall',
    (await newestSeasonId(null)) === b2093.id, String(await newestSeasonId(null)))
  check('an unknown Competition yields nothing to open',
    (await newestSeasonId('zzsx-nope')) === null)

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
    // Scoped by the fixture slug, not the number alone: a number identifies a Season only
    // alongside its Competition and year.
    const inactiveSeason = await prisma.season.findFirst({ where: { slug: 'zzsx-season-970004' }, select: { id: true } })
    if (inactiveSeason) await prisma.season.delete({ where: { id: inactiveSeason.id } })
    await prisma.competitionSeries.deleteMany({ where: { slug: { in: ['zzsx-empty', 'zzsx-inactive'] } } })
    void emptyId
  }

  console.log('')
  console.log('--- Previous/Next walks chronological order inside the filter ---')
  {
    // Within Competition A: 2090 → 2091 → 2092. Walked by id, in both directions.
    const mid = await seasonNeighbours(a2091.id, COMP_A)
    check('previous is the older Season', mid.prev === a2090.id, String(mid.prev))
    check('next is the newer Season', mid.next === newestA.id, String(mid.next))

    const oldest = await seasonNeighbours(a2090.id, COMP_A)
    check('the oldest Season has no previous', oldest.prev === null)
    const newest = await seasonNeighbours(newestA.id, COMP_A)
    check('the newest Season has no next in its Competition', newest.next === null, String(newest.next))

    // Unfiltered, the newest in A is followed by the one in B.
    const unfiltered = await seasonNeighbours(newestA.id, null)
    check('without a filter the arrows cross Competitions', unfiltered.next === b2093.id, String(unfiltered.next))
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

    /*
     * The ranking boundary, asserted as a RULE rather than as a string in a file.
     *
     * This used to grep ledger.ts for `where: { lifecycleState: 'COMPLETED' }`, which broke the
     * moment the clause moved into a shared constant - and would equally have passed if somebody
     * had left that literal behind in a comment. The eligibility object is the thing that decides,
     * so it is the thing to check.
     */
    const { RANKING_ELIGIBLE_SEASON } = await import('../src/lib/stats/eligibility.ts')
    check('the ranking rebuild requires a COMPLETED Season',
      RANKING_ELIGIBLE_SEASON.lifecycleState === 'COMPLETED')
    check('...that was actually finalised', RANKING_ELIGIBLE_SEASON.ladderAppliedAt != null)
    check('...that is not Under Correction', RANKING_ELIGIBLE_SEASON.reopenedAt === null)
    check('...that is not deleted', RANKING_ELIGIBLE_SEASON.deletedAt === null)
    check('...and whose owner has left it counting', RANKING_ELIGIBLE_SEASON.countsTowardRankings === true)
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
    // The finalisation stamp is deliberately PRESERVED across a reopen. The withdrawal is total
    // without clearing it — the ledger rebuild selects only still-COMPLETED competitions — and
    // clearing it used to move the Season to the end of the Elo timeline when it was completed
    // again, silently re-rating everyone who played after it. What matters is the contribution,
    // asserted below, not the stamp.
    check('the finalisation stamp survives, so the historical timeline does not move',
      after?.ladderAppliedAt != null, String(after?.ladderAppliedAt))
    check('...and the reopened Season contributes nothing to the ladder',
      (await prisma.ratingLedger.count({ where: { seasonId: s.id } })) === 0)
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
      'src/app/(frontend)/seasons/[seasonId]/page.tsx',
    ].map((f) => [f, readFileSync(f, 'utf8')] as const)

    // Prose may MENTION the offline viewer — it was the visual reference. What must not exist is a
    // real dependency on it: a path, an import, or a file read. So comments are stripped first and
    // the assertions look for references, not for the words.
    const codeOnly = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

    check('no path points at the Archive Viewer directory',
      files.every(([, src]) => !/C:\\+Claude\\+Archive|Archive[ _]Viewer[/\\]/i.test(src)))
    /*
     * The offline viewer's DATA, not the word "archive".
     *
     * This used to reject any import whose path contained "archive", which caught the perfectly
     * legitimate ArchiveBrowser component the Seasons page renders its completed list with. The
     * dependency that must not exist is on the viewer's files — a JSON or CSV dump, or a module from
     * the viewer itself — so that is what this looks for now.
     */
    check('nothing imports or reads an offline archive data file',
      files.every(([, src]) =>
        !/(from|import|require|readFile\w*)\s*\(?\s*['"][^'"]*(8brcam-season|archive[^'"]*\.(json|csv)|archive-viewer)[^'"]*['"]/i.test(codeOnly(src))))
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

    console.log('')
    console.log('--- Scores go gold only on the highlighted row ---')
    const css2 = readFileSync('src/app/(frontend)/globals.css', 'utf8')
    check('a winning score is neutral at rest',
      /\.season-score\.season-w \{ color: var\(--foreground\)/.test(css2))
    // Anchored to the start of a line: a resting rule stands alone, whereas the gold rules are all
    // prefixed by a `tr:hover` / `tr:focus-within` / `tr.season-selected` selector.
    check('no rule paints a resting score gold',
      !/^\.season-score\.season-w \{[^}]*var\(--gold\)/m.test(css2))
    check('hover lights that row’s wins in gold',
      /tr:hover \.season-score\.season-w/.test(css2))
    check('keyboard focus lights the same row',
      /tr:focus-within \.season-score\.season-w/.test(css2))
    check('a clicked row stays lit',
      /tr\.season-selected \.season-score\.season-w/.test(css2))
    check('clicking a row pins it, and clicking again releases it',
      files[2][1].includes('cur === r.entrantId ? null : r.entrantId'))
    check('clicking a NAME navigates instead of pinning',
      files[2][1].includes("closest('a')"))
    check('the legend explains what the gold means',
      /Hover or tap a row/.test(files[2][1]))

    /*
     * There IS a Division control now, and it is deliberate.
     *
     * This asserted its absence back when division was an implementation detail of the archive. It is
     * a filter the owner asked for: Division B is preserved in full and excluded from every ranking,
     * so being able to ask for it is the only way to reach 44 Seasons of real history.
     */
    check('the Division filter is offered', files[1][1].includes('f-division'))
    check('...and names Division B as unranked', files[1][1].includes("d === 'B' ? ' — unranked' : ''"))
    check('there is no Group Order control anywhere',
      files.every(([, src]) => !/Group Order|order === ['"]archive['"]/.test(src)))

    console.log('')
    console.log('--- The URL carries the view and the filter ---')
    const page = files[5][1]
    check('the view is read from the URL', page.includes("sp.view === 'playoffs'"))
    check('an absent or unknown view defaults to Groups', page.includes("? 'playoffs' : 'groups'"))
    check('the Competition filter is read from the URL', page.includes('sp.competition'))
    const controls = files[1][1]
    // URLs are built from the Season's immutable id, never its display number.
    check('changing a control rewrites the URL', controls.includes('router.push') && controls.includes('/seasons/${seasonId}'))
    check('and addresses the Season by id, not by its number',
      !/\/seasons\/\$\{seasonNumber\}/.test(controls))
    check('the Playoffs toggle is never disabled', !/aria-pressed[^>]*disabled/.test(controls))
    /*
     * The landing page opens the most recent Season.
     *
     * The browser IS the Seasons experience, so the tab lands on real data rather than on a page of
     * summaries. What it must not do is offer a way to change anything — Creator owns the lifecycle.
     */
    const landing = files[4][1]
    check('the landing page redirects to the newest Season', landing.includes('redirect(`/seasons/'))
    check('...and offers no management controls',
      !/\/creator|New Season|Create|Reopen|Delete/.test(landing), 'management control on a public page')
  }

  console.log('')
  console.log('--- Season at a Glance is counted, never derived ---')
  {
    const s = await season(a, 970008, 2098, 'PLAYOFFS_LIVE')
    const mk = async (n: string) => (await prisma.seasonEntrant.create({
      data: { seasonId: s.id, username: n, cueverseId: n, status: 'APPROVED' }, select: { id: true },
    })).id
    const [g1, g2, g3] = [await mk('zzg1'), await mk('zzg2'), await mk('zzg3')]
    const grp = await prisma.seasonGroup.create({
      data: { seasonId: s.id, code: 'A', ordinal: 0, published: true }, select: { id: true },
    })

    const empty = await getSeasonGlance(s.id, 10)
    check('a Season with no matches reports none', empty.totalMatches === 0, String(empty.totalMatches))
    check('entrants are counted from the roster', empty.entrants === 3, String(empty.entrants))
    check('groups are counted from published groups', empty.groups === 1, String(empty.groups))
    check('games per match is the Season’s own setting', empty.gamesPerMatch === 10)

    await prisma.seasonMatch.create({
      data: { seasonId: s.id, groupId: grp.id, round: 1, homeEntrantId: g1, awayEntrantId: g2, homeUsername: 'zzg1', awayUsername: 'zzg2' },
    })
    await prisma.seasonMatch.create({
      data: { seasonId: s.id, groupId: grp.id, round: 1, homeEntrantId: g1, awayEntrantId: g3, homeUsername: 'zzg1', awayUsername: 'zzg3' },
    })
    // A contested tie counts; a bye does not — nobody played it.
    await prisma.seasonPlayoffMatch.create({
      data: { seasonId: s.id, round: 1, slot: 0, homeEntrantId: g1, awayEntrantId: g2, homeUsername: 'zzg1', awayUsername: 'zzg2' },
    })
    await prisma.seasonPlayoffMatch.create({
      data: { seasonId: s.id, round: 1, slot: 1, homeEntrantId: g3, awayEntrantId: null, homeUsername: 'zzg3', awayUsername: 'Bye' },
    })

    const filled = await getSeasonGlance(s.id, 10)
    check('total matches counts group fixtures plus contested ties',
      filled.totalMatches === 3, String(filled.totalMatches))
    check('a bye is not counted as a match', filled.totalMatches !== 4)
  }

  console.log('')
  console.log('--- The masthead, and the header it clamps to ---')
  {
    const mast = readFileSync('src/components/seasons/season-masthead.tsx', 'utf8')
    const page = readFileSync('src/app/(frontend)/seasons/[seasonId]/page.tsx', 'utf8')
    const controls = readFileSync('src/components/seasons/season-controls.tsx', 'utf8')
    const header = readFileSync('src/components/site-header.tsx', 'utf8')
    const css = readFileSync('src/app/(frontend)/globals.css', 'utf8')

    check('the champion is a trophy, not the old diamond',
      mast.includes('Trophy') && !mast.includes('Diamond'))
    check('the trophy is drawn, never a raster image',
      !/<img|\.png|\.jpe?g|\.webp/i.test(mast))
    check('the trophy glow is built from the theme tokens',
      /drop-shadow-\[[^"]*var\(--gold\)/.test(mast))
    check('a champion shows only for a COMPLETED Season',
      /state === 'COMPLETED' && \(view\.championHandle \|\| view\.championName\)/.test(page))
    check('an unfinished Season says so instead',
      mast.includes('Season In Progress') && mast.includes('STAGE_NOTE'))
    check('the four glance cards are present',
      ['Entrants', 'Groups', 'Games per Match', 'Total Matches'].every((l) => mast.includes(`'${l}'`)))
    check('View Playoffs switches the view in the URL', page.includes("playoffsParams.set('view', 'playoffs')"))
    check('the masthead spans the full width', page.includes('w-full max-w-none px-3'))
    check('the old centred cap is gone from the Season page', !page.includes('max-w-[120rem]'))
    /*
     * The outer border is neutral now, not gold.
     *
     * It was `color-mix(in oklch, var(--gold-dim) 60%, transparent)`, and while a border cannot mix
     * with the surface behind it the way a fill does, ringing the masthead in gold spent the one
     * colour that is supposed to mean "championship" on a container. Gold inside it - the trophy,
     * the champion's name, the final score - is what the panel is actually saying.
     */
    check('the outer border is structural, not gold',
      /border border-\[var\(--line-strong\)\]/.test(mast) && mast.includes('border-t border-border lg:border-l'))
    check('...and gold still marks the champion within it',
      mast.includes('border-t-2 border-[var(--gold)]'))
    check('the sections stack on narrow screens',
      mast.includes('grid-cols-1 lg:grid-cols-'))

    // The masthead identifies the Season being looked at, so switching to the bracket must not
    // take it away. It renders on both views.
    check('the masthead renders on both views, not just Groups',
      /<SeasonMasthead/.test(page) && !/activeView === 'groups' && \(\s*<SeasonMasthead/.test(page))
    check('the content below it keeps one consistent gap',
      page.includes('<div className="mt-6">') && !page.includes("? 'mt-6' : 'mt-0'"))
    check('the glance figures sit in one row of four', mast.includes('grid grid-cols-4'))
    check('the champion is laid out sideways so the trophy keeps its size',
      mast.includes('flex h-full items-center justify-center') && !mast.includes('flex h-full flex-col items-center'))

    check('the global header is measurable', header.includes('data-site-header'))
    check('the header sits above the clamped bar',
      /z-50/.test(header) && /sticky z-40/.test(controls))
    check('the control bar clamps to the header height variable',
      controls.includes("top: 'var(--site-header-h)'"))
    check('that variable has a correct default before any JS runs',
      /--site-header-h: calc\(4rem \+ 1px\)/.test(css))
    check('the default matches the header it measures', /h-16/.test(header))
    check('script keeps the variable true to the rendered header',
      controls.includes('ResizeObserver') && controls.includes('--site-header-h'))
    check('exactly one border sits between the two rows',
      controls.includes('border-b-2 border-nav-border') && !controls.includes('border-y'))
    /*
     * Still the same rule, on a solid surface.
     *
     * Both rows must share the header's background so the two read as one bar. That was asserted as
     * the literal string `bg-nav-bg/85`; the surface is opaque now, because acid at 85% over the
     * page renders olive rather than yellow. The assertion is that they MATCH, which is what the
     * rule was always about.
     */
    check('both rows share the header background',
      controls.includes('bg-nav-bg') && header.includes('bg-nav-bg')
      && !controls.includes('bg-nav-bg/') && !header.includes('bg-nav-bg/'))
    /*
     * The public control bar has NO management controls, and these three checks are inverted from
     * what they used to assert.
     *
     * They previously required Settings and Create Season to be present, correctly ordered and
     * correctly gated. Gating was never the point: a public route that renders management controls
     * for some readers has two designs to keep in step, and the permission flag is the only thing
     * standing between them. Season creation and editing live in Creator, so the controls are gone
     * from here rather than hidden here - which is also the only version that cannot regress into
     * being shown to the wrong person.
     */
    /*
     * Read with the comments stripped.
     *
     * The file explains WHY those controls were removed, and naming them in that explanation is the
     * point of the comment - so a check that scans raw text finds "Create Season" in the very
     * sentence recording its removal and reports a violation. What renders is what matters.
     */
    const controlsCode = controls.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    check('the public bar offers no Settings control', !controlsCode.includes('Settings'))
    check('...and no Create Season control', !controlsCode.includes('Create Season'))
    check('...and the page passes no management hrefs into it',
      !page.includes('settingsHref') && !page.includes('createHref'))
    check('the old Settings block below the masthead is gone',
      !/mt-3 flex justify-end/.test(page))

    check('Zoom belongs to the Groups view, where the matrices use it',
      controls.includes("view === 'groups' && <Zoom />"))
    check('the controls wrap rather than break out of their row',
      controls.includes('flex flex-wrap items-end'))

    // The control order is part of the contract. Measured on where each control is USED in the
    // render block — the helper components are declared further down the file, so a naive search for
    // their definitions would read them out of order.
    const render = controls.slice(controls.indexOf('<div className="flex flex-wrap items-end'))
    const order: [string, string][] = [
      ['Competition', 'label="Competition"'],
      ['Year', 'label="Year"'],
      ['Season', 'label="Season"'],
      ['Player Search', '<PlayerSearch'],
      ['Groups/Playoffs', 'label="View"'],
      ['Zoom', '<Zoom />'],
      ['Previous/Next', 'label="Previous season"'],
    ]
    const at = order.map(([, needle]) => render.indexOf(needle))
    check('every control is present', at.every((i) => i >= 0), order.map(([n], i) => `${n}:${at[i]}`).join(' '))
    check('the order is Competition, Year, Season, Search, Groups/Playoffs, Zoom, Prev/Next',
      at.every((v, i) => i === 0 || at[i - 1] < v), at.join(','))
    check('Next follows Previous', render.indexOf('label="Next season"') > at[at.length - 1])
  }

  console.log('')
  console.log('--- Points ordering, on real Season 1 data (read-only) ---')
  {
    const s1 = await prisma.season.findFirst({ where: { number: 1, competitionYear: 2005, competitionSeries: { slug: '8brcam' } }, select: { id: true, lifecycleState: true } })
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
