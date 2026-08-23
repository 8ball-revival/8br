import 'server-only'
import type { Prisma, SeasonQualification } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import { validateResult } from '@/lib/competition/scoring'
import { planBracket, type Qualifier } from '@/lib/competition/bracket'
import { planDoubleElim } from '@/lib/competition/bracket-de'
import type { BracketRound, BracketMatch as ViewMatch } from '@/lib/tournaments/fixtures'
import { transitionSeasonState } from './lifecycle'
import { assignSeeds, persistSeeds, seedsByEntrant } from './playoff-seeds'
import { isPreGroupPhase } from './shared'

/**
 * SEASON PLAYOFFS — locked-seed selection, private draft bracket (single/double elim), publish, and
 * live result reporting with downstream rebuild. Reuses the pure bracket planners; persists to the
 * Season-owned season_playoff_match table.
 */

// ---- Seeding --------------------------------------------------------------

export interface SeasonSeedRow {
  entrantId: number
  name: string
  cueverseId: string | null
  group: string
  groupPosition: number
  points: number
  record: string // W-L-D
  winPct: number
  included: boolean
  qualification: SeasonQualification
  overallSeed: number | null
}

const winPctOf = (gw: number, gl: number) => (gw + gl === 0 ? 0 : gw / (gw + gl))

/** The complete, LOCKED seeding list. Order: all group winners, then all 2nd, then all 3rd, then
 *  wildcards; within each tier by points → win% → locked registration-close rating. Players cannot be
 *  manually reordered — this order is derived, not editable. */
export async function loadSeasonSeeding(seasonId: number): Promise<SeasonSeedRow[]> {
  const standings = await prisma.seasonStanding.findMany({ where: { seasonId }, include: { group: { select: { code: true, name: true } } } })
  const entrants = await prisma.seasonEntrant.findMany({ where: { seasonId }, select: { id: true, displayName: true, username: true, cueverseId: true, ratingSnapshot: true, kickedOut: true, playoffIncluded: true, qualification: true, playoffSeed: true } })
  const entById = new Map(entrants.map((e) => [e.id, e]))

  /*
   * A reconstructed Season whose group stage the archive never recorded.
   *
   * Seeding is normally dictated by the group results and by nothing else, and that stays true: this
   * is the case where there are no group results to be dictated by. 2009 S5 has a complete playoff
   * page — thirty-two positions, real seed numbers, a champion — and no groups, no group matches and
   * no standings at all, so the seeding came back empty and the bracket could not be drawn for a
   * playoff that plainly happened.
   *
   * The page's own seed numbers are used instead, and only here. The guard is deliberately narrow:
   * a reconstruction, with zero standings rows, whose entrants carry a seed recorded from the page.
   * A live Season cannot reach playoff setup without closing its groups, so it can never take this
   * path, and a reconstruction that merely failed to import its standings has no seeds to use.
   */
  if (standings.length === 0) {
    const season = await prisma.season.findUnique({ where: { id: seasonId }, select: { reconstruction: true } })
    const seeded = entrants.filter((e) => e.playoffSeed != null && !e.kickedOut)
    if (!season?.reconstruction || seeded.length < 2) return []

    return seeded
      .sort((a, b) => a.playoffSeed! - b.playoffSeed! || a.id - b.id)
      .map((e, i) => ({
        entrantId: e.id,
        name: e.displayName?.trim() || e.username,
        cueverseId: e.cueverseId,
        // No group stage was recorded, so nothing is claimed about one.
        group: '—',
        groupPosition: i + 1,
        points: 0,
        record: '—',
        winPct: 0,
        included: e.playoffIncluded,
        qualification: e.qualification,
        overallSeed: i + 1,
      }))
  }

  const rows = standings
    .map((s) => {
      const e = entById.get(s.entrantId)
      if (!e) return null
      return {
        entrantId: s.entrantId,
        name: e.displayName?.trim() || e.username,
        cueverseId: e.cueverseId,
        group: s.group.name || s.group.code,
        groupPosition: s.rank,
        points: s.points,
        record: `${s.wins}-${s.losses}-${s.draws}`,
        winPct: winPctOf(s.gamesWon, s.gamesLost),
        rating: e.ratingSnapshot ?? 1500,
        included: e.playoffIncluded,
        qualification: e.qualification,
        kicked: e.kickedOut,
      }
    })
    .filter((r): r is NonNullable<typeof r> => !!r)

  // Seeding is dictated by the GROUP RESULTS and by nothing else.
  //
  // It is computed across every eligible entrant, not just the ones picked for the bracket, so
  // choosing who plays cannot move anybody's seed — drop the number 3 seed and the number 4 seed is
  // still the number 4 seed. Order is group finish, then points, then game win percentage, then name.
  //
  // Head-to-head does not appear here because it cannot: it only means something between two players
  // in the SAME group, and `groupPosition` already has it applied — computeStandings settles a points
  // tie on head-to-head before anything else.
  const eligible = rows.filter((r) => !r.kicked)
  eligible.sort((a, b) =>
    a.groupPosition - b.groupPosition ||
    b.points - a.points ||
    b.winPct - a.winPct ||
    (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0) ||
    a.entrantId - b.entrantId)
  const seedByEntrant = new Map(eligible.map((r, i) => [r.entrantId, i + 1]))

  return rows
    // Kicked-out players have no seed, so they fall to the bottom in a stable, readable order.
    .sort((a, b) => (seedByEntrant.get(a.entrantId) ?? 1e9) - (seedByEntrant.get(b.entrantId) ?? 1e9) || a.groupPosition - b.groupPosition || b.points - a.points)
    .map((r) => ({
      entrantId: r.entrantId,
      name: r.name,
      cueverseId: r.cueverseId,
      group: r.group,
      groupPosition: r.groupPosition,
      points: r.points,
      record: r.record,
      winPct: r.winPct,
      included: r.included && !r.kicked,
      qualification: r.kicked ? 'KICKED_OUT' : r.qualification,
      overallSeed: seedByEntrant.get(r.entrantId) ?? null,
    }))
}

// ---- Enter setup + default qualifiers -------------------------------------

/**
 * Open the playoff setup phase with EVERY eligible entrant already in the field.
 *
 * Selecting only the top few per group assumes the modern qualification rules, which is wrong for a
 * season being reconstructed — the archived bracket decides who played, and that is easier to reach
 * by unticking the handful who did not than by hunting down everyone who did. Kicked-out players
 * stay out.
 */
