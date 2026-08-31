import 'server-only'
import { RANKING_ELIGIBLE_SEASON, RANKING_ELIGIBLE_TOURNAMENT } from './eligibility'
import type { Prisma, CompetitionPlatform } from '@prisma/client'
import { ELO_START, expectedScore, isRatingNeutral, matchDeltas } from './elo'

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

/**
 * What one team result is worth to each member of a roster.
 *
 * Fixed rather than rated, and identical for 2v2 and 5v5: see the note where it is applied. Not
 * divided or multiplied by roster size — a win is a win to everybody who was on the table.
 */
export const TEAM_DELTA = 2

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

/** Collect rated matchups for one completed Season. INDIVIDUAL only. ONLY genuinely-played matches
 *  count toward the Ladder — FF (FORFEIT), KO (VOID), unplayed (NO_CONTEST) and byes are all excluded.
 *  Uses a `season-group:` / `season-playoff:` matchKey namespace distinct from Tournaments. */
async function collectSeasonMatchups(tx: Tx, seasonId: number, fallbackDate: Date): Promise<Matchup[]> {
  const ents = await tx.seasonEntrant.findMany({ where: { seasonId }, select: { id: true, playerId: true, cueverseId: true, displayName: true, username: true } })
  const sideOf = new Map<number, Side>(ents.map((e) => [e.id, { teamName: null, players: [keyOf(e.playerId, e.cueverseId, e.displayName?.trim() || e.username)] }]))
  const side = (id: number | null): Side | null => (id != null ? sideOf.get(id) ?? null : null)
  const out: Matchup[] = []

  const groups = await tx.seasonMatch.findMany({ where: { seasonId, status: 'COMPLETED' }, orderBy: [{ round: 'asc' }, { id: 'asc' }], include: { group: { select: { code: true, name: true } } } })
  for (const m of groups) {
    const home = side(m.homeEntrantId), away = side(m.awayEntrantId)
    if (!home || !away) continue
    const outcome: Matchup['outcome'] = m.winnerEntrantId == null ? 'DRAW' : m.winnerEntrantId === m.homeEntrantId ? 'HOME' : 'AWAY'
    out.push({ matchKey: `season-group:${m.id}`, stage: 'GROUP', roundLabel: m.group?.name || m.group?.code || `Group R${m.round}`, completedAt: m.completedAt ?? fallbackDate, home, away, outcome, forfeit: false, isTeam: false })
  }

  const playoffs = await tx.seasonPlayoffMatch.findMany({ where: { seasonId, status: 'COMPLETED', NOT: [{ homeEntrantId: null }, { awayEntrantId: null }] }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })
  for (const m of playoffs) {
    if (m.winnerEntrantId == null) continue
    const home = side(m.homeEntrantId), away = side(m.awayEntrantId)
    if (!home || !away) continue
    out.push({ matchKey: `season-playoff:${m.id}`, stage: 'PLAYOFF', roundLabel: m.label ?? `Round ${m.round}`, completedAt: m.completedAt ?? fallbackDate, home, away, outcome: m.winnerEntrantId === m.homeEntrantId ? 'HOME' : 'AWAY', forfeit: false, isTeam: false })
  }
  return out
}

/** Full deterministic rebuild of the entire rating ledger from every COMPLETED Tournament AND Season,
 *  interleaved in close order. Idempotent: safe to call on every close, retry, or correction. */
