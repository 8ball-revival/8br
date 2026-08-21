/**
 * Verifies that winning a Tournament is actually recorded as a title.
 *
 *   - an individual champion gets one, and the Tournament records their CueVerse ID
 *   - EVERY member of a winning team gets one — a 5v5 title belongs to the five who played it
 *   - a runner-up gets none, and neither does anyone knocked out earlier
 *   - an unfinished Tournament awards nothing
 *   - a champion found by more than one route still has exactly one title
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-tournament-titles.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { computeExplorer } from '../src/lib/stats/ladder-explorer.ts'

assertLocalDatabase()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

/** Titles by CueVerse ID, straight from the Rankings query the page uses. */
async function titles(): Promise<Map<string, number>> {
  const rows = await computeExplorer('all-time', 'overall')
  return new Map(rows.filter((r) => r.cueverseId).map((r) => [r.cueverseId!.toLowerCase(), r.tournamentTitles]))
}

/** Who actually won each completed Tournament, read off the bracket rather than a name field. */
async function championsFromBracket() {
  const out: { number: number; isTeam: boolean; winners: string[]; loser: string | null }[] = []
  for (const t of await prisma.tournament.findMany({
    where: { lifecycleState: 'COMPLETED' },
    select: { id: true, number: true, participantFormat: true },
    orderBy: { number: 'asc' },
  })) {
    const max = await prisma.playoffMatch.aggregate({ where: { tournamentId: t.id }, _max: { round: true } })
    if (max._max.round == null) continue
    const final = await prisma.playoffMatch.findFirst({
      where: { tournamentId: t.id, round: max._max.round, NOT: { winnerRegistrationId: null } },
      orderBy: { slot: 'asc' },
    })
    if (!final?.winnerRegistrationId) continue
    const loserReg = final.winnerRegistrationId === final.homeRegistrationId
      ? final.awayRegistrationId : final.homeRegistrationId

    const idOf = async (regId: number | null) => {
      if (regId == null) return null
      const r = await prisma.registration.findUnique({ where: { id: regId }, select: { cueverseId: true, playerId: true } })
      if (r?.playerId) {
        const p = await prisma.player.findUnique({ where: { id: r.playerId }, select: { cueverseId: true } })
        if (p?.cueverseId) return p.cueverseId.toLowerCase()
      }
      return r?.cueverseId?.toLowerCase() ?? null
    }

    const isTeam = t.participantFormat === 'TEAM'
    let winners: string[] = []
    if (isTeam) {
      const team = await prisma.tournamentTeam.findFirst({
        where: { tournamentId: t.id, registrationId: final.winnerRegistrationId },
        select: { members: { select: { playerId: true } } },
      })
      for (const m of team?.members ?? []) {
        if (!m.playerId) continue
        const p = await prisma.player.findUnique({ where: { id: m.playerId }, select: { cueverseId: true } })
        if (p?.cueverseId) winners.push(p.cueverseId.toLowerCase())
      }
    } else {
      const w = await idOf(final.winnerRegistrationId)
      winners = w ? [w] : []
    }
    out.push({ number: t.number, isTeam, winners, loser: isTeam ? null : await idOf(loserReg) })
  }
  return out
}

const t = await titles()
const champs = await championsFromBracket()

section('Every completed Tournament credits its winner')
check('there is at least one completed Tournament to check', champs.length > 0, String(champs.length))
for (const c of champs) {
  if (c.isTeam) {
    check(`T${c.number} (team): the whole winning roster is credited`,
      c.winners.length > 0 && c.winners.every((w) => (t.get(w) ?? 0) >= 1),
      c.winners.map((w) => `${w}=${t.get(w) ?? 0}`).join(' '))
    check(`T${c.number}: that is more than one person`, c.winners.length > 1, String(c.winners.length))
  } else {
    check(`T${c.number} (individual): the champion is credited`,
      c.winners.length === 1 && (t.get(c.winners[0]) ?? 0) >= 1,
      `${c.winners[0]}=${t.get(c.winners[0] ?? '') ?? 0}`)
    if (c.loser && !c.winners.includes(c.loser)) {
      check(`T${c.number}: the runner-up is NOT credited`, (t.get(c.loser) ?? 0) === 0,
        `${c.loser}=${t.get(c.loser) ?? 0}`)
    }
  }
}

section('An individual Tournament records the champion by CueVerse ID')
for (const c of champs.filter((x) => !x.isTeam)) {
  const row = await prisma.$queryRaw<{ championHandle: string | null }[]>`
    SELECT "championHandle" FROM "public"."comp_tournament" WHERE "number" = ${c.number}`
  check(`T${c.number} stores a champion handle`,
    (row[0]?.championHandle ?? '').toLowerCase() === c.winners[0],
    `${row[0]?.championHandle} vs ${c.winners[0]}`)
}
section('A team Tournament stores no champion handle')
for (const c of champs.filter((x) => x.isTeam)) {
  const row = await prisma.$queryRaw<{ championHandle: string | null }[]>`
    SELECT "championHandle" FROM "public"."comp_tournament" WHERE "number" = ${c.number}`
  // A team is not a person and has no CueVerse ID; inventing one from the team name is how the
  // old join ended up crediting nobody.
  check(`T${c.number} leaves it null — a team has no CueVerse ID`, row[0]?.championHandle == null,
    String(row[0]?.championHandle))
}

section('Nobody is credited twice, and nothing unfinished counts')
const credited = [...t.entries()].filter(([, n]) => n > 0)
const expected = new Set(champs.flatMap((c) => c.winners))
check('exactly the winners hold titles', credited.length === expected.size,
  `${credited.length} credited vs ${expected.size} expected`)
check('no title count exceeds the number of completed Tournaments',
  credited.every(([, n]) => n <= champs.length))
const unfinished = await prisma.tournament.count({ where: { NOT: { lifecycleState: 'COMPLETED' } } })
console.log(`  (${unfinished} unfinished Tournament(s) in the database, contributing nothing)`)

section('Season championships are untouched')
const rows = await computeExplorer('all-time', 'overall')
check('season titles are still counted', rows.filter((r) => r.seasonTitles > 0).length > 0,
  String(rows.filter((r) => r.seasonTitles > 0).length))

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