export async function enterSeasonPlayoffSetup(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (s.lifecycleState !== 'GROUPS_CLOSED') return { ok: false, error: 'Open playoff setup from the Groups Closed phase.' }
  const eligible = await prisma.seasonEntrant.findMany({
    where: { seasonId, kickedOut: false, status: 'APPROVED' }, select: { id: true },
  })

  await prisma.$transaction(async (tx) => {
    await tx.seasonEntrant.updateMany({ where: { seasonId, kickedOut: true }, data: { playoffIncluded: false, qualification: 'KICKED_OUT' } })
    await tx.seasonEntrant.updateMany({
      where: { seasonId, kickedOut: false, status: 'APPROVED' },
      data: { playoffIncluded: true, qualification: 'AUTOMATIC', qualificationReason: null, playoffSeed: null },
    })
    await recordAudit(actor, { action: 'season.playoff.setup', entity: 'Season', entityId: seasonId, newValue: { included: eligible.length } }, tx)
    const t = await transitionSeasonState(actor, seasonId, 'PLAYOFF_SETUP', { tx })
    if (!t.ok) throw new Error(t.error)
  })
  return { ok: true }
}

// ---- Selection changes (invalidate any draft) -----------------------------

async function invalidateDraft(tx: Prisma.TransactionClient, seasonId: number): Promise<void> {
  await tx.seasonPlayoffMatch.deleteMany({ where: { seasonId, published: false } })
}

export type QualAction = 'disqualify' | 'wildcard' | 'restore'

export async function setSeasonQualification(actor: Actor, seasonId: number, entrantId: number, action: QualAction, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (s?.lifecycleState !== 'PLAYOFF_SETUP') return { ok: false, error: 'Qualification can only be changed during playoff setup.' }
  const e = await prisma.seasonEntrant.findFirst({ where: { id: entrantId, seasonId } })
  if (!e) return { ok: false, error: 'Entrant not found.' }
  if (e.kickedOut) return { ok: false, error: 'Kicked-out players cannot be selected.' }
  // Disqualification requires a reason; a Wildcard note is OPTIONAL (may be blank).
  if (action === 'disqualify' && !reason?.trim()) return { ok: false, error: 'A reason is required.' }

  const data =
    action === 'disqualify' ? { playoffIncluded: false, qualification: 'DISQUALIFIED' as const, qualificationReason: reason!.trim() }
    : action === 'wildcard' ? { playoffIncluded: true, qualification: 'WILDCARD' as const, qualificationReason: reason?.trim() || null }
    : { playoffIncluded: true, qualification: 'AUTOMATIC' as const, qualificationReason: null }

  await prisma.$transaction(async (tx) => {
    await tx.seasonEntrant.update({ where: { id: entrantId }, data })
    await recordAudit(actor, { action: `season.playoff.${action}`, entity: 'Season', entityId: seasonId, newValue: { entrantId }, reason: reason?.trim() }, tx)
    await invalidateDraft(tx, seasonId) // selection changed → any draft bracket is stale
  })
  return { ok: true }
}

/**
 * Include or exclude a player from the playoff field.
 *
 * A season being reconstructed from an archive had whatever field it had; there is no useful
 * distinction here between an automatic qualifier, a wildcard and a disqualification, so this is a
 * single switch. The stored qualification is kept in step for anything that still reads it.
 */
export async function setSeasonPlayoffIncluded(
  actor: Actor,
  seasonId: number,
  entrantId: number,
  included: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (s?.lifecycleState !== 'PLAYOFF_SETUP') return { ok: false, error: 'The playoff field can only be changed during playoff setup.' }
  const e = await prisma.seasonEntrant.findFirst({ where: { id: entrantId, seasonId }, select: { id: true } })
  if (!e) return { ok: false, error: 'Entrant not found.' }

  await prisma.$transaction(async (tx) => {
    await tx.seasonEntrant.update({
      where: { id: entrantId },
      data: {
        playoffIncluded: included,
        qualification: included ? 'AUTOMATIC' : 'NOT_SELECTED',
        qualificationReason: null,
      },
    })
    await recordAudit(actor, {
      action: included ? 'season.playoff.include' : 'season.playoff.exclude',
      entity: 'Season', entityId: seasonId, newValue: { entrantId },
    }, tx)
    await invalidateDraft(tx, seasonId)
  })
  return { ok: true }
}

/**
 * Put the whole eligible field in or out at once.
 *
 * With everyone included by default, clearing the column and ticking back the handful who actually
 * played is usually the quicker way to reproduce an archived bracket. Kicked-out players are never
 * swept back in.
 */
export async function setSeasonPlayoffField(
  actor: Actor,
  seasonId: number,
  included: boolean,
): Promise<{ ok: boolean; error?: string; changed?: number }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (s?.lifecycleState !== 'PLAYOFF_SETUP') return { ok: false, error: 'The playoff field can only be changed during playoff setup.' }

  let changed = 0
  await prisma.$transaction(async (tx) => {
    const res = await tx.seasonEntrant.updateMany({
      where: { seasonId, kickedOut: false, status: 'APPROVED' },
      data: {
        playoffIncluded: included,
        qualification: included ? 'AUTOMATIC' : 'NOT_SELECTED',
        qualificationReason: null,
      },
    })
    changed = res.count
    await recordAudit(actor, {
      action: included ? 'season.playoff.includeAll' : 'season.playoff.excludeAll',
      entity: 'Season', entityId: seasonId, newValue: { changed },
    }, tx)
    await invalidateDraft(tx, seasonId)
  })
  return { ok: true, changed }
}

/**
 * Set (or clear) the note shown under this Season's playoff bracket.
 *
 * Deliberately editable at ANY point from playoff setup onwards, including after the bracket is
 * published and after the Season is closed. Locking placement is about protecting the record;
 * this is about describing it, and you usually only know what needs saying once the bracket is up.
 */
