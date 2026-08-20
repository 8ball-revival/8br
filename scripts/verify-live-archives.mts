/**
 * The Live / Archives classification rule, and the navigation built from it.
 *
 * These are the predicates that decide where a competition appears and whether it counts towards
 * the rankings. They are pure, so every state can be constructed deliberately rather than waited
 * for — which matters because the interesting cases (a completion that failed halfway, a reopened
 * record, a reconstruction being typed in) are exactly the ones a real database rarely holds.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json scripts/verify-live-archives.mts
 */
import {
  seasonIsLive, seasonIsArchived, seasonIsUpcoming, seasonSurface,
  seasonCountsForRankings, tournamentIsLive, tournamentIsArchived, tournamentSurface,
  tournamentCountsForRankings, tournamentState,
  resultCountsForRating, resultCountsForRecord,
  SEASON_STATES, COMPLETENESS_LABEL,
  type SeasonFacts, type TournamentFacts,
} from '../src/lib/competition/lifecycle-rules.ts'
import { buildNav } from '../src/lib/nav.ts'

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

const NOW = new Date('2026-08-19T00:00:00Z')

/** A completed, finalised Season — the only shape that belongs in Archives. */
const archivedSeason = (o: Partial<SeasonFacts> = {}): SeasonFacts => ({
  lifecycleState: 'COMPLETED', ladderAppliedAt: NOW, reconstruction: false,
  reopenedAt: null, cancelledAt: null, deletedAt: null, ...o,
})

const runningSeason = (o: Partial<SeasonFacts> = {}): SeasonFacts => ({
  lifecycleState: 'GROUP_STAGE_LIVE', ladderAppliedAt: null, reconstruction: false,
  reopenedAt: null, cancelledAt: null, deletedAt: null, ...o,
})

// ─────────────────────────────────────────────── Live
section('A Season is Live only while it is genuinely under way and public')
{
  for (const state of ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'GROUP_SETUP',
    'GROUP_STAGE_LIVE', 'GROUPS_CLOSED', 'PLAYOFFS_LIVE']) {
    check(`${state} is Live`, seasonIsLive(runningSeason({ lifecycleState: state }), true), state)
  }

  // The case the specification calls out by name.
  check('PLAYOFF_SETUP is STILL Live — the groups are on screen even though the bracket is private',
    seasonIsLive(runningSeason({ lifecycleState: 'PLAYOFF_SETUP' }), true))

  check('COMPLETED is not Live', !seasonIsLive(archivedSeason(), true))
  check('a scheduled Season is not Live — it belongs in Upcoming',
    !seasonIsLive(runningSeason({ lifecycleState: 'REGISTRATION_SCHEDULED' }), true))
  check('...and IS Upcoming',
    seasonIsUpcoming(runningSeason({ lifecycleState: 'REGISTRATION_SCHEDULED' }), true))
  check('a running Season is not Upcoming', !seasonIsUpcoming(runningSeason(), true))

  check('a private Season is not Live however far along it is',
    !seasonIsLive(runningSeason(), false))
  check('a HISTORICAL RECONSTRUCTION never appears under Live while it is being entered',
    !seasonIsLive(runningSeason({ reconstruction: true }), true))
  check('a cancelled Season is not Live', !seasonIsLive(runningSeason({ cancelledAt: NOW }), true))
  check('a deleted Season is not Live', !seasonIsLive(runningSeason({ deletedAt: NOW }), true))
  check('a reopened Season is not Live', !seasonIsLive(runningSeason({ reopenedAt: NOW }), true))

  // Every state is accounted for: none may be silently neither Live, Upcoming nor Archived.
  const unclassified = SEASON_STATES.filter((s) => {
    const facts = runningSeason({ lifecycleState: s, ladderAppliedAt: s === 'COMPLETED' ? NOW : null })
    return !seasonIsLive(facts, true) && !seasonIsUpcoming(facts, true) && !seasonIsArchived(facts)
  })
  check('every lifecycle state lands somewhere', unclassified.length === 0, unclassified.join(', '))
}

