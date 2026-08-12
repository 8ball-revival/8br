import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getCups, type Cup, type BracketRound } from '@/lib/cups/fixtures'
import { cupsFromCompRows, type CompRow } from '@/lib/cups/adapter'

type DbClient = typeof prisma | Prisma.TransactionClient

/**
 * Regenerate the versioned canonical Cup snapshot (comp_cup_snapshot) from the DB —
 * the derived-data revision every consumer resolves. MUST be called inside the same
 * transaction as a Cup mutation so a failed mutation rolls this back too (no partial
 * state, prior revision preserved). Returns the new revision.
 */
export async function regenerateCupSnapshot(client: DbClient = prisma): Promise<number> {
  const comps = await client.tournament.findMany({
    where: { competitionType: 'CUP' },
    orderBy: { cupNumber: 'asc' },
    include: { cupBracketMatches: true, cupTeamTies: { include: { matches: true } } },
  })
  const cups = cupsFromCompRows(comps as unknown as CompRow[])
  const prev = await client.cupSnapshot.findUnique({ where: { id: 1 } })
  const revision = (prev?.revision ?? 0) + 1
  await client.cupSnapshot.upsert({
    where: { id: 1 },
    update: { revision, payload: cups as unknown as Prisma.InputJsonValue },
    create: { id: 1, revision, payload: cups as unknown as Prisma.InputJsonValue },
  })
  return revision
}

/**
 * Cup migration + verification (staged cutover). This module:
 *  - importCupsFromFixtures(): idempotently mirrors the fixture cups into the unified
 *    competition tables (comp_season type=CUP + cup bracket/tie tables), losslessly.
 *  - getCupsFromDb(): reconstructs the exact `Cup[]` shape from the DB.
 *  - compareCupsFixturesVsDb(): machine-readable byte-for-byte diff of fixtures vs the
 *    DB round-trip. Cutover is gated on this being identical — the fixtures remain the
 *    live source until then (nothing here switches reads).
 */

const codeFor = (n: number) => `C${String(n).padStart(3, '0')}`

function deriveTournamentFormat(c: Cup): 'SINGLE_ELIM' | 'DOUBLE_ELIM' | 'TEAM_KNOCKOUT' {
  if (c.teamTies) return 'TEAM_KNOCKOUT'
  if (c.winnersBracket || c.format === 'D/E') return 'DOUBLE_ELIM'
  return 'SINGLE_ELIM'
}
function deriveTeamSize(c: Cup): number | null {
  if (!c.teamTies) return null
  return c.format === '5v5' ? 5 : 2
}

export interface ImportResult { imported: number; codes: string[] }