export async function setSeasonPlayoffDisclaimer(
  actor: Actor,
  seasonId: number,
  text: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (!s) return { ok: false, error: 'Season not found.' }
  if (isPreGroupPhase(s.lifecycleState) || s.lifecycleState === 'GROUP_STAGE_LIVE' || s.lifecycleState === 'GROUPS_CLOSED') {
    return { ok: false, error: 'There is no playoff bracket to annotate yet.' }
  }
  const value = (text ?? '').trim().slice(0, 500) || null

  await prisma.$transaction(async (tx) => {
    await tx.season.update({ where: { id: seasonId }, data: { playoffDisclaimer: value } })
    await recordAudit(actor, {
      action: value ? 'season.playoff.disclaimer' : 'season.playoff.disclaimer.clear',
      entity: 'Season', entityId: seasonId, newValue: { length: value?.length ?? 0 },
    }, tx)
  })
  return { ok: true }
}

/**
 * Swap the occupants of two bracket slots.
 *
 * This is what "move Luis onto Alexander" actually means: both slots keep an occupant and nobody is
 * duplicated or lost. Either slot may be empty, in which case the player simply moves across.
 *
 * Only while the bracket is still a draft — see setSeasonBracketSlot for why.
 */
export async function swapSeasonBracketSlots(
  actor: Actor,
  seasonId: number,
  a: { matchId: number; side: 'home' | 'away' },
  b: { matchId: number; side: 'home' | 'away' },
): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (s?.lifecycleState !== 'PLAYOFF_SETUP') {
    return { ok: false, error: 'The bracket is published — playoff placement can no longer be changed.' }
  }
  if (a.matchId === b.matchId && a.side === b.side) return { ok: true }

  const [ma, mb] = await Promise.all([
    prisma.seasonPlayoffMatch.findFirst({ where: { id: a.matchId, seasonId } }),
    prisma.seasonPlayoffMatch.findFirst({ where: { id: b.matchId, seasonId } }),
  ])
  if (!ma || !mb) return { ok: false, error: 'Bracket match not found.' }
  if (ma.status === 'COMPLETED' || mb.status === 'COMPLETED') {
    return { ok: false, error: 'That tie already has a result — clear it before moving players.' }
  }

  /*
   * Both ends must be positions a person may fill.
   *
   * A position some match feeds is decided by play. Swapping into one puts a player in a tie they
   * have not qualified for, and the placement vanishes the moment the feeder resolves and overwrites
   * it — a change that appears to work and then silently undoes itself.
   */
  const { bracketTopology, slotKey } = await import('./playoff-topology')
  const topo = await bracketTopology(seasonId)
  for (const end of [a, b]) {
    if (!topo.entryKeys.has(slotKey(end.matchId, end.side))) {
      return { ok: false, error: 'That position is decided by an earlier match — it cannot be set by hand.' }
    }
  }

  const read = (m: typeof ma, side: 'home' | 'away') =>
    side === 'home'
      ? { entrantId: m.homeEntrantId, username: m.homeUsername, seed: m.homeSeed }
      : { entrantId: m.awayEntrantId, username: m.awayUsername, seed: m.awaySeed }
  const write = (side: 'home' | 'away', v: { entrantId: number | null; username: string | null; seed: number | null }) =>
    side === 'home'
      ? { homeEntrantId: v.entrantId, homeUsername: v.username, homeSeed: v.seed }
      : { awayEntrantId: v.entrantId, awayUsername: v.username, awaySeed: v.seed }

  const va = read(ma, a.side)
  const vb = read(mb, b.side)

  await prisma.$transaction(async (tx) => {
    if (a.matchId === b.matchId) {
      // Both slots are the same tie — one update carries both sides.
      await tx.seasonPlayoffMatch.update({
        where: { id: a.matchId },
        data: { ...write(a.side, vb), ...write(b.side, va) },
      })
    } else {
      await tx.seasonPlayoffMatch.update({ where: { id: a.matchId }, data: write(a.side, vb) })
      await tx.seasonPlayoffMatch.update({ where: { id: b.matchId }, data: write(b.side, va) })
    }
    await recordAudit(actor, {
      action: 'season.playoff.swap', entity: 'Season', entityId: seasonId,
      newValue: { a, b, moved: [va.entrantId, vb.entrantId] },
    }, tx)
  })
  return { ok: true }
}

/**
 * Put a player into a bracket slot, after the bracket has been generated.
 *
 * If they already occupy another slot the two SWAP, which is what moving someone in a bracket
 * actually means — anything else would silently duplicate or drop a player. Passing null clears the
 * slot. Only ever touches an unpublished draft or a live bracket's un-played ties.
 */
export async function setSeasonBracketSlot(
  actor: Actor,
  seasonId: number,
  matchId: number,
  side: 'home' | 'away',
  entrantId: number | null,
): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  // Placement is fixed at publication. Once the bracket is public, who plays whom is part of the
  // record; corrections after that are results, not reshuffles.
  if (s?.lifecycleState !== 'PLAYOFF_SETUP') {
    return { ok: false, error: 'The bracket is published — playoff placement can no longer be changed.' }
  }
  const target = await prisma.seasonPlayoffMatch.findFirst({ where: { id: matchId, seasonId } })
  if (!target) return { ok: false, error: 'Bracket match not found.' }
  if (target.status === 'COMPLETED') return { ok: false, error: 'That tie already has a result — clear it before moving players.' }

  // Only a position nothing feeds may be filled by hand. See playoff-topology for why the rule is
  // structural rather than "round one".
  const { isEntrySlot } = await import('./playoff-topology')
  if (!(await isEntrySlot(seasonId, matchId, side))) {
    return { ok: false, error: 'That position is decided by an earlier match — it cannot be set by hand.' }
  }

  const seedOf = async (id: number | null) =>
    id == null ? null : (await prisma.seasonEntrant.findUnique({ where: { id }, select: { playoffSeed: true } }))?.playoffSeed ?? null
  const nameOf = async (id: number | null) => {
    if (id == null) return null
    const e = await prisma.seasonEntrant.findUnique({ where: { id }, select: { displayName: true, username: true } })
    return e ? (e.displayName?.trim() || e.username) : null
  }

  // Whoever currently sits where we are putting this player.
  const displaced = side === 'home' ? target.homeEntrantId : target.awayEntrantId

  await prisma.$transaction(async (tx) => {
    if (entrantId != null) {
      // Find any other slot this player already occupies and put the displaced player there.
      const elsewhere = await tx.seasonPlayoffMatch.findFirst({
        where: { seasonId, id: { not: matchId }, OR: [{ homeEntrantId: entrantId }, { awayEntrantId: entrantId }] },
      })
      if (elsewhere) {
        const isHome = elsewhere.homeEntrantId === entrantId
        await tx.seasonPlayoffMatch.update({
          where: { id: elsewhere.id },
          data: isHome
            ? { homeEntrantId: displaced, homeUsername: await nameOf(displaced), homeSeed: await seedOf(displaced) }
            : { awayEntrantId: displaced, awayUsername: await nameOf(displaced), awaySeed: await seedOf(displaced) },
        })
      }
    }
    await tx.seasonPlayoffMatch.update({
      where: { id: matchId },
      data: side === 'home'
        ? { homeEntrantId: entrantId, homeUsername: await nameOf(entrantId), homeSeed: await seedOf(entrantId) }
        : { awayEntrantId: entrantId, awayUsername: await nameOf(entrantId), awaySeed: await seedOf(entrantId) },
    })
    await recordAudit(actor, {
      action: 'season.playoff.slot', entity: 'Season', entityId: seasonId,
      newValue: { matchId, side, entrantId, displaced },
    }, tx)
  })
  return { ok: true }
}

