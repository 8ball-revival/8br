/**
 * Permanent Season deletion — that the control exists, and that every gate on it is real.
 *
 * ── Why this suite exists ────────────────────────────────────────────────────────────────────────
 * The Creator's Danger Zone described permanent deletion for months and contained no control of any
 * kind. The working button lived in a Season settings form that no route rendered, so the feature
 * was documented exactly where an operator would look for it and available nowhere. Nothing failed,
 * because nothing was checked: a paragraph and a button look identical to a test that only asks
 * whether the section is present.
 *
 * So these assertions are about REACHABILITY as much as correctness. A description is not a feature.
 */
import { readFileSync, readdirSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const PANEL = readFileSync('src/components/creator/settings-panel.tsx', 'utf8')
const ZONE = readFileSync('src/components/creator/danger-zone.tsx', 'utf8')
const ACTIONS = readFileSync('src/lib/seasons/actions.ts', 'utf8')
const ADMIN = readFileSync('src/lib/seasons/admin.ts', 'utf8')
const STAGE = readFileSync('src/lib/creator/season-stage.ts', 'utf8')

const SEASON_PAGES = ['setup', 'entrants', 'groups', 'playoffs']
  .map((s) => `src/app/(frontend)/creator/seasons/[id]/${s}/page.tsx`)

section('The control is actually reachable')
{
  check('the Danger Zone renders a delete component, not only prose',
    PANEL.includes('<SeasonDangerZone'))
  check('...with a button a person can press', /Permanently Delete Season/.test(ZONE))

  /*
   * Every Season stage, not just the one somebody happened to test. The panel is rendered on four
   * routes; wiring three of them is a control that exists on Tuesdays.
   */
  for (const page of SEASON_PAGES) {
    const src = readFileSync(page, 'utf8')
    const stage = page.split('/').at(-2)
    check(`the ${stage} stage passes the plan and the action`,
      src.includes('deletionPlan={ctx.deletionPlan}') && src.includes('deleteSeasonAction(ctx.id, input)'))
  }

  /*
   * And there is only ONE of them. The orphaned copy in the Season settings form was a second delete
   * UI that nobody could reach and everybody had to maintain.
   */
  const settingsForm = readFileSync('src/components/seasons/season-settings-form.tsx', 'utf8')
  check('the orphaned second delete UI is gone', !settingsForm.includes('deleteSeasonAction'))
}

section('The two confirmations are independent, and both are checked on the server')
{
  check('the panel asks for the title', /confirmTitle/.test(ZONE) && /to confirm/.test(ZONE))
  check('...and for the current password', /type="password"/.test(ZONE))
  check('...and keeps the button disabled until both are satisfied',
    /disabled=\{!ready \|\| pending\}/.test(ZONE) && /const ready = titleMatches && password\.length > 0/.test(ZONE))
  check('...saying which one is missing, so a stuck button is never a mystery',
    /Title must match exactly/.test(ZONE) && /Enter your password/.test(ZONE))

  /*
   * The load-bearing half. A disabled button stops nobody who can post a request, so the action
   * re-checks both — and the title check must come BEFORE the password is verified, or a wrong-record
   * deletion is prevented only by the operator's own care.
   */
  check('the action verifies the typed title', /input\.confirmTitle\.trim\(\)\.toLowerCase\(\)/.test(ACTIONS))
  check('...and re-authenticates the password', /verifyCurrentUserPassword\(input\.password\)/.test(ACTIONS))
  const titleAt = ACTIONS.indexOf('confirmTitle.trim()')
  const pwAt = ACTIONS.indexOf('verifyCurrentUserPassword')
  check('...refusing a mismatched title before it asks for anything else', titleAt > 0 && titleAt < pwAt)

  /*
   * One expression produces the title the panel SHOWS and the title the server COMPARES. Two would
   * drift, and the symptom is a confirmation nobody can pass: the operator types exactly what is on
   * screen and the button stays dead with no way to discover why.
   */
  check('both sides derive the title from one helper',
    ADMIN.includes('export function seasonDisplayTitle') && ACTIONS.includes('planSeasonDeletion'))
}

section('Who may do it')
{
  check('the panel offers it to the Owner or the Head Administrator',
    /gate\.can\('delete_competition'\) \|\| gate\.isHeadAdmin/.test(STAGE))
  check('...and the action enforces the same rule rather than trusting the page',
    /!actor\.can\('delete_competition'\) && !actor\.isHeadAdmin/.test(ACTIONS))
  check('...on top of the Creator capability the action already required',
    /requireCapability\('manage_competitions'\)/.test(ACTIONS))
  check('a completed Season stays Head-Admin only in the service',
    /wasCompleted && !isHeadAdmin/.test(ADMIN))
}

section('What it removes, and what it puts right afterwards')
{
  check('the plan counts entrants, groups, matches, playoffs, standings and the ledger',
    ['seasonEntrant.count', 'seasonGroup.count', 'seasonGroupPlayer.count', 'seasonMatch.count',
     'seasonPlayoffMatch.count', 'seasonStanding.count', 'ratingLedger.count']
      .every((c) => ADMIN.includes(c)))
  check('...and names the Champion whose title is being withdrawn', ADMIN.includes('champion:'))
  check('the panel shows those counts rather than describing them',
    /This will permanently remove/.test(ZONE) && /plan\.counts\.entrants/.test(ZONE))

  /*
   * A Season Championship is DERIVED from `championPlayerId`, so deleting the row removes the title
   * from the data immediately. Only a stale cache would still be claiming it — which is why
   * achievements are invalidated alongside rankings rather than instead of them.
   */
  check('rankings are invalidated', ACTIONS.includes('invalidateRankings()'))
  check('...and achievements, because a title is derived from the Season row',
    ACTIONS.includes('invalidateAchievements()'))
  for (const path of ['/seasons', '/rankings', '/achievements', '/creator', '/']) {
    check(`...and ${path} is revalidated`, ACTIONS.includes(`revalidatePath('${path}')`))
  }
  check('a completed Season replays the rating ledger without itself',
    /wasCompleted[\s\S]{0,200}rebuildRatingLedger/.test(ADMIN))
}

section('It is written down')
{
  check('the deletion is audited', /recordAudit\([\s\S]{0,120}'season\.delete'/.test(ADMIN))
  check('...before the row is deleted, so the record survives it',
    ADMIN.indexOf("'season.delete'") < ADMIN.indexOf('tx.season.delete'))
  check('the wording states plainly that it cannot be undone', /cannot be undone/i.test(ZONE))
}

section('The Tournament path is untouched')
{
  const workspace = readFileSync('src/components/tournaments/tournament-workspace.tsx', 'utf8')
  check('the Tournament workspace still owns its own deletion',
    workspace.includes('deleteTournamentAction') && /Delete Tournament permanently/.test(workspace))
  check('...and the panel points a Tournament at it rather than drawing a button it cannot use',
    /For a Tournament it is in the\s*\n?\s*\* ?.*workspace|workspace on the Bracket stage/.test(PANEL))
}

/* Nothing here touches a database: every assertion is about the code that would. */
void readdirSync

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
