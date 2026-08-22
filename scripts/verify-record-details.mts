/**
 * Correcting a Tournament's Competition Year.
 *
 * ── The gap this closes ──────────────────────────────────────────────────────────────────────────
 * The create form defaults the year to the current one. That is right for a Tournament being played
 * now and wrong for one being reconstructed from the archive, and until this service existed there
 * was no way to fix it afterwards — a 2006 event stayed filed under the year somebody happened to
 * create the record. The year is not decoration: it decides which era the record belongs to in the
 * listings and in the Rankings' To-year bound.
 *
 * ── What is checked ──────────────────────────────────────────────────────────────────────────────
 * The service is a Server Action, so it cannot be called from here — it would have no request to
 * authorise against. What this suite proves is the part that has no UI in front of it: the range,
 * the audit trail, the cache invalidation, the authorisation gate and the wiring, all read from the
 * source rather than assumed. The behaviour under a real session is covered by
 * verify-creator-authenticated.
 *
 * Read-only: no fixture is created and no record is modified.
 */
import { readFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'

assertLocalDatabase()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)
const read = (p: string) => readFileSync(p, 'utf8')

try {
  const svc = read('src/lib/creator/record-details.ts')

  section('The service refuses before it writes')
  check('it is a Server Action', svc.startsWith("'use server'"))
  check('...gated by the Creator check, not by the caller', /creatorActor\(\)/.test(svc))
  check('...returning the gate error rather than proceeding', /if \(!gate\.ok\) return \{ error: gate\.error \}/.test(svc))
  check('...and refusing a Tournament that no longer exists', /no longer exists/.test(svc))

  section('The year is bounded')
  check('a floor and ceiling are stated once', /YEAR_MIN = 1900/.test(svc) && /YEAR_MAX = 2100/.test(svc))
  check('...and enforced on the parsed integer', /Math\.trunc/.test(svc) && /y < YEAR_MIN \|\| y > YEAR_MAX/.test(svc))
  check('a dangling Competition is rejected by name', /does not exist/.test(svc) && /competitionSeries\.findUnique/.test(svc))
  check('an empty title is refused', /needs a title/.test(svc))
  check('nothing to change writes nothing', /Object\.keys\(data\)\.length === 0/.test(svc))

  section('A correction leaves a trail and clears what it invalidates')
  check('the update and the audit share one transaction', /\$transaction\(async \(tx\) => \{[\s\S]*recordAudit[\s\S]*\}\)/.test(svc))
  check('...recording the value it replaced', /oldValue: \{[\s\S]*competitionYear: before\.competitionYear/.test(svc))
  /*
   * A block now, not a one-liner: the year owns both the cache invalidation and the /rankings
   * revalidation, and a rename must trigger neither. Renaming changes a label, and the ledger is
   * path-dependent — rebuilding it for a typo would be pointless and slow.
   */
  check('moving the year clears the Rankings cache',
    svc.includes('if (data.competitionYear !== undefined) {') && svc.includes('invalidateRankings()'))
  check('...and nothing else invalidates them',
    (svc.match(/invalidateRankings\(\)/g) ?? []).length === 1)
  check('...because the era filter is cached', /revalidatePath\('\/rankings'\)/.test(svc))

  section('It is reachable')
  const panel = read('src/components/creator/settings-panel.tsx')
  const page = read('src/app/(frontend)/creator/tournaments/[id]/[stage]/page.tsx')
  check('the Settings panel accepts a details action', /onSaveDetails\?:/.test(panel))
  check('...makes the year editable only when one is given', /onSaveDetails \? \(/.test(panel))
  check('...and validates the range before the round trip', /n < 1900 \|\| n > 2100/.test(panel))
  check('the Tournament stage passes it', /onSaveDetails=\{async \(patch\) => \{/.test(page))
  check('...calling this service', /updateTournamentDetailsAction\(ctx\.id, patch\)/.test(page))

  section('Every Tournament year is inside the range it enforces')
  /*
   * Not a style check: a stored year outside the bound would mean the range was added after data
   * already violated it, and the first correction of such a record would fail on an unrelated field.
   */
  const rows = await prisma.tournament.findMany({ select: { id: true, name: true, competitionYear: true } })
  const outside = rows.filter((r) => r.competitionYear < 1900 || r.competitionYear > 2100)
  check(`all ${rows.length} Tournament years are between 1900 and 2100`, outside.length === 0,
    outside.map((r) => `${r.name}=${r.competitionYear}`).join(', '))
} finally {
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