export async function setSeasonPlayoffType(actor: Actor, seasonId: number, doubleElim: boolean): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (s?.lifecycleState !== 'PLAYOFF_SETUP') return { ok: false, error: 'The bracket type can only be set during playoff setup.' }
  await prisma.$transaction(async (tx) => {
    await tx.season.update({ where: { id: seasonId }, data: { playoffDoubleElim: doubleElim } })
    await recordAudit(actor, { action: 'season.playoff.type', entity: 'Season', entityId: seasonId, newValue: { doubleElim } }, tx)
    await invalidateDraft(tx, seasonId)
  })
  return { ok: true }
}

// ---- Generate + publish ---------------------------------------------------

const deRound = (section: string, round: number) => (section === 'WB' ? round : section === 'LB' ? 100 + round : 201)

/** An unseated bracket position: no player, no name, no seed. */
const emptyPlanSlot = { registrationId: null, username: null, seed: null } as const

/** Build a PRIVATE draft bracket from the included players in locked seed order (single or double
 *  elim per the Season setting). Byes are handled automatically. Replaces any prior draft. */
export async function generateSeasonBracket(
  actor: Actor,
  seasonId: number,
  opts: { size?: number } = {},
): Promise<{ ok: boolean; error?: string; matches?: number; size?: number }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true, playoffDoubleElim: true } })
  if (s?.lifecycleState !== 'PLAYOFF_SETUP') return { ok: false, error: 'Generate the bracket during playoff setup.' }
  const seeding = (await loadSeasonSeeding(seasonId)).filter((r) => r.included && r.overallSeed != null)
  if (seeding.length < 2) return { ok: false, error: 'Select at least two players for the playoffs.' }

  /*
   * Bracket size: the smallest that fits, unless told otherwise.
   *
   * An override exists because a historical bracket's SIZE is part of the record. A 1990s field of
   * six played a bracket of eight with two byes, and rebuilding it as a bracket of eight is not a
   * preference — it is what happened. Refusing a size smaller than the field, rather than silently
   * growing it, keeps the operator's intent legible: they asked for something impossible and should
   * be told, not quietly given something else.
   */
  const { BRACKET_SIZES, smallestBracketFor } = await import('./playoff-topology')
  const natural = smallestBracketFor(seeding.length)
  if (natural == null) {
    return { ok: false, error: `${seeding.length} participants is more than the largest bracket (${BRACKET_SIZES.at(-1)}).` }
  }
  let size: number = natural
  if (opts.size != null) {
    if (!(BRACKET_SIZES as readonly number[]).includes(opts.size)) {
      return { ok: false, error: `Choose a bracket size of ${BRACKET_SIZES.join(', ')}.` }
    }
    if (opts.size < seeding.length) {
      return { ok: false, error: `A bracket of ${opts.size} cannot hold ${seeding.length} participants.` }
    }
    size = opts.size
  }
  // Empty capacity becomes byes: the planner seats real players and leaves the rest unoccupied.
  const padding = size - seeding.length

  // Bracket seeds are 1..N over the players actually IN the bracket, densified from the
  // group-derived order. The order itself is untouched, so leaving someone out never promotes
  // anyone above anyone else — it only closes the gap their absence would leave in the numbering.
  const seedList = assignSeeds(seeding.map((r) => ({ entrantId: r.entrantId, order: r.overallSeed! })))
  const seedOfEntrant = new Map(seedList.map((a) => [a.entrantId, a.seed]))
  const qualifiers: Qualifier[] = seeding.map((r) => ({
    registrationId: r.entrantId, username: r.name, seed: seedOfEntrant.get(r.entrantId)!,
  }))
  /*
   * Pad the field to the requested size with placeholders the planner reads as byes.
   *
   * The planner sizes the bracket from the number of qualifiers it is given, so asking for a larger
   * bracket means handing it a larger field. A padding entry carries no registrationId, which is
   * exactly what an empty entry slot is.
   */
  for (let i = 0; i < padding; i++) {
    qualifiers.push({ registrationId: null as unknown as number, username: null as unknown as string, seed: seeding.length + i + 1 })
  }

  try {
  await prisma.$transaction(async (tx) => {
    // Persisted FIRST. A throw here — an incomplete, duplicated or out-of-range set — takes the
    // whole transaction with it, so a bracket can never exist alongside a broken seeding.
    await persistSeeds(tx, seasonId, seedList)
    await tx.seasonPlayoffMatch.deleteMany({ where: { seasonId } })
    if (s.playoffDoubleElim) {
      const plan = planDoubleElim(qualifiers)
      const idByIndex = new Map<number, number>()
      for (const m of plan.matches) {
        // A first-round (WB round 1) empty slot is a BYE, not a yet-undetermined TBD — label it so
        // it renders as "Bye". The seeded player advances through it when the playoffs start.
        //
        // Only WB round one is seated. The planner walks byes forward into later rounds; a generated
        // draft deliberately does not, so those slots stay empty and editable until the playoffs
        // begin — see settleByes.
        const wbFirst = m.section === 'WB' && m.round === 1
        const home = wbFirst ? m.home : emptyPlanSlot
        const away = wbFirst ? m.away : emptyPlanSlot
        const row = await tx.seasonPlayoffMatch.create({ data: { seasonId, section: m.section, round: deRound(m.section, m.round), slot: m.slot, label: m.label, homeEntrantId: home.registrationId, awayEntrantId: away.registrationId, homeUsername: wbFirst && home.registrationId == null ? 'Bye' : home.username, awayUsername: wbFirst && away.registrationId == null ? 'Bye' : away.username, homeSeed: home.seed, awaySeed: away.seed } })
        idByIndex.set(m.index, row.id)
      }
      for (const m of plan.matches) {
        await tx.seasonPlayoffMatch.update({ where: { id: idByIndex.get(m.index)! }, data: { feedsMatchId: m.feedsIndex != null ? idByIndex.get(m.feedsIndex) : null, feedsSlot: m.feedsSlot, loserFeedsMatchId: m.loserFeedsIndex != null ? idByIndex.get(m.loserFeedsIndex) : null, loserFeedsSlot: m.loserFeedsSlot } })
      }
    } else {
      const plan = planBracket(qualifiers)
      const idByIndex = new Map<number, number>()
      for (const m of plan.matches) {
        // A first-round empty slot is a BYE, not a yet-undetermined TBD — label it so it renders as
        // "Bye". The seeded player advances through it when the playoffs start.
        //
        // Only round one is seated. The planner walks byes forward into round two; a generated draft
        // deliberately does not, so those slots stay empty and editable — see settleByes.
        const firstRound = m.round === 1
        const home = firstRound ? m.home : emptyPlanSlot
        const away = firstRound ? m.away : emptyPlanSlot
        const row = await tx.seasonPlayoffMatch.create({ data: { seasonId, round: m.round, slot: m.slot, label: m.label, homeEntrantId: home.registrationId, awayEntrantId: away.registrationId, homeUsername: firstRound && home.registrationId == null ? 'Bye' : home.username, awayUsername: firstRound && away.registrationId == null ? 'Bye' : away.username, homeSeed: home.seed, awaySeed: away.seed } })
        idByIndex.set(m.index, row.id)
      }
      for (const m of plan.matches) {
        await tx.seasonPlayoffMatch.update({ where: { id: idByIndex.get(m.index)! }, data: { feedsMatchId: m.feedsIndex != null ? idByIndex.get(m.feedsIndex) : null, feedsSlot: m.feedsSlot } })
      }
    }
    // Byes are deliberately NOT settled here — see settleByes. A generated draft shows the bye, but
    // the next round's slot stays empty and the tie stays unplayed so both remain editable.
    await recordAudit(actor, { action: 'season.playoff.generate', entity: 'Season', entityId: seasonId, newValue: { players: qualifiers.length, doubleElim: s.playoffDoubleElim } }, tx)
  })
  } catch (e) {
    // A seeding failure is a refusal, not a crash: the transaction has already rolled back, so the
    // Season is exactly as it was and the admin gets told what was wrong with it.
    const { SeedingError } = await import('./playoff-seeds')
    if (e instanceof SeedingError) return { ok: false, error: `Bracket not generated — ${e.message}` }
    throw e
  }
  const n = await prisma.seasonPlayoffMatch.count({ where: { seasonId } })
  return { ok: true, matches: n, size }
}