// ─────────────────────────────────────────────── Archives
section('Archives requires completion AND finalisation')
{
  check('a completed, finalised Season is archived', seasonIsArchived(archivedSeason()))

  check('a COMPLETED Season with no finalisation receipt is NOT archived',
    !seasonIsArchived(archivedSeason({ ladderAppliedAt: null })))
  check('...and stays in Creator, where somebody can look at it',
    seasonSurface(archivedSeason({ ladderAppliedAt: null }), true) === 'creator-only')

  check('an unfinished Season is not archived', !seasonIsArchived(runningSeason()))
  check('a cancelled Season is not archived', !seasonIsArchived(archivedSeason({ cancelledAt: NOW })))
  check('a deleted Season is not archived', !seasonIsArchived(archivedSeason({ deletedAt: NOW })))
  check('a REOPENED Season leaves Archives', !seasonIsArchived(archivedSeason({ reopenedAt: NOW })))

  // A completed reconstruction IS archived — being rebuilt by hand does not make it less finished.
  check('a completed reconstruction IS archived once finalised',
    seasonIsArchived(archivedSeason({ reconstruction: true })))
  check('...but is never Live on the way there',
    !seasonIsLive(runningSeason({ reconstruction: true }), true))

  check('exactly one surface applies', seasonSurface(archivedSeason(), true) === 'archives'
    && seasonSurface(runningSeason(), true) === 'live'
    && seasonSurface(runningSeason(), false) === 'creator-only')
}

section('Rankings eligibility is the SAME rule as Archives, not a similar one')
{
  // If these could differ, a reader could find a competition in the archive whose results are
  // missing from the ranking. The test is identity, deliberately.
  check('season ranking eligibility IS archive eligibility',
    seasonCountsForRankings === seasonIsArchived)
  check('tournament ranking eligibility IS archive eligibility',
    tournamentCountsForRankings === tournamentIsArchived)

  const cases: SeasonFacts[] = [
    archivedSeason(),
    archivedSeason({ ladderAppliedAt: null }),
    archivedSeason({ reopenedAt: NOW }),
    runningSeason(),
    runningSeason({ reconstruction: true }),
    archivedSeason({ cancelledAt: NOW }),
  ]
  check('and they agree on every state',
    cases.every((c) => seasonCountsForRankings(c) === seasonIsArchived(c)))

  check('a reopened Season stops counting towards the rankings',
    !seasonCountsForRankings(archivedSeason({ reopenedAt: NOW })))
  check('...and counts again once the reopen is cleared',
    seasonCountsForRankings(archivedSeason({ reopenedAt: null })))
}

section('Individual results: what counts for a record, and what moves a rating')
{
  check('an ordinary result counts for both', resultCountsForRating({}) && resultCountsForRecord({}))

  check('a bye counts for neither — nobody played',
    !resultCountsForRating({ isBye: true }) && !resultCountsForRecord({ isBye: true }))
  check('an administrative advancement counts for neither',
    !resultCountsForRating({ isAdministrative: true }) && !resultCountsForRecord({ isAdministrative: true }))

  // The case that separates the two questions.
  check('a forfeit counts for the RECORD — it is an official win and an official loss',
    resultCountsForRecord({ isForfeit: true }))
  check('...but does NOT move the rating, because no frames were contested',
    !resultCountsForRating({ isForfeit: true }))
}