export async function importCupsFromFixtures(): Promise<ImportResult> {
  const cups = getCups()
  const codes: string[] = []
  for (const c of cups) {
    const slug = `cup-${c.number}`
    const code = codeFor(c.number)
    const completed = c.status === 'completed'
    const fields = {
      name: c.name,
      competitionType: 'CUP' as const,
      competitionCode: code,
      cupNumber: c.number,
      cupFormatBadge: c.format,
      cupYear: c.year ?? null,
      cupDate: c.date ?? null,
      cupStatus: c.status,
      entrantsCount: c.entrants ?? null,
      currentRound: c.currentRound ?? null,
      finalScore: c.finalScore ?? null,
      championName: c.champion?.name ?? null,
      championHandle: c.champion?.handle ?? null,
      runnerUpName: c.runnerUp?.name ?? null,
      runnerUpHandle: c.runnerUp?.handle ?? null,
      thirdPlaceName: c.thirdPlace?.name ?? null,
      thirdPlaceHandle: c.thirdPlace?.handle ?? null,
      participantFormat: (c.teamTies ? 'TEAM' : 'INDIVIDUAL') as 'TEAM' | 'INDIVIDUAL',
      teamSize: deriveTeamSize(c),
      tournamentFormat: deriveTournamentFormat(c),
      importedFromFixture: true,
      locked: completed,
      seasonStatus: (completed ? 'COMPLETED' : 'ACTIVE') as 'COMPLETED' | 'ACTIVE',
    }
    const comp = await prisma.tournament.upsert({
      where: { slug },
      update: fields,
      create: { slug, ...fields, ...(completed ? { archivedAt: new Date('2000-01-01T00:00:00Z') } : {}) },
    })

    // Idempotent: clear + re-create child structures.
    await prisma.tournamentBracketMatch.deleteMany({ where: { competitionId: comp.id } })
    await prisma.cupTeamTie.deleteMany({ where: { competitionId: comp.id } }) // cascades tie matches

    const importRounds = async (rounds: BracketRound[] | undefined, kind: 'MAIN' | 'WINNERS' | 'LOSERS' | 'GRAND_FINAL') => {
      if (!rounds) return
      for (let ri = 0; ri < rounds.length; ri++) {
        const rd = rounds[ri]
        for (let mi = 0; mi < rd.matches.length; mi++) {
          const m = rd.matches[mi]
          const a = m.a, b = m.b
          await prisma.tournamentBracketMatch.create({
            data: {
              competitionId: comp.id, bracketKind: kind, roundName: rd.name, roundOrder: ri, matchOrder: mi,
              aPresent: a !== undefined, aName: a?.name ?? null, aHandle: a?.handle ?? null, aSeed: a?.seed ?? null, aScore: a?.score ?? null,
              bPresent: b !== undefined, bName: b?.name ?? null, bHandle: b?.handle ?? null, bSeed: b?.seed ?? null, bScore: b?.score ?? null,
              winner: m.winner ?? null, note: m.note ?? null,
            },
          })
        }
      }
    }
    await importRounds(c.bracket, 'MAIN')
    await importRounds(c.winnersBracket, 'WINNERS')
    await importRounds(c.losersBracket, 'LOSERS')
    await importRounds(c.grandFinal, 'GRAND_FINAL')

    if (c.teamTies) {
      for (let ti = 0; ti < c.teamTies.length; ti++) {
        const tie = c.teamTies[ti]
        await prisma.cupTeamTie.create({
          data: {
            competitionId: comp.id, round: tie.round, roundOrder: ti, homeTeam: tie.home, awayTeam: tie.away,
            homeWins: tie.homeWins, awayWins: tie.awayWins, winner: tie.winner,
            matches: {
              create: tie.matches.map((tm, mi) => ({
                matchOrder: mi,
                homeName: tm.home.name, homeHandle: tm.home.handle ?? null, homeCaptain: tm.home.captain ?? false,
                awayName: tm.away.name, awayHandle: tm.away.handle ?? null, awayCaptain: tm.away.captain ?? false,
                homeScore: tm.homeScore ?? null, awayScore: tm.awayScore ?? null, note: tm.note ?? null,
              })),
            },
          },
        })
      }
    }
    codes.push(code)
  }
  return { imported: cups.length, codes }
}

// --- DB → fixture-shape adapter (exact reconstruction) ---------------------
// The reconstruction itself lives in ./adapter (pure, standalone-runnable). This
// wrapper just supplies the DB rows.

export async function getCupsFromDb(): Promise<Cup[]> {
  const comps = await prisma.tournament.findMany({
    where: { competitionType: 'CUP' },
    orderBy: { cupNumber: 'asc' },
    include: { cupBracketMatches: true, cupTeamTies: { include: { matches: true } } },
  })
  return cupsFromCompRows(comps as unknown as CompRow[])
}

// --- Comparison (cutover gate) ---------------------------------------------

function canon(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canon)
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(o).sort()) if (o[k] !== undefined) out[k] = canon(o[k])
    return out
  }
  return x
}

function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  const sa = JSON.stringify(canon(a)), sb = JSON.stringify(canon(b))
  if (sa === sb) return null
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
    for (const k of keys) {
      const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`)
      if (d) return d
    }
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} vs ${b.length}`
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${path}[${i}]`); if (d) return d }
  }
  return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`
}

export interface CupComparison {
  identical: boolean
  fixtureCount: number
  dbCount: number
  cups: { number: number; name: string; identical: boolean; diff?: string }[]
  missingInDb: number[]
  extraInDb: number[]
}

export async function compareCupsFixturesVsDb(): Promise<CupComparison> {
  const fx = getCups()
  const db = await getCupsFromDb()
  const dbByNum = new Map(db.map((c) => [c.number, c]))
  const fxNums = new Set(fx.map((c) => c.number))
  const cups: CupComparison['cups'] = []
  let identical = fx.length === db.length
  for (const f of fx) {
    const d = dbByNum.get(f.number)
    if (!d) { cups.push({ number: f.number, name: f.name, identical: false, diff: 'missing in DB' }); identical = false; continue }
    const same = JSON.stringify(canon(f)) === JSON.stringify(canon(d))
    cups.push({ number: f.number, name: f.name, identical: same, ...(same ? {} : { diff: firstDiff(f, d) ?? 'differs' }) })
    if (!same) identical = false
  }
  return {
    identical,
    fixtureCount: fx.length,
    dbCount: db.length,
    cups,
    missingInDb: fx.filter((c) => !dbByNum.has(c.number)).map((c) => c.number),
    extraInDb: db.filter((c) => !fxNums.has(c.number)).map((c) => c.number),
  }
}