/**
 * Award byes: advance any tie holding one real player opposite an empty ENTRY slot.
 *
 * ── When this runs ───────────────────────────────────────────────────────────────────────────────
 * At the moment the playoffs START, never when the bracket is generated. A generated draft leaves
 * the bye recipient sitting in round one with the next round's slot EMPTY, because that is what makes
 * the bracket editable: a settled bye marks its tie COMPLETED, and a completed tie refuses every
 * placement edit. So during setup nobody is advanced, and whatever the bracket looks like at the
 * moment of publication is what gets settled.
 *
 * It also runs after each live result, so a bye further down a chain resolves as its feeder decides.
 *
 * ── What counts as a bye ─────────────────────────────────────────────────────────────────────────
 * An ENTRY slot is one that nothing feeds into — round one of the winners' bracket, in practice.
 * Empty there means "no opponent". Empty anywhere else means "not decided yet" and must never be
 * read as a bye, or the bracket would advance players past ties still waiting to be played.
 *
 * Reading the topology rather than the literal "Bye" label is what makes this survive manual
 * editing: clearing a slot writes null, not the placeholder, so a label check would miss it.
 */
async function settleByes(tx: Prisma.TransactionClient, seasonId: number): Promise<void> {
  // Iterate a few passes so byes chain through multiple rounds.
  for (let pass = 0; pass < 6; pass++) {
    const all = await tx.seasonPlayoffMatch.findMany({ where: { seasonId } })
    // Every slot some other tie feeds into — winners' feed and, in double elim, losers' feed.
    const fed = new Set<string>()
    for (const m of all) {
      if (m.feedsMatchId != null) fed.add(`${m.feedsMatchId}:${m.feedsSlot ?? 0}`)
      if (m.loserFeedsMatchId != null) fed.add(`${m.loserFeedsMatchId}:${m.loserFeedsSlot ?? 0}`)
    }
    const isEntrySlot = (matchId: number, slot: 0 | 1) => !fed.has(`${matchId}:${slot}`)

    let changed = false
    for (const m of all) {
      // A decided tie is done, and a tie that feeds nowhere has no round to advance into.
      if (m.winnerEntrantId != null || m.feedsMatchId == null) continue
      // A flagged tie holds a result nobody has confirmed yet. Advancing from it would carry an
      // unreviewed outcome further into the bracket.
      if (m.needsReview) continue
      const homeReal = m.homeEntrantId != null
      const awayReal = m.awayEntrantId != null
      const homeBye = !homeReal && isEntrySlot(m.id, 0)
      const awayBye = !awayReal && isEntrySlot(m.id, 1)
      if (!((homeReal && awayBye) || (awayReal && homeBye))) continue

      const win = homeReal
        ? { id: m.homeEntrantId!, name: m.homeUsername!, seed: m.homeSeed }
        : { id: m.awayEntrantId!, name: m.awayUsername!, seed: m.awaySeed }
      await tx.seasonPlayoffMatch.update({
        where: { id: m.id },
        data: {
          winnerEntrantId: win.id, verification: 'VERIFIED', status: 'COMPLETED',
          // Name the empty side, so a slot cleared during editing still reads as a bye afterwards
          // rather than as a blank the published bracket cannot explain.
          ...(homeBye && m.homeUsername == null ? { homeUsername: 'Bye' } : {}),
          ...(awayBye && m.awayUsername == null ? { awayUsername: 'Bye' } : {}),
        },
      })
      await placeInto(tx, m.feedsMatchId, m.feedsSlot ?? 0, win)
      changed = true
    }
    if (!changed) break
  }
}