// ─────────────────────────────────────────────── Tournaments
section('Tournaments follow the same rule over their own lifecycle')
{
  const t = (o: Partial<TournamentFacts> = {}): TournamentFacts => ({
    lifecycleState: 'IN_PROGRESS', archivedAt: null, reconstruction: false, reopenedAt: null, ...o,
  })

  check('IN_PROGRESS is Live', tournamentIsLive(t(), true))
  check('REGISTRATION_OPEN is Live', tournamentIsLive(t({ lifecycleState: 'REGISTRATION_OPEN' }), true))
  check('DRAFT is not Live', !tournamentIsLive(t({ lifecycleState: 'DRAFT' }), true))
  check('CANCELLED is not Live', !tournamentIsLive(t({ lifecycleState: 'CANCELLED' }), true))
  check('a private tournament is not Live', !tournamentIsLive(t(), false))
  check('a reconstruction is not Live', !tournamentIsLive(t({ reconstruction: true }), true))

  check('COMPLETED with a finalisation receipt is archived',
    tournamentIsArchived(t({ lifecycleState: 'COMPLETED', archivedAt: NOW })))
  check('COMPLETED without one is NOT archived',
    !tournamentIsArchived(t({ lifecycleState: 'COMPLETED', archivedAt: null })))
  check('CANCELLED is never archived',
    !tournamentIsArchived(t({ lifecycleState: 'CANCELLED', archivedAt: NOW })))
  check('a reopened tournament leaves Archives',
    !tournamentIsArchived(t({ lifecycleState: 'COMPLETED', archivedAt: NOW, reopenedAt: NOW })))
  check('cancelled sits in Creator, not on a public surface',
    tournamentSurface(t({ lifecycleState: 'CANCELLED' }), true) === 'creator-only')

  // Legacy rows carry only the older run state.
  check('a legacy ACTIVE row reads as under way',
    tournamentState({ lifecycleState: null, status: 'ACTIVE' }) === 'IN_PROGRESS')
  check('a legacy COMPLETED row reads as completed',
    tournamentState({ lifecycleState: null, status: 'COMPLETED' }) === 'COMPLETED')
  check('the explicit lifecycle wins over the legacy state when both are set',
    tournamentState({ lifecycleState: 'DRAFT', status: 'ACTIVE' }) === 'DRAFT')
}

// ─────────────────────────────────────────────── Navigation
/*
 * Seasons and Cups are PERMANENT top-level tabs.
 *
 * They used to be two dropdowns — Live and Archives — each opening a Seasons/Cups pair, with Live
 * appearing and disappearing depending on what was running. That made the tab a reader needed
 * depend on a fact they could not see before clicking. The classification rules above still decide
 * what appears WITHIN a page; they no longer decide what the navigation looks like.
 */
section('Navigation offers one permanent destination per competition type')
{
  const labels = (entries: ReturnType<typeof buildNav>) => entries.map((e) => e.label).join(' · ')
  const href = (entries: ReturnType<typeof buildNav>, label: string) =>
    entries.find((e) => e.label === label)?.href

  const pub = buildNav({})
  check('the public order is Home · Seasons · Cups · Rankings · News',
    labels(pub) === 'Home · Seasons · Cups · Rankings · News', labels(pub))
  check('Seasons points at /seasons', href(pub, 'Seasons') === '/seasons', href(pub, 'Seasons'))
  check('Cups points at /cups', href(pub, 'Cups') === '/cups', href(pub, 'Cups'))

  // The whole point of the change: neither tab is conditional, and neither hides behind a menu.
  check('there is no Live tab', !pub.some((e) => e.label === 'Live'), labels(pub))
  check('there is no Archives tab', !pub.some((e) => e.label === 'Archives'), labels(pub))
  check('every entry is a link with a destination', pub.every((e) => typeof e.href === 'string' && e.href !== ''))
  check('nothing points into the retired sections',
    !JSON.stringify(pub).includes('/live/') && !JSON.stringify(pub).includes('/archives/'),
    JSON.stringify(pub))

  const admin = buildNav({ canCreate: true, adminItems: [{ label: 'Admin', href: '/staff' }] })
  check('the administrative order is Home · Seasons · Cups · Creator · Rankings · News · Admin',
    labels(admin) === 'Home · Seasons · Cups · Creator · Rankings · News · Admin', labels(admin))
  check('Creator sits between Cups and Rankings', href(admin, 'Creator') === '/creator')
  check('Creator is absent for a public visitor', !pub.some((e) => e.label === 'Creator'))
  check('Admin is absent for a public visitor', !pub.some((e) => e.label === 'Admin'))

  // Seasons and Cups are public and unconditional: they must not appear or vanish with a role.
  check('Seasons and Cups are shown to everyone',
    ['Seasons', 'Cups'].every((l) => pub.some((e) => e.label === l) && admin.some((e) => e.label === l)))
}

section('Public branding')
{
  const all = buildNav({ canCreate: true })
  const text = JSON.stringify(all) + JSON.stringify(COMPLETENESS_LABEL)
  check('no "8BR" abbreviation appears in navigation or archive labels', !/\b8BR\b/.test(text), text)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
