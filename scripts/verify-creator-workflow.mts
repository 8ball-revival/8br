/**
 * The Creator workflow model: which stages a record has, and where it is.
 *
 * This is the spine of the whole administrative surface — the shell, the navigation and every stage
 * guard read it — so it is worth pinning down on its own, away from any page. The rules it encodes:
 *
 *   - the stages come from the FORMAT, so a Swiss Tournament has no bracket stage at all rather than
 *     a disabled one, and a single-elimination Tournament has no group stage;
 *   - a Season always runs groups into a bracket, whichever elimination rule the bracket uses;
 *   - everything before the current stage stays reachable, because correcting an earlier stage is
 *     ordinary work;
 *   - everything after it is locked, because a bracket for a Season that has not chosen its entrants
 *     is a page that can only apologise;
 *   - an unrecognised lifecycle state still resolves somewhere a person can look.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-creator-workflow.mts
 */
import { stagesFor, currentStage, workflowFor, stageReachable } from '../src/lib/creator/workflow.ts'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)
const ids = (v: { id: string }[]) => v.map((s) => s.id).join(' → ')

section('The stages a record has come from its format')
check('a Season runs groups into a bracket',
  ids(stagesFor('season')) === 'setup → entrants → groups → playoffs → complete', ids(stagesFor('season')))
check('...whichever elimination rule the bracket uses',
  ids(stagesFor('season', 'DOUBLE_ELIM')) === ids(stagesFor('season', 'SINGLE_ELIM')))
check('a single-elimination Tournament has no group stage',
  ids(stagesFor('tournament', 'SINGLE_ELIM')) === 'setup → entrants → playoffs → complete',
  ids(stagesFor('tournament', 'SINGLE_ELIM')))
check('nor does a double-elimination one',
  ids(stagesFor('tournament', 'DOUBLE_ELIM')) === 'setup → entrants → playoffs → complete')
check('Groups + Playoffs has both',
  ids(stagesFor('tournament', 'GROUPS_PLAYOFFS')) === 'setup → entrants → groups → playoffs → complete')
check('Swiss has rounds and no bracket at all',
  ids(stagesFor('tournament', 'SWISS')) === 'setup → entrants → swiss → complete',
  ids(stagesFor('tournament', 'SWISS')))
check('an unknown format falls back to the commonest shape',
  ids(stagesFor('tournament', 'NONSENSE')) === 'setup → entrants → playoffs → complete')

section('A lifecycle state resolves to exactly one stage')
const seasonStates: [string, string][] = [
  ['REGISTRATION_SCHEDULED', 'entrants'],
  ['REGISTRATION_OPEN', 'entrants'],
  ['REGISTRATION_CLOSED', 'groups'],
  ['GROUP_SETUP', 'groups'],
  ['GROUP_STAGE_LIVE', 'groups'],
  ['GROUPS_CLOSED', 'groups'],
  ['PLAYOFF_SETUP', 'playoffs'],
  ['PLAYOFFS_LIVE', 'playoffs'],
  ['COMPLETED', 'complete'],
]
for (const [state, want] of seasonStates) {
  check(`Season ${state} → ${want}`, currentStage('season', state) === want, currentStage('season', state))
}
const tournamentStates: [string, string, string][] = [
  ['DRAFT', 'SINGLE_ELIM', 'setup'],
  ['REGISTRATION_OPEN', 'SINGLE_ELIM', 'entrants'],
  ['REGISTRATION_CLOSED', 'SINGLE_ELIM', 'entrants'],
  ['GROUPS_IN_PROGRESS', 'GROUPS_PLAYOFFS', 'groups'],
  ['BRACKET_GENERATED', 'SINGLE_ELIM', 'playoffs'],
  ['IN_PROGRESS', 'SINGLE_ELIM', 'playoffs'],
  ['IN_PROGRESS', 'SWISS', 'swiss'],
  ['COMPLETED', 'SINGLE_ELIM', 'complete'],
]
for (const [state, fmt, want] of tournamentStates) {
  check(`Tournament ${state} (${fmt}) → ${want}`,
    currentStage('tournament', state, fmt) === want, currentStage('tournament', state, fmt))
}
check('an unrecognised state still resolves somewhere openable',
  currentStage('season', 'SOMETHING_NEW') === 'setup')

section('Past stages stay reachable; future ones are locked')
{
  const w = workflowFor('season', 42, 'PLAYOFF_SETUP')
  const by = Object.fromEntries(w.map((s) => [s.id, s.status]))
  check('setup is done', by.setup === 'done')
  check('entrants is done', by.entrants === 'done')
  check('groups is done', by.groups === 'done')
  check('playoffs is current', by.playoffs === 'current')
  check('complete is locked', by.complete === 'locked')
  check('every reachable stage has a real href',
    w.filter((s) => s.status !== 'locked').every((s) => s.href.startsWith('/creator/seasons/42/')))
  check('correcting an earlier stage is allowed', stageReachable('season', 'PLAYOFF_SETUP', 'groups'))
  check('...but a later one is not', !stageReachable('season', 'PLAYOFF_SETUP', 'complete'))
}

section('A completed record sits on Complete, with everything behind it reachable')
{
  const w = workflowFor('season', 7, 'COMPLETED')
  const by = Object.fromEntries(w.map((s) => [s.id, s.status]))
  check('complete is the current stage', by.complete === 'current')
  check('nothing is left locked', w.every((s) => s.status !== 'locked'))
  check('earlier stages are reachable for correction',
    ['setup', 'entrants', 'groups', 'playoffs'].every((s) => stageReachable('season', 'COMPLETED', s as never)))
}

section('A Swiss Tournament never offers a playoff stage')
{
  const w = workflowFor('tournament', 3, 'IN_PROGRESS', 'SWISS')
  check('there is no playoffs stage to reach', !w.some((s) => s.id === 'playoffs'))
  check('the Swiss stage is where it is', w.find((s) => s.id === 'swiss')?.status === 'current')
  check('...and asking for playoffs is refused', !stageReachable('tournament', 'IN_PROGRESS', 'playoffs', 'SWISS'))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exitCode = 1