async function placeInto(tx: Prisma.TransactionClient, matchId: number, slot: number, player: { id: number; name: string; seed: number | null }): Promise<void> {
  const data = slot === 0 ? { homeEntrantId: player.id, homeUsername: player.name, homeSeed: player.seed } : { awayEntrantId: player.id, awayUsername: player.name, awaySeed: player.seed }
  await tx.seasonPlayoffMatch.update({ where: { id: matchId }, data })
}

export async function seasonHasDraft(seasonId: number): Promise<boolean> {
  return (await prisma.seasonPlayoffMatch.count({ where: { seasonId } })) > 0
}

/** Publish the draft bracket publicly and lock participants/seeds/type; go live. */
export async function startSeasonPlayoffs(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  const s = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (s?.lifecycleState !== 'PLAYOFF_SETUP') return { ok: false, error: 'Start playoffs from the playoff setup phase.' }
  const count = await prisma.seasonPlayoffMatch.count({ where: { seasonId } })
  if (count === 0) return { ok: false, error: 'Generate the bracket before starting the playoffs.' }

  const { startReadiness } = await import('./playoff-topology')
  let refusal: string | null = null
  await prisma.$transaction(async (tx) => {
    /*
     * Checked again, here, holding the transaction.
     *
     * The page checked before drawing the button, and that answer is already stale: another
     * administrator may have unticked a participant while this one was reading the confirmation.
     * Publishing is the irreversible half of the workflow, so the condition that decides it is the
     * one evaluated against the rows being written, not the ones that were rendered.
     */
    const ready = await startReadiness(seasonId, tx)
    if (!ready.ok) { refusal = ready.problems.join(' '); return }
    // Byes are awarded HERE rather than at generation, so the draft stayed freely editable right up
    // to this point. Whoever is sitting alone in an entry slot now is who advances.
    await settleByes(tx, seasonId)
    await tx.seasonPlayoffMatch.updateMany({ where: { seasonId }, data: { published: true } })
    await recordAudit(actor, { action: 'season.playoff.start', entity: 'Season', entityId: seasonId }, tx)
    const t = await transitionSeasonState(actor, seasonId, 'PLAYOFFS_LIVE', { tx })
    if (!t.ok) throw new Error(t.error)
  })
  if (refusal) return { ok: false, error: refusal }
  return { ok: true }
}

// ---- Live results + advancement + downstream rebuild ----------------------

export interface DownstreamWarning { affected: { id: number; label: string }[] }

/** Record a playoff result. Equal scores rejected (no playoff draw); 0–0/blank leaves it unplayed.
 *  Advances the winner (and DE loser). Editing a completed match that fed downstream clears + rebuilds
 *  only the affected path (pass `confirmRebuild` after showing the warning). */
export async function recordSeasonPlayoffResult(
  actor: Actor,
  matchId: number,
  homeGames: number,
  awayGames: number,
  opts: { confirmRebuild?: boolean; note?: string | null; expectedUpdatedAt?: string } = {},
): Promise<{ ok: boolean; error?: string; conflict?: boolean; warning?: DownstreamWarning; preserved?: number; needsReview?: number }> {
  const m = await prisma.seasonPlayoffMatch.findUnique({ where: { id: matchId } })
  if (!m) return { ok: false, error: 'Match not found.' }
  // Stale-edit protection: reject if the matchup changed after the admin loaded it.
  if (opts.expectedUpdatedAt && m.updatedAt.toISOString() !== opts.expectedUpdatedAt) {
    return { ok: false, conflict: true, error: 'This matchup was updated elsewhere. Refresh before saving.' }
  }
  const season = await prisma.season.findUnique({ where: { id: m.seasonId }, select: { lifecycleState: true } })
  if (season?.lifecycleState !== 'PLAYOFFS_LIVE') return { ok: false, error: 'Playoffs are not live.' }
  if (m.homeEntrantId == null || m.awayEntrantId == null) return { ok: false, error: 'Both players must be determined first.' }
  const v = validateResult(m.homeEntrantId, m.awayEntrantId, homeGames, awayGames, { allowDraw: false })
  if (!v.ok) return { ok: false, error: v.error } // equal scores are rejected here (no playoff draw)

  const winnerId = v.winnerRegistrationId!
  const wasDecided = m.winnerEntrantId != null
  // A correction only needs a downstream rebuild when the WINNER actually changes (a score-only edit
  // that keeps the same winner leaves the bracket structure intact).
  const winnerChanged = wasDecided && m.winnerEntrantId !== winnerId
  if (winnerChanged && !opts.confirmRebuild) {
    const affected = await downstreamMatches(m.seasonId, m)
    if (affected.length) return { ok: false, warning: { affected: affected.map((x) => ({ id: x.id, label: x.label ?? `Round ${x.round}` })) } }
  }

  const winnerHome = winnerId === m.homeEntrantId
  const winnerName = winnerHome ? m.homeUsername! : m.awayUsername!
  const winnerSeed = winnerHome ? m.homeSeed : m.awaySeed
  const loserId = winnerHome ? m.awayEntrantId : m.homeEntrantId
  const loserName = winnerHome ? m.awayUsername! : m.homeUsername!
  const loserSeed = winnerHome ? m.awaySeed : m.homeSeed

  let reconciled = { preserved: 0, flagged: 0 }
  await prisma.$transaction(async (tx) => {
    const { snapshotAndClearDownstream, reconcileDownstream } = await import('./playoff-correction')
    // Remembered before the chain is cleared, so a downstream result between two players the
    // correction does not touch can be put back rather than re-entered by hand.
    const snapshots = winnerChanged ? await snapshotAndClearDownstream(tx, m.seasonId, m) : []
    // Entering a real result is exactly what clears a review flag on this match.
    await tx.seasonPlayoffMatch.update({ where: { id: matchId }, data: { homeGames, awayGames, winnerEntrantId: winnerId, status: 'COMPLETED', verification: 'VERIFIED', completedAt: new Date(), needsReview: false } })
    // Re-advance only when the winner changed (or this is the first result); a same-winner score edit
    // leaves the already-seated downstream players untouched.
    if (!wasDecided || winnerChanged) {
      if (m.feedsMatchId != null) await placeInto(tx, m.feedsMatchId, m.feedsSlot ?? 0, { id: winnerId, name: winnerName, seed: winnerSeed })
      if (m.loserFeedsMatchId != null) await placeInto(tx, m.loserFeedsMatchId, m.loserFeedsSlot ?? 0, { id: loserId, name: loserName, seed: loserSeed })
      await settleByes(tx, m.seasonId)
    }
    // After the new winner has advanced: restore what still describes a real matchup, flag the rest.
    if (snapshots.length) reconciled = await reconcileDownstream(tx, snapshots)
    await recordAudit(actor, {
      action: wasDecided ? 'season.playoff.correct' : 'season.playoff.result',
      entity: 'Season', entityId: m.seasonId,
      oldValue: wasDecided ? { matchId, home: m.homeGames, away: m.awayGames, winnerEntrantId: m.winnerEntrantId } : undefined,
      newValue: {
        matchId, home: homeGames, away: awayGames, winnerEntrantId: winnerId, winnerChanged,
        // The impact, in the audit trail: how much survived and how much a person now has to settle.
        downstreamPreserved: reconciled.preserved, downstreamNeedsReview: reconciled.flagged,
      },
      reason: opts.note?.trim() || undefined,
    }, tx)
  })
  return { ok: true, preserved: reconciled.preserved, needsReview: reconciled.flagged }
}

