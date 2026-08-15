import 'server-only'
import type { Prisma } from '@prisma/client'
import { ELO_START, matchDeltas } from './elo'

/**
 * RATING LEDGER PROCESSING — turns completed tournament matches into per-match Elo events (the
 * `rating_ledger` table), the source of truth for the Rankings/Ladder.
 *
 * The public entry point is `rebuildRatingLedger(tx)`: a full, deterministic recompute. It is called
 * whenever a tournament is officially closed (so a normal close, a retry, and an authorized correction
 * all converge on the same correct state) and by the backfill script. Deleting + rebuilding from the
 * current completed-tournament data is inherently idempotent and makes corrections trivially correct —
 * every downstream rating is replayed in chronological close order. `(matchKey, playerId)` is unique so
 * duplicates are impossible even if two writers race.
 */

const COMPLETED_STATUSES = ['COMPLETED', 'FORFEIT', 'NO_SHOW'] as const
const FORFEIT_STATUSES = new Set(['FORFEIT', 'NO_SHOW'])
const FORFEIT_NOTE = /forfeit|walkover|no.?show|w\/o|w\.o\b/i

type Tx = Prisma.TransactionClient

interface Side {
  /** One entry per player on this side (a team has several; an individual has one). */
  players: { id: string; name: string }[]
  teamName: string | null
}
interface Matchup {
  matchKey: string
  stage: 'GROUP' | 'PLAYOFF' | 'SWISS'
  roundLabel: string
  completedAt: Date
  home: Side
  away: Side
  outcome: 'HOME' | 'AWAY' | 'DRAW'
  forfeit: boolean
  isTeam: boolean
}

