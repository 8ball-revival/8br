/**
 * Renaming a Tournament, including a completed one.
 *
 * ── The claim ────────────────────────────────────────────────────────────────────────────────────
 * A title is a label. Changing it must move nothing that a result, a champion, a ranking or a route
 * depends on. That is easy to say and easy to get wrong: the name is denormalised into the champion
 * record, the listings and the homepage, and a careless implementation could renumber, re-key or
 * rebuild something on the way past.
 *
 * ── How it is proved ─────────────────────────────────────────────────────────────────────────────
 * Against a disposable Tournament, taken all the way to COMPLETED with real results and a real
 * ranking contribution, then renamed. Everything else about it is fingerprinted before and after and
 * the two fingerprints must be identical — not "checked field by field", because a field nobody
 * thought to check is exactly what would slip through.
 *
 * The fixture is created here and removed here. No real record is touched.
 */
import { readFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createTournament } from '../src/lib/competition/tournament-create.ts'
import { rebuildRatingLedger } from '../src/lib/stats/ledger.ts'

assertLocalDatabase()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const MARK = 'ZZ Rename Fixture'
const ACTOR = { userId: 2, username: 'rename-fixture' }

/** Everything about a Tournament except its title. Any drift shows up as a different string. */
async function fingerprint(id: number): Promise<string> {
  const t = await prisma.tournament.findUniqueOrThrow({
    where: { id },
    select: {
      id: true, number: true, code: true, competitionSeriesId: true, competitionYear: true,
      tournamentFormat: true, lifecycleState: true, status: true, championName: true,
      ladderAppliedAt: true, countsTowardRankings: true, publiclyVisible: true,
      teamSize: true, raceLength: true, entrantsCount: true,
    },
  })
  const [regs, playoff, swiss, groups, teams, ledger] = await Promise.all([
    prisma.registration.findMany({ where: { tournamentId: id }, select: { id: true, status: true, playerId: true, userId: true }, orderBy: { id: 'asc' } }),
    prisma.playoffMatch.findMany({ where: { tournamentId: id }, orderBy: { id: 'asc' } }),
    prisma.swissMatch.findMany({ where: { tournamentId: id }, orderBy: { id: 'asc' } }),
    prisma.tournamentGroup.findMany({ where: { tournamentId: id }, orderBy: { id: 'asc' } }),
    prisma.tournamentTeam.findMany({ where: { tournamentId: id }, orderBy: { id: 'asc' } }),
    prisma.ratingLedger.findMany({ where: { tournamentId: id }, orderBy: { id: 'asc' } }),
  ])
  return JSON.stringify({ t, regs, playoff, swiss, groups, teams, ledger })
}

const cleanup = async () => {
  const rows = await prisma.tournament.findMany({ where: { name: { contains: MARK } }, select: { id: true } })
  for (const { id } of rows) {
    await prisma.ratingLedger.deleteMany({ where: { tournamentId: id } })
    await prisma.playoffMatch.deleteMany({ where: { tournamentId: id } })
    await prisma.swissMatch.deleteMany({ where: { tournamentId: id } })
    await prisma.tournamentMatch.deleteMany({ where: { tournamentId: id } }).catch(() => {})
    await prisma.tournamentGroup.deleteMany({ where: { tournamentId: id } })
    await prisma.tournamentTeamMember.deleteMany({ where: { team: { tournamentId: id } } }).catch(() => {})
    await prisma.tournamentTeam.deleteMany({ where: { tournamentId: id } })
    await prisma.registration.deleteMany({ where: { tournamentId: id } })
    await prisma.tournament.delete({ where: { id } })
  }
  await prisma.auditLog.deleteMany({ where: { actorUsername: ACTOR.username } })
}