/** Every match reachable downstream of `m` (winner + DE loser paths). */
async function downstreamMatches(seasonId: number, m: { feedsMatchId: number | null; loserFeedsMatchId: number | null }): Promise<{ id: number; label: string | null; round: number }[]> {
  const all = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId }, select: { id: true, label: true, round: true, feedsMatchId: true, loserFeedsMatchId: true } })
  const byId = new Map(all.map((x) => [x.id, x]))
  const out: { id: number; label: string | null; round: number }[] = []
  const seen = new Set<number>()
  const queue = [m.feedsMatchId, m.loserFeedsMatchId].filter((x): x is number => x != null)
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = byId.get(id)
    if (!node) continue
    out.push({ id: node.id, label: node.label, round: node.round })
    if (node.feedsMatchId != null) queue.push(node.feedsMatchId)
    if (node.loserFeedsMatchId != null) queue.push(node.loserFeedsMatchId)
  }
  return out
}

/** Clear the result of every match downstream of `m`, plus ONLY the incoming slots along the changed
 *  path. A slot seated from OUTSIDE this path (a bye winner, a match on another branch) is left in
 *  place — so correcting one result never evicts an unrelated player who happens to share the next
 *  matchup (the georgiapoolking→missy / travis-bye bug). */
// ---- Renderer view --------------------------------------------------------

function columnName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round
  if (round >= 201) return 'Grand Final'
  if (round >= 101) return `Losers R${round - 100}`
  if (fromEnd === 0) return 'Final'
  if (fromEnd === 1) return 'Semifinals'
  if (fromEnd === 2) return 'Quarterfinals'
  if (fromEnd === 3) return 'Round of 16'
  return `Round ${round}`
}

/** Build the shared bracket renderer's BracketRound[] from the Season's playoff matches. */
/**
 * Record a playoff match won by forfeit.
 *
 * ── Why this is not a score ──────────────────────────────────────────────────────────────────────
 * A forfeit decides who advances and nothing else. Writing it as 7-0, which is how it is often
 * described out loud, would put seven games that were never played into the winner's differential,
 * their game-win percentage and their rating — and take seven off somebody who never sat down. So
 * the games stay null and `forfeitEntrantId` carries the fact.
 *
 * Everything after that is identical to a played result: the same advancement, the same downstream
 * rebuild when a correction changes the winner, the same bye settlement. That shared tail is why
 * this lives beside `recordSeasonPlayoffResult` rather than in a component somewhere.
 */
export async function recordSeasonPlayoffForfeit(
  actor: Actor,
  matchId: number,
  forfeiter: 'home' | 'away',
  opts: { confirmRebuild?: boolean; note?: string | null; expectedUpdatedAt?: string } = {},
): Promise<{ ok: boolean; error?: string; conflict?: boolean; warning?: DownstreamWarning; preserved?: number; needsReview?: number }> {
  const m = await prisma.seasonPlayoffMatch.findUnique({ where: { id: matchId } })
  if (!m) return { ok: false, error: 'Match not found.' }
  if (opts.expectedUpdatedAt && m.updatedAt.toISOString() !== opts.expectedUpdatedAt) {
    return { ok: false, conflict: true, error: 'This matchup was updated elsewhere. Refresh before saving.' }
  }
  const season = await prisma.season.findUnique({ where: { id: m.seasonId }, select: { lifecycleState: true } })
  if (season?.lifecycleState !== 'PLAYOFFS_LIVE') return { ok: false, error: 'Playoffs are not live.' }
  if (m.homeEntrantId == null || m.awayEntrantId == null) {
    return { ok: false, error: 'Both players must be determined first.' }
  }

  const forfeiterId = forfeiter === 'home' ? m.homeEntrantId : m.awayEntrantId
  const winnerId = forfeiter === 'home' ? m.awayEntrantId : m.homeEntrantId
  const winnerHome = winnerId === m.homeEntrantId
  const winnerName = winnerHome ? m.homeUsername! : m.awayUsername!
  const winnerSeed = winnerHome ? m.homeSeed : m.awaySeed
  const loserName = winnerHome ? m.awayUsername! : m.homeUsername!
  const loserSeed = winnerHome ? m.awaySeed : m.homeSeed

  const wasDecided = m.winnerEntrantId != null
  const winnerChanged = wasDecided && m.winnerEntrantId !== winnerId
  if (winnerChanged && !opts.confirmRebuild) {
    const affected = await downstreamMatches(m.seasonId, m)
    if (affected.length) return { ok: false, warning: { affected: affected.map((x) => ({ id: x.id, label: x.label ?? `Round ${x.round}` })) } }
  }

  let reconciledFf = { preserved: 0, flagged: 0 }
  await prisma.$transaction(async (tx) => {
    const { snapshotAndClearDownstream, reconcileDownstream } = await import('./playoff-correction')
    const snapshots = winnerChanged ? await snapshotAndClearDownstream(tx, m.seasonId, m) : []
    await tx.seasonPlayoffMatch.update({
      where: { id: matchId },
      data: {
        // No games, in either column: the match produced none.
        homeGames: null, awayGames: null,
        winnerEntrantId: winnerId, forfeitEntrantId: forfeiterId,
        status: 'FORFEIT', verification: 'VERIFIED', completedAt: new Date(), needsReview: false,
      },
    })
    if (!wasDecided || winnerChanged) {
      if (m.feedsMatchId != null) await placeInto(tx, m.feedsMatchId, m.feedsSlot ?? 0, { id: winnerId, name: winnerName, seed: winnerSeed })
      if (m.loserFeedsMatchId != null) await placeInto(tx, m.loserFeedsMatchId, m.loserFeedsSlot ?? 0, { id: forfeiterId, name: loserName, seed: loserSeed })
      await settleByes(tx, m.seasonId)
    }
    if (snapshots.length) reconciledFf = await reconcileDownstream(tx, snapshots)
    await recordAudit(actor, {
      action: wasDecided ? 'season.playoff.correct' : 'season.playoff.forfeit',
      entity: 'Season', entityId: m.seasonId,
      oldValue: wasDecided ? { matchId, home: m.homeGames, away: m.awayGames, winnerEntrantId: m.winnerEntrantId } : undefined,
      newValue: {
        matchId, forfeit: forfeiter, winnerEntrantId: winnerId, winnerChanged,
        downstreamPreserved: reconciledFf.preserved, downstreamNeedsReview: reconciledFf.flagged,
      },
      reason: opts.note?.trim() || undefined,
    }, tx)
  })
  return { ok: true, preserved: reconciledFf.preserved, needsReview: reconciledFf.flagged }
}

