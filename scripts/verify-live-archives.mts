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
import { buildNav, isMenu, type NavMenu } from '../src/lib/nav.ts'

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
section('Navigation is built from what is actually Live')
{
  const labels = (entries: ReturnType<typeof buildNav>) =>
    entries.map((e) => e.label).join(' · ')
  const menu = (entries: ReturnType<typeof buildNav>, label: string) =>
    entries.find((e) => isMenu(e) && e.label === label) as NavMenu | undefined

  const none = buildNav({ live: { seasons: 0, tournaments: 0 } })
  check('with nothing Live the Live item is ABSENT — an empty Live tab promises something',
    !none.some((e) => e.label === 'Live'), labels(none))
  check('the public order is Home · Archives · Rankings · News',
    labels(none) === 'Home · Archives · Rankings · News', labels(none))

  const seasonsOnly = buildNav({ live: { seasons: 1, tournaments: 0 } })
  const m1 = menu(seasonsOnly, 'Live')
  check('with only Seasons Live, the Live item appears', !!m1)
  check('...offering only Seasons, at full width rather than beside a dead option',
    m1?.items.length === 1 && m1.items[0].href === '/live/seasons')

  const tournamentsOnly = buildNav({ live: { seasons: 0, tournaments: 3 } })
  check('with only Cups Live, only Cups is offered',
    menu(tournamentsOnly, 'Live')?.items.length === 1
    && menu(tournamentsOnly, 'Live')?.items[0].href === '/live/cups')
  check('...and it is labelled Cups, the public term',
    menu(tournamentsOnly, 'Live')?.items[0].label === 'Cups')

  const both = buildNav({ live: { seasons: 2, tournaments: 1 } })
  check('with both, both options appear side by side',
    menu(both, 'Live')?.items.map((i) => i.label).join('|') === 'Seasons|Cups')
  check('Live carries the live indicator', menu(both, 'Live')?.live === true)

  // Archives is unconditional: a type with no completed entries still has an archive, and its
  // empty state explains that better than a missing menu item.
  for (const nav of [none, seasonsOnly, tournamentsOnly, both]) {
    check('Archives always offers both Seasons and Cups',
      menu(nav, 'Archives')?.items.map((i) => i.href).join('|') === '/archives/seasons|/archives/cups')
  }
  check('Archives is never marked live', menu(none, 'Archives')?.live !== true)

  const admin = buildNav({ live: { seasons: 0, tournaments: 0 }, canCreate: true, adminItems: [{ label: 'Admin', href: '/staff' }] })
  check('the administrative order is Home · Archives · Creator · Rankings · News · Admin',
    labels(admin) === 'Home · Archives · Creator · Rankings · News · Admin', labels(admin))
  check('Creator is absent for a public visitor', !none.some((e) => e.label === 'Creator'))
  check('Admin is absent for a public visitor', !none.some((e) => e.label === 'Admin'))

  const full = buildNav({ live: { seasons: 1, tournaments: 1 }, canCreate: true, adminItems: [{ label: 'Admin', href: '/staff' }] })
  check('with everything present the order is Home · Live · Archives · Creator · Rankings · News · Admin',
    labels(full) === 'Home · Live · Archives · Creator · Rankings · News · Admin', labels(full))

  // Live is a trigger, not a destination — it must have no href of its own.
  check('Live is a menu, not a link', isMenu(menu(both, 'Live')!) && !('href' in menu(both, 'Live')!))
  check('Archives is a menu, not a link', !('href' in menu(none, 'Archives')!))
}

section('Public branding')
{
  const all = buildNav({ live: { seasons: 1, tournaments: 1 }, canCreate: true })
  const text = JSON.stringify(all) + JSON.stringify(COMPLETENESS_LABEL)
  check('no "8BR" abbreviation appears in navigation or archive labels', !/\b8BR\b/.test(text), text)
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