export async function rebuildRatingLedger(tx: Tx): Promise<{ tournaments: number; seasons: number; entries: number }> {
  /*
   * Only records that currently satisfy the eligibility rule.
   *
   * It used to be `lifecycleState: 'COMPLETED'` alone, which meant `countsTowardRankings` was stored
   * and inert — switching it off changed a checkbox and nothing else — and a record Under Correction
   * kept contributing while its results were being changed.
   *
   * Rebuilding from whatever is eligible RIGHT NOW is also why withdrawal and restoration are the
   * same operation: nothing is ever subtracted, so repeated correction cycles cannot drift.
   */
  const tournaments = await tx.tournament.findMany({
    where: RANKING_ELIGIBLE_TOURNAMENT,
    orderBy: [{ ladderAppliedAt: 'asc' }, { number: 'asc' }, { id: 'asc' }],
    select: { id: true, participantFormat: true, ladderAppliedAt: true, createdAt: true, platform: true, competitionYear: true, number: true },
  })
  const seasons = await tx.season.findMany({
    where: RANKING_ELIGIBLE_SEASON,
    orderBy: [{ ladderAppliedAt: 'asc' }, { number: 'asc' }, { id: 'asc' }],
    select: { id: true, ladderAppliedAt: true, createdAt: true, platform: true, competitionYear: true, number: true },
  })

  /*
   * ── The timeline is WHEN IT WAS PLAYED, not when it was entered here ─────────────────────────────
   *
   * This used to order by `ladderAppliedAt ?? createdAt` — the moment a record was closed in this
   * application. For a live registry those coincide; for an archive typed up a decade later they
   * have nothing to do with each other. A 2005 Season entered last week replayed after 2014, and a
   * Season re-closed after a correction jumped to the very end: 2010 Season 3 was replayed 48th of
   * 48 simply because it had been reopened and recompleted.
   *
   * Elo is path-dependent, so this is arithmetic rather than presentation. Beating a 2013 field is
   * not the same as beating the same people in 2006 when they were still near 1500, and rating the
   * matches out of order gives every player the wrong opponent strength. Correcting it moved 438 of
   * 497 players.
   *
   * `competitionYear` then `number` is the real chronology, with the id last so two records from the
   * same year and number (the two Divisions) stay in a fixed order rather than a random one.
   */
  type Source = { tournamentId?: number; seasonId?: number; isTeam: boolean; at: Date; platform: CompetitionPlatform; year: number; num: number; id: number }
  const sources: Source[] = [
    ...tournaments.map((t) => ({ tournamentId: t.id, isTeam: t.participantFormat === 'TEAM', at: t.ladderAppliedAt ?? t.createdAt, platform: t.platform, year: t.competitionYear, num: t.number ?? 0, id: t.id })),
    ...seasons.map((s) => ({ seasonId: s.id, isTeam: false, at: s.ladderAppliedAt ?? s.createdAt, platform: s.platform, year: s.competitionYear, num: s.number, id: s.id })),
  ].sort((a, b) => a.year - b.year || a.num - b.num || a.id - b.id)

  await tx.ratingLedger.deleteMany({})

  /*
   * One running rating PER PLATFORM, never one across both.
   *
   * A Yahoo rating is not a starting point for a CueVerse one. Somebody who dominated the archive
   * begins their CueVerse career at the same 1500 as everybody else, and somebody who never touched
   * Yahoo is not compared against a number earned there. Sharing one map would have made every
   * CueVerse rating a continuation of an archive most of its players were never in.
   *
   * Keyed by platform then player, so the two replays cannot reach each other even by accident: a
   * rebuild of one reads and writes only its own map.
   */
  const rating = new Map<CompetitionPlatform, Map<string, number>>()
  const mapFor = (p: CompetitionPlatform) => {
    const m = rating.get(p) ?? new Map<string, number>()
    if (!rating.has(p)) rating.set(p, m)
    return m
  }
  let platform: CompetitionPlatform = 'CUEVERSE'
  const cur = (id: string) => mapFor(platform).get(id) ?? ELO_START
  const rows: Prisma.RatingLedgerCreateManyInput[] = []
  let sequence = 0

  for (const c of sources) {
    // Every rating read and written while this source is processed belongs to its platform.
    platform = c.platform
    const matchups = c.tournamentId != null ? await collectMatchups(tx, c.tournamentId, c.isTeam, c.at) : await collectSeasonMatchups(tx, c.seasonId!, c.at)
    for (const mu of matchups) {
      sequence += 1
      const homeRating = mu.home.players.reduce((s, p) => s + cur(p.id), 0) / mu.home.players.length
      const awayRating = mu.away.players.reduce((s, p) => s + cur(p.id), 0) / mu.away.players.length
      const homeActual = mu.outcome === 'HOME' ? 1 : mu.outcome === 'DRAW' ? 0.5 : 0
      /*
       * A team match moves every member by a fixed ±2, not by Elo.
       *
       * Elo asks "how surprising was this result", which needs two comparable ratings. A team has no
       * rating — averaging its members invents one, and then a 5v5 win moves five people by an amount
       * derived from a number nobody holds. Worse, the average makes the reward depend on who your
       * team-mates are: carrying a beginner would earn you more for the same win.
       *
       * So a team result is worth the same to everyone who played it, whatever the roster size:
       * +2 to each member of the winning roster, −2 to each of the losing one. A forfeit moves
       * nobody, exactly as it does for an individual match.
       */
      const d = isRatingNeutral(c.platform, c.tournamentId)
        ? {
            home: { delta: 0, expected: expectedScore(homeRating, awayRating) },
            away: { delta: 0, expected: expectedScore(awayRating, homeRating) },
          }
        : mu.isTeam
        ? {
            home: { delta: mu.forfeit ? 0 : homeActual === 1 ? TEAM_DELTA : -TEAM_DELTA, expected: 0.5 },
            away: { delta: mu.forfeit ? 0 : homeActual === 1 ? -TEAM_DELTA : TEAM_DELTA, expected: 0.5 },
          }
        : matchDeltas(homeRating, awayRating, homeActual, { forfeit: mu.forfeit })

      const write = (self: Side, opp: Side, sideKind: 'home' | 'away') => {
        const info = d[sideKind]
        const selfActual = sideKind === 'home' ? homeActual : 1 - homeActual
        const result = mu.outcome === 'DRAW' ? 'DRAW' : (sideKind === 'home' ? mu.outcome === 'HOME' : mu.outcome === 'AWAY') ? 'WIN' : 'LOSS'
        for (const p of self.players) {
          const pre = cur(p.id)
          const post = pre + info.delta
          rows.push({
            tournamentId: c.tournamentId ?? null, seasonId: c.seasonId ?? null,
            matchKey: mu.matchKey, stage: mu.stage, roundLabel: mu.roundLabel,
            playerId: p.id, playerName: p.name,
            opponentId: mu.isTeam ? null : opp.players[0]?.id ?? null,
            opponentName: mu.isTeam ? opp.teamName ?? 'Team' : opp.players[0]?.name ?? 'Unknown',
            isTeamMatch: mu.isTeam, teamName: self.teamName, opponentTeamName: opp.teamName,
            result, isForfeit: mu.forfeit, actual: selfActual,
            preRating: Math.round(pre), expected: info.expected, ratingChange: info.delta, postRating: Math.round(post),
            sequence, completedAt: mu.completedAt,
            platform: c.platform,
          })
          mapFor(c.platform).set(p.id, post)
        }
      }
      write(mu.home, mu.away, 'home')
      write(mu.away, mu.home, 'away')
    }
  }

  if (rows.length > 0) await tx.ratingLedger.createMany({ data: rows })
  return { tournaments: tournaments.length, seasons: seasons.length, entries: rows.length }
}