export async function seasonPlayoffRounds(seasonId: number): Promise<BracketRound[]> {
  const rows = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })
  if (!rows.length) return []
  const entrantIds = [...new Set(rows.flatMap((r) => [r.homeEntrantId, r.awayEntrantId]).filter((x): x is number => x != null))]
  // Resolve BOTH halves of the identity from the entrant rather than trusting the denormalised
  // name copied onto the match: the ID is what the bracket leads with, and a later rename must not
  // leave the bracket showing a stale one.
  const ents = await prisma.seasonEntrant.findMany({
    where: { id: { in: entrantIds } },
    select: { id: true, cueverseId: true, displayName: true, username: true },
  })
  const cueverseOf = new Map(ents.map((e) => [e.id, e.cueverseId]))
  const preferredOf = new Map(ents.map((e) => [e.id, e.displayName ?? e.username]))
  // The seed is read from the ENTRANT, so it is the same in every round the player reaches and
  // cannot be lost by moving them between slots. The per-match column is only a fallback for
  // brackets built before seeds were stored on the player.
  const seedOf = await seedsByEntrant(prisma, seasonId)
  const wbRounds = rows.filter((r) => r.round < 100).map((r) => r.round)
  const totalWb = wbRounds.length ? Math.max(...wbRounds) : 0

  const byRound = new Map<number, typeof rows>()
  for (const r of rows) { if (!byRound.has(r.round)) byRound.set(r.round, []); byRound.get(r.round)!.push(r) }
  const out: BracketRound[] = []
  for (const round of [...byRound.keys()].sort((a, b) => a - b)) {
    const matches: ViewMatch[] = byRound.get(round)!.sort((a, b) => a.slot - b.slot).map((r) => {
      const slot = (id: number | null, name: string | null, seed: number | null, games: number | null) => {
        if (id == null && name == null) return undefined
        if (name === 'Bye') return { name: 'Bye' }
        const handle = id != null ? cueverseOf.get(id) ?? undefined : undefined
        const preferred = (id != null ? preferredOf.get(id) : null) ?? name ?? 'TBD'
        const shownSeed = (id != null ? seedOf.get(id) : null) ?? seed
        return { name: preferred, ...(handle ? { handle, slug: handle } : {}), ...(shownSeed != null ? { seed: shownSeed } : {}), ...(games != null ? { score: games } : {}) }
      }
      const m: ViewMatch = { id: r.id, updatedAt: r.updatedAt.toISOString() }
      const a = slot(r.homeEntrantId, r.homeUsername, r.homeSeed, r.homeGames)
      const b = slot(r.awayEntrantId, r.awayUsername, r.awaySeed, r.awayGames)
      if (a) m.a = a
      if (b) m.b = b
      if (r.winnerEntrantId != null) m.winner = r.winnerEntrantId === r.homeEntrantId ? 'a' : 'b'
      return m
    })
    out.push({ name: columnName(round, totalWb), matches })
  }
  return out
}

/** The Season champion (once the final is decided), for close/summary. Returns null until decided. */
export async function seasonChampion(seasonId: number): Promise<{
  championId: number
  championName: string
  /** The champion's CueVerse ID — the identity, not the seeded display name. */
  championCueverseId: string | null
  runnerUpName: string | null
  runnerUpCueverseId: string | null
  finalScore: string | null
} | null> {
  const rows = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId } })
  if (!rows.length) return null
  const maxRound = Math.max(...rows.map((r) => r.round))
  const final = rows.filter((r) => r.round === maxRound).sort((a, b) => a.slot - b.slot)[0]
  if (!final || final.winnerEntrantId == null) return null
  const champHome = final.winnerEntrantId === final.homeEntrantId
  /*
   * The handles, looked up per entrant.
   *
   * A playoff match stores the username it was seeded with, which names a person only if no two of
   * them share it. Crowning "Chris" is exactly the case this site has six of.
   */
  const championEntrantId = final.winnerEntrantId
  const runnerUpEntrantId = champHome ? final.awayEntrantId : final.homeEntrantId
  const ents = await prisma.seasonEntrant.findMany({
    where: { id: { in: [championEntrantId, runnerUpEntrantId].filter((x): x is number => x != null) } },
    select: { id: true, cueverseId: true },
  })
  const handleOf = new Map(ents.map((e) => [e.id, e.cueverseId]))

  return {
    championId: final.winnerEntrantId,
    championName: (champHome ? final.homeUsername : final.awayUsername) ?? 'Champion',
    championCueverseId: handleOf.get(championEntrantId) ?? null,
    runnerUpName: (champHome ? final.awayUsername : final.homeUsername) ?? null,
    runnerUpCueverseId: runnerUpEntrantId != null ? handleOf.get(runnerUpEntrantId) ?? null : null,
    finalScore: final.homeGames != null && final.awayGames != null ? `${Math.max(final.homeGames, final.awayGames)}–${Math.min(final.homeGames, final.awayGames)}` : null,
  }
}