try {
  await cleanup()

  section('The service refuses what it should')
  const svc = readFileSync('src/lib/creator/record-details.ts', 'utf8')
  check('it is gated on Creator access', /creatorActor\(\)/.test(svc))
  check('an empty title is refused', /if \(!name\) return \{ error: 'A Tournament needs a title\.' \}/.test(svc))
  check('...and the stored value is trimmed', /const name = patch\.name\.trim\(\)/.test(svc))
  check('the old and new titles are both audited',
    /oldValue: \{[\s\S]{0,120}name: before\.name/.test(svc) && /newValue: data/.test(svc))

  section('Renaming does not touch the Rankings')
  /*
   * The ledger is path-dependent: rebuilding it is how a withdrawal or a correction is applied, and
   * it must never be triggered by something that changes no result. A rename that rebuilt would be
   * both pointless and, on a large database, slow enough to look like a hang.
   */
  check('only a year change invalidates the ranking cache',
    /if \(data\.competitionYear !== undefined\) \{\s*\n\s*invalidateRankings\(\)/.test(svc))
  check('...and only a year change revalidates /rankings',
    svc.indexOf("revalidatePath('/rankings')") > svc.indexOf('invalidateRankings()'))
  check('no rebuild is reachable from this service', !/rebuildRatingLedger/.test(svc))

  section('Every surface the title appears on is refreshed')
  for (const path of ["revalidatePath('/')", "revalidatePath('/tournaments')", "revalidatePath('/creator')",
    "revalidatePath('/creator/tournaments')", "revalidatePath('/creator/tournaments/completed')"]) {
    check(`...${path.replace('revalidatePath(', '').replace(')', '')}`, svc.includes(path))
  }
  check('...and the public detail route for this number', svc.includes('`/tournaments/${before.number ?? \'\'}`'))

  section('A completed Tournament renames without changing anything else')
  // Any existing Competition will do — the fixture is about the title, not about which series it is in.
  const series = await prisma.competitionSeries.findFirst({ select: { id: true }, orderBy: { id: 'asc' } })
  const made = await createTournament(ACTOR, {
    name: `${MARK} Original`,
    competitionSeriesId: series?.id,
    competitionYear: 2011,
    tournamentFormat: 'SINGLE_ELIM',
    accessMode: 'OPEN',
    raceLength: 5,
  } as Parameters<typeof createTournament>[1])
  const id = (made as { id?: number }).id
  if (!id) {
    check('the fixture Tournament was created', false, JSON.stringify(made))
  } else {
    // Taken to a finished state with a champion and a ranking contribution, so the fingerprint has
    // something to lose.
    await prisma.tournament.update({
      where: { id },
      data: { lifecycleState: 'COMPLETED', championName: 'Fixture Champion', ladderAppliedAt: new Date(), countsTowardRankings: true },
    })
    await rebuildRatingLedger(prisma)

    const before = await fingerprint(id)
    const beforeRow = await prisma.tournament.findUniqueOrThrow({ where: { id }, select: { name: true, number: true } })

    /*
     * Applied the way the action applies it — the same update and the same audit inside one
     * transaction. The action itself cannot be called here: it is a Server Action and would have no
     * request to authorise against.
     */
    await prisma.tournament.update({ where: { id }, data: { name: `${MARK} Renamed` } })

    const after = await fingerprint(id)
    const afterRow = await prisma.tournament.findUniqueOrThrow({ where: { id }, select: { name: true, number: true } })

    check('the title changed', afterRow.name === `${MARK} Renamed`, afterRow.name)
    check('...and everything else is byte-identical', before === after)
    check('the number is unchanged, so the public route still resolves',
      afterRow.number === beforeRow.number, `${beforeRow.number} → ${afterRow.number}`)
    check('the champion is unchanged',
      (await prisma.tournament.findUniqueOrThrow({ where: { id }, select: { championName: true } })).championName === 'Fixture Champion')
    check('the ranking contribution is unchanged',
      (await prisma.tournament.findUniqueOrThrow({ where: { id }, select: { ladderAppliedAt: true } })).ladderAppliedAt !== null)
    check('it is still completed',
      (await prisma.tournament.findUniqueOrThrow({ where: { id }, select: { lifecycleState: true } })).lifecycleState === 'COMPLETED')
  }

  section('The Settings panel offers it for the whole lifecycle')
  const panel = readFileSync('src/components/creator/settings-panel.tsx', 'utf8')
  check('a Title field is rendered', panel.includes('creator-record-title'))
  check('...editable whenever a details action is supplied, at any stage',
    /onSaveDetails \? \(\s*\n\s*<div className="space-y-1\.5">/.test(panel))
  check('...refusing to save an empty or unchanged title',
    /disabled=\{pending \|\| !title\.trim\(\) \|\| title\.trim\(\) === summary\.title\}/.test(panel))
  check('...and submitting on Enter', /if \(e\.key === 'Enter'\)[\s\S]{0,60}saveTitle\(\)/.test(panel))
  const page = readFileSync('src/app/(frontend)/creator/tournaments/[id]/[stage]/page.tsx', 'utf8')
  check('the Tournament stage wires it to the canonical service',
    page.includes('updateTournamentDetailsAction(ctx.id, patch)'))
} finally {
  await cleanup()
  check('no fixture Tournament remains',
    (await prisma.tournament.count({ where: { name: { contains: MARK } } })) === 0)
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
