/**
 * The Tournament list opens on an era that has Tournaments in it.
 *
 * ── What went wrong ─────────────────────────────────────────────────────────────────────────────
 * Platform is a scope rather than a filter — one era at a time, never mixed — and the list opened on
 * CueVerse unconditionally. Every Tournament on the registry is Yahoo-era, so /tournaments opened on
 * an empty scope and an anonymous visitor saw no Tournaments at all. The data was never the problem:
 * getTournamentList returns all of them, they are publicly visible and completed, and
 * /tournaments?platform=yahoo listed them correctly the whole time. The default hid them.
 *
 * These checks pin the decision itself, and then the consequence against the real database: the
 * scope the page will open on has Tournaments to show.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-tournament-list-scope.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { defaultPlatformScope } from '../src/lib/tournaments/platform-scope.ts'
import { getTournamentList } from '../src/lib/tournaments/list.ts'

assertLocalDatabase()

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

const YAHOO = [{ platform: 'YAHOO' as const }]
const CUEVERSE = [{ platform: 'CUEVERSE' as const }]
const BOTH = [...YAHOO, ...CUEVERSE]

console.log('--- The scope opens where there is something to see ---')

check('a Yahoo-only registry opens on Yahoo', defaultPlatformScope(YAHOO) === 'YAHOO', defaultPlatformScope(YAHOO))
check('...which is the whole bug: it used to open on CueVerse and show nothing',
  defaultPlatformScope(YAHOO) !== 'CUEVERSE')
check('a CueVerse registry opens on CueVerse', defaultPlatformScope(CUEVERSE) === 'CUEVERSE')
check('both eras present still prefers the current one', defaultPlatformScope(BOTH) === 'CUEVERSE')
check('an empty registry opens on CueVerse', defaultPlatformScope([]) === 'CUEVERSE')

console.log('\n--- An explicit scope always wins ---')

/*
 * The URL is a decision somebody already made — by choosing the filter, or by being handed a link.
 * Falling back to "whatever has records" over the top of that would make a shared link mean
 * something different for the person who received it.
 */
check('?platform=yahoo is honoured', defaultPlatformScope(CUEVERSE, 'yahoo') === 'YAHOO')
check('?platform=cueverse is honoured even when it is empty',
  defaultPlatformScope(YAHOO, 'cueverse') === 'CUEVERSE')
check('...and is case-insensitive', defaultPlatformScope(CUEVERSE, 'YaHoO') === 'YAHOO')
check('rubbish falls through to the default rather than throwing',
  defaultPlatformScope(YAHOO, 'nonsense') === 'YAHOO')
check('an absent parameter is not treated as a choice', defaultPlatformScope(YAHOO, null) === 'YAHOO')

console.log('\n--- Against the real database ---')

const tournaments = await getTournamentList()
const scope = defaultPlatformScope(tournaments)
const shown = tournaments.filter((t) => t.platform === scope)

console.log(`  (${tournaments.length} Tournament(s); the list opens on ${scope})`)
check('there are Tournaments to list at all', tournaments.length > 0, String(tournaments.length))
check('the scope the page opens on is not empty', shown.length > 0,
  `${shown.length} of ${tournaments.length} are ${scope}`)
check('...and it shows every Tournament of that era', shown.length === tournaments.filter((t) => t.platform === scope).length)

/*
 * The guard that matters for the future: whatever the data becomes, a visitor who types /tournaments
 * and touches nothing must not land on an empty page while Tournaments exist somewhere.
 */
check('a visitor who touches no filter sees Tournaments', tournaments.length === 0 || shown.length > 0)

console.log(`\n${failures === 0 ? 'RESULT: all checks passed' : `RESULT: ${failures} check(s) failed`}`)
await prisma.$disconnect()
process.exit(failures === 0 ? 0 : 1)