/** Stable identity key for a completed-match participant: the linked Player.id, else a handle key. */
function keyOf(playerId: string | null | undefined, handle: string | null | undefined, name: string): { id: string; name: string } {
  if (playerId) return { id: playerId, name }
  const h = (handle ?? name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return { id: h ? `h:${h}` : `h:reg${name}`, name }
}

/** Resolve each registration in a tournament to its rating participant(s): one player, or a whole team. */
async function resolveSides(tx: Tx, tournamentId: number, isTeam: boolean): Promise<Map<number, Side>> {
  const map = new Map<number, Side>()
  if (isTeam) {
    const teams = await tx.tournamentTeam.findMany({ where: { tournamentId }, include: { members: { orderBy: { memberOrder: 'asc' } } } })
    for (const t of teams) {
      map.set(t.registrationId, {
        teamName: t.name,
        players: t.members.map((m) => keyOf(m.playerId, m.handle, m.name)),
      })
    }
  } else {
    const regs = await tx.registration.findMany({ where: { tournamentId }, select: { id: true, playerId: true, cueverseId: true, displayName: true, username: true } })
    for (const r of regs) {
      map.set(r.id, { teamName: null, players: [keyOf(r.playerId, r.cueverseId, r.displayName?.trim() || r.username)] })
    }
  }
  return map
}

/** Collect every rated matchup for one completed tournament, in deterministic order (group → playoff
 *  → Swiss; each ordered by round then slot/board). Byes are excluded entirely. */
async function collectMatchups(tx: Tx, tournamentId: number, isTeam: boolean, fallbackDate: Date): Promise<Matchup[]> {
  const sides = await resolveSides(tx, tournamentId, isTeam)
  const out: Matchup[] = []
  const side = (regId: number | null): Side | null => (regId != null ? sides.get(regId) ?? null : null)

  // --- Group (round-robin) ---
  const groups = await tx.tournamentMatch.findMany({
    where: { tournamentId, status: { in: [...COMPLETED_STATUSES] } },
    orderBy: [{ round: 'asc' }, { id: 'asc' }],
    include: { group: { select: { name: true } } },
  })
  for (const m of groups) {
    const home = side(m.homeRegistrationId)
    const away = side(m.awayRegistrationId)
    if (!home || !away) continue
    const forfeit = FORFEIT_STATUSES.has(m.status)
    let outcome: Matchup['outcome']
    if (m.winnerRegistrationId == null) outcome = 'DRAW'
    else outcome = m.winnerRegistrationId === m.homeRegistrationId ? 'HOME' : 'AWAY'
    out.push({ matchKey: `group:${m.id}`, stage: 'GROUP', roundLabel: m.group?.name ?? `Group R${m.round}`, completedAt: m.completedAt ?? fallbackDate, home, away, outcome, forfeit, isTeam })
  }

  // --- Playoff bracket (single / double elim) ---
  const playoffs = await tx.playoffMatch.findMany({
    where: { tournamentId, status: { in: [...COMPLETED_STATUSES] }, NOT: [{ homeRegistrationId: null }, { awayRegistrationId: null }] },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  })
  for (const m of playoffs) {
    if (m.winnerRegistrationId == null) continue
    const home = side(m.homeRegistrationId)
    const away = side(m.awayRegistrationId)
    if (!home || !away) continue
    const forfeit = FORFEIT_STATUSES.has(m.status) || (m.note != null && FORFEIT_NOTE.test(m.note))
    out.push({
      matchKey: `playoff:${m.id}`, stage: 'PLAYOFF', roundLabel: m.label ?? `Round ${m.round}`, completedAt: m.completedAt ?? fallbackDate,
      home, away, outcome: m.winnerRegistrationId === m.homeRegistrationId ? 'HOME' : 'AWAY', forfeit, isTeam,
    })
  }

  // --- Swiss ---
  const swiss = await tx.swissMatch.findMany({
    where: { tournamentId, isBye: false, NOT: { winnerRegistrationId: null } },
    orderBy: [{ round: 'asc' }, { boardOrder: 'asc' }],
  })
  for (const m of swiss) {
    const home = side(m.homeRegistrationId)
    const away = side(m.awayRegistrationId)
    if (!home || !away) continue
    out.push({
      matchKey: `swiss:${m.id}`, stage: 'SWISS', roundLabel: `Round ${m.round}`, completedAt: m.reportedAt ?? fallbackDate,
      home, away, outcome: m.winnerRegistrationId === m.homeRegistrationId ? 'HOME' : 'AWAY', forfeit: false, isTeam,
    })
  }
  return out
}

/** Full deterministic rebuild of the entire rating ledger from every COMPLETED tournament, in close
 *  order. Idempotent: safe to call on every close, retry, or correction. */
export async function rebuildRatingLedger(tx: Tx): Promise<{ tournaments: number; entries: number }> {
  const completed = await tx.tournament.findMany({
    where: { lifecycleState: 'COMPLETED' },
    orderBy: [{ ladderAppliedAt: 'asc' }, { number: 'asc' }, { id: 'asc' }],
    select: { id: true, participantFormat: true, ladderAppliedAt: true, createdAt: true },
  })

  await tx.ratingLedger.deleteMany({})

  const rating = new Map<string, number>() // playerId → current rating (all-time running)
  const cur = (id: string) => rating.get(id) ?? ELO_START
  const rows: Prisma.RatingLedgerCreateManyInput[] = []
  let sequence = 0

  for (const t of completed) {
    const isTeam = t.participantFormat === 'TEAM'
    const matchups = await collectMatchups(tx, t.id, isTeam, t.ladderAppliedAt ?? t.createdAt)
    for (const mu of matchups) {
      sequence += 1
      const homeRating = mu.home.players.reduce((s, p) => s + cur(p.id), 0) / mu.home.players.length
      const awayRating = mu.away.players.reduce((s, p) => s + cur(p.id), 0) / mu.away.players.length
      const homeActual = mu.outcome === 'HOME' ? 1 : mu.outcome === 'DRAW' ? 0.5 : 0
      const d = matchDeltas(homeRating, awayRating, homeActual, { forfeit: mu.forfeit })

      const write = (self: Side, opp: Side, sideKind: 'home' | 'away') => {
        const info = d[sideKind]
        const selfActual = sideKind === 'home' ? homeActual : 1 - homeActual
        const result = mu.outcome === 'DRAW' ? 'DRAW' : (sideKind === 'home' ? mu.outcome === 'HOME' : mu.outcome === 'AWAY') ? 'WIN' : 'LOSS'
        for (const p of self.players) {
          const pre = cur(p.id)
          const post = pre + info.delta
          rows.push({
            tournamentId: t.id, matchKey: mu.matchKey, stage: mu.stage, roundLabel: mu.roundLabel,
            playerId: p.id, playerName: p.name,
            opponentId: mu.isTeam ? null : opp.players[0]?.id ?? null,
            opponentName: mu.isTeam ? opp.teamName ?? 'Team' : opp.players[0]?.name ?? 'Unknown',
            isTeamMatch: mu.isTeam, teamName: self.teamName, opponentTeamName: opp.teamName,
            result, isForfeit: mu.forfeit, actual: selfActual,
            preRating: Math.round(pre), expected: info.expected, ratingChange: info.delta, postRating: Math.round(post),
            sequence, completedAt: mu.completedAt,
          })
          rating.set(p.id, post)
        }
      }
      write(mu.home, mu.away, 'home')
      write(mu.away, mu.home, 'away')
    }
  }

  if (rows.length > 0) await tx.ratingLedger.createMany({ data: rows })
  return { tournaments: completed.length, entries: rows.length }
}
