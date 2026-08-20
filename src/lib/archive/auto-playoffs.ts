import 'server-only'

import { prisma } from '@/lib/prisma'
import { recordAudit } from '@/lib/competition/audit'
import { generateSeasonBracket, seasonHasDraft, setSeasonBracketSlot } from '@/lib/seasons/playoffs'
import { manifestEntry, type ManifestEntry } from './manifest'
import { matchHandles, type EntrantIdentity } from './matching'
import { isBlocked, type AutoAssignBlocked } from './auto-assign'

/**
 * Build Playoff Bracket: select the archived playoff field and place it, as far as the source allows.
 *
 * ── It stops at PLAYOFF_SETUP, always ────────────────────────────────────────────────────────────
 * This selects participants, generates the bracket and fills the slots the archive documents. It does
 * not start the playoffs, publish the bracket, enter a score, complete the Season or touch the
 * Rankings. Reviewing the arrangement and pressing Start Playoffs stays a human act, because that is
 * the step that locks the field permanently.
 *
 * ── Two grades of source, treated differently ────────────────────────────────────────────────────
 * 22 Seasons carry the full round-by-round topology: bracket size, slots, byes and later-round starts
 * are all real. The other 66 carry a participant list and an occurrence-count heuristic the archive
 * viewer invented — so those select the right people and leave every position empty. Guessing there
 * would put players in slots nobody recorded, and afterwards it would be indistinguishable from
 * evidence.
 */

export interface PlayoffPlan {
  blocked?: false
  templateKey: string
  placement: 'exact' | 'participants-only' | 'none'
  /**
   * Whether the archived positions can actually be reproduced here.
   *
   * True only when the source recorded a real topology AND every one of its playoff players is an
   * entrant. Exact placement in a half-populated Season would mean a different-sized bracket, where
   * the archived slot numbers point at matches that do not exist.
   */
  canPlaceExactly: boolean
  sourceConfidence: string | null
  bracketSize: number | null
  /** Entrants the archive documents as playing in the playoffs. */
  include: {
    entrantId: number
    rawHandle: string
    displayName: string | null
    cueverseId: string | null
    seed: number | null
    /** Exact first-round slot, when the topology is known. */
    matchNo: number | null
    side: 'a' | 'b' | null
    bye: boolean
    firstRound: number
    alreadyIncluded: boolean
  }[]
  /** Entrants NOT in the archived playoff field; they will be unchecked. */
  exclude: { entrantId: number; displayName: string | null; cueverseId: string | null; alreadyExcluded: boolean }[]
  /** Archived playoff players who are not entrants in this Season. */
  missing: { rawHandle: string }[]
  ambiguous: { rawHandle: string; candidates: { displayName: string | null; cueverseId: string | null }[] }[]
  /** A draft bracket already exists and applying would rearrange it. */
  existingDraft: boolean
  draftPlacements: number
  /** Refusals that stop Apply entirely. */
  refusal: string | null
  unresolved: string[]
}

export interface PlayoffApplyResult {
  ok: boolean
  error?: string
  selected: number
  excluded: number
  placed: number
  unresolvedSlots: number
  missing: number
  ambiguous: number
}

async function guardPlayoffs(seasonId: number): Promise<
  { blocked?: false; ok: true; entry: ManifestEntry; lifecycleState: string } | AutoAssignBlocked
> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { archiveTemplateKey: true, lifecycleState: true },
  })
  if (!season) return { blocked: true, reason: 'That Season no longer exists.' }
  if (!season.archiveTemplateKey) return { blocked: true, reason: 'This Season has no verified archive template.' }

  const entry = manifestEntry(season.archiveTemplateKey)
  if (!entry) return { blocked: true, reason: 'No verified archive data for this Season.' }
  if (entry.playoff.placement === 'none') {
    return { blocked: true, reason: 'The archive holds no playoff record for this Season.' }
  }

  /*
   * PLAYOFF_SETUP only.
   *
   * Before it, the group stage is still deciding who qualifies. After it, the bracket is published
   * and people are playing in it — rearranging then would move somebody out of a match they have
   * already started.
   */
  if (season.lifecycleState !== 'PLAYOFF_SETUP') {
    return {
      blocked: true,
      reason: season.lifecycleState === 'PLAYOFFS_LIVE' || season.lifecycleState === 'COMPLETED'
        ? 'The playoffs have already started. The bracket can no longer be rebuilt from the archive.'
        : 'Close the group stage and enter playoff setup first.',
    }
  }
  return { ok: true, entry, lifecycleState: season.lifecycleState }
}

export async function previewPlayoffBracket(seasonId: number): Promise<PlayoffPlan | AutoAssignBlocked> {
  const g = await guardPlayoffs(seasonId)
  if (isBlocked(g)) return g
  const { entry } = g
  const po = entry.playoff

  const entrantRows = await prisma.seasonEntrant.findMany({
    where: { seasonId, status: { not: 'WITHDRAWN' } },
    select: { id: true, playerId: true, displayName: true, username: true, cueverseId: true, playoffIncluded: true },
  })
  const players = await prisma.player.findMany({
    where: { id: { in: entrantRows.map((e) => e.playerId).filter((x): x is string => !!x) } },
    select: { id: true, primaryName: true, cueverseId: true, aliases: { select: { alias: true, aliasType: true } } },
  })
  const playerById = new Map(players.map((p) => [p.id, p]))

  const identities: EntrantIdentity[] = entrantRows.map((e) => {
    const p = e.playerId ? playerById.get(e.playerId) : undefined
    return {
      entrantId: e.id,
      playerId: e.playerId ?? String(e.id),
      displayName: p?.primaryName ?? e.displayName,
      cueverseId: p?.cueverseId ?? e.cueverseId ?? e.username,
      aliases: (p?.aliases ?? []).map((a) => a.alias),
      archiveHandles: (p?.aliases ?? []).filter((a) => a.aliasType === 'HANDLE').map((a) => a.alias),
    }
  })

  // Archived playoff people, matched against THIS Season's entrants only — never the wider database.
  const match = matchHandles(
    po.participants.map((p) => ({
      sourceId: p.sourceId, rawHandle: p.rawHandle, normalizedHandle: p.normalizedHandle,
      rawName: '', groupName: '-', slot: 0,
    })),
    identities,
  )
  const bySource = new Map(match.matched.map((m) => [m.sourceId, m]))
  const entrantById = new Map(entrantRows.map((e) => [e.id, e]))

  const include: PlayoffPlan['include'] = []
  for (const p of po.participants) {
    const m = bySource.get(p.sourceId)
    if (!m) continue
    const row = entrantById.get(m.entrantId)
    include.push({
      entrantId: m.entrantId,
      rawHandle: p.rawHandle,
      displayName: m.displayName,
      cueverseId: m.cueverseId,
      seed: p.seed,
      matchNo: p.matchNo,
      side: p.side,
      bye: p.bye,
      firstRound: p.firstRound,
      alreadyIncluded: !!row?.playoffIncluded,
    })
  }

  const includedIds = new Set(include.map((i) => i.entrantId))
  const exclude = entrantRows
    .filter((e) => !includedIds.has(e.id))
    .map((e) => {
      const p = e.playerId ? playerById.get(e.playerId) : undefined
      return {
        entrantId: e.id,
        displayName: p?.primaryName ?? e.displayName,
        cueverseId: p?.cueverseId ?? e.cueverseId ?? e.username,
        alreadyExcluded: !e.playoffIncluded,
      }
    })

  const missing = match.unresolved
    .filter((u) => u.reason === 'player-not-among-entrants')
    .map((u) => ({ rawHandle: u.rawHandle }))
  const ambiguous = match.unresolved
    .filter((u) => u.reason === 'multiple-possible-entrants')
    .map((u) => ({
      rawHandle: u.rawHandle,
      candidates: u.suggestions.map((s) => ({ displayName: s.displayName, cueverseId: s.cueverseId })),
    }))

  const draftPlacements = await prisma.seasonPlayoffMatch.count({
    where: { seasonId, OR: [{ homeEntrantId: { not: null } }, { awayEntrantId: { not: null } }] },
  })
  const hasDraft = await seasonHasDraft(seasonId)

  /*
   * A bracket with a result in it is not a draft any more.
   *
   * Rebuilding it would move players out of matches that have already been played, so this refuses
   * rather than asking for confirmation — there is no version of that the operator wants.
   */
  const played = await prisma.seasonPlayoffMatch.count({
    where: { seasonId, OR: [{ homeGames: { not: null } }, { awayGames: { not: null } }, { winnerEntrantId: { not: null } }] },
  })

  /*
   * The archived slot numbers only mean something if the whole archived field is here.
   *
   * A bracket is sized to the players in it: 25 players make a 32-bracket, four players make a
   * four-bracket, and "first-round match 10" does not exist in the second one. So if any archived
   * playoff player has no entrant, the recorded positions cannot be reproduced — and putting the
   * handful who are here into whatever slots do exist would invent a draw the archive never
   * recorded. The field is still selected; the seating waits until the people do.
   */
  const fieldComplete = include.length === po.participants.length && missing.length === 0 && ambiguous.length === 0
  const canPlaceExactly = po.placement === 'exact' && fieldComplete

  const unresolved = [...po.unresolved]
  if (po.placement === 'participants-only') {
    unresolved.push('Positions will be left empty for you to set by hand.')
  }
  if (po.placement === 'exact' && !fieldComplete && include.length > 0) {
    unresolved.push(
      `The archived bracket held ${po.participants.length} players in a ${po.bracketSize}-place draw, and ` +
      `${po.participants.length - include.length} of them are not entrants here yet. The right people will be ` +
      'selected, but positions will be left empty — add the missing accounts and run this again to place them.',
    )
  }
  if (include.length === 0) {
    unresolved.push('None of the archived playoff players is an entrant in this Season yet.')
  }

  return {
    templateKey: entry.templateKey,
    placement: po.placement,
    canPlaceExactly,
    sourceConfidence: po.sourceConfidence,
    bracketSize: po.bracketSize,
    include,
    exclude,
    missing,
    ambiguous,
    existingDraft: hasDraft,
    draftPlacements,
    refusal: played > 0
      ? `This bracket already holds ${played} recorded result(s). It cannot be rebuilt from the archive.`
      : include.length === 0
        ? 'There is nobody to place: none of the archived playoff players is an entrant yet.'
        : null,
    unresolved,
  }
}

export async function applyPlayoffBracket(
  actor: { userId: number; username: string },
  seasonId: number,
  opts: { replaceDraft?: boolean } = {},
): Promise<PlayoffApplyResult> {
  const preview = await previewPlayoffBracket(seasonId)
  if (isBlocked(preview)) {
    return { ok: false, error: preview.reason, selected: 0, excluded: 0, placed: 0, unresolvedSlots: 0, missing: 0, ambiguous: 0 }
  }
  if (preview.refusal) {
    return { ok: false, error: preview.refusal, selected: 0, excluded: 0, placed: 0, unresolvedSlots: 0, missing: 0, ambiguous: 0 }
  }
  // Replacing somebody's arranged draft is a separate, explicit decision.
  if (preview.existingDraft && preview.draftPlacements > 0 && !opts.replaceDraft) {
    return {
      ok: false,
      error: `A draft bracket already holds ${preview.draftPlacements} placement(s). Confirm replacement to rebuild it from the archive.`,
      selected: 0, excluded: 0, placed: 0, unresolvedSlots: 0, missing: 0, ambiguous: 0,
    }
  }

  let placed = 0

  await prisma.$transaction(async (tx) => {
    const season = await tx.season.findUniqueOrThrow({
      where: { id: seasonId }, select: { lifecycleState: true, archiveTemplateKey: true },
    })
    if (season.lifecycleState !== 'PLAYOFF_SETUP') {
      throw new Error('This Season left playoff setup while the preview was open. Nothing was changed.')
    }
    if (season.archiveTemplateKey !== preview.templateKey) {
      throw new Error('This Season\'s archive template changed while the preview was open. Nothing was changed.')
    }

    // The field: in for the archived players, out for everyone else.
    await tx.seasonEntrant.updateMany({
      where: { id: { in: preview.include.map((i) => i.entrantId) } },
      data: { playoffIncluded: true, qualification: 'AUTOMATIC', qualificationReason: null },
    })
    if (preview.exclude.length > 0) {
      await tx.seasonEntrant.updateMany({
        where: { id: { in: preview.exclude.map((e) => e.entrantId) } },
        data: { playoffIncluded: false },
      })
    }

    await recordAudit(actor, {
      action: 'season.archive.autoplayoffs',
      entity: 'Season',
      entityId: seasonId,
      newValue: {
        templateKey: preview.templateKey,
        placement: preview.placement,
        selected: preview.include.length,
        excluded: preview.exclude.length,
        bracketSize: preview.bracketSize,
        missing: preview.missing.length,
        ambiguous: preview.ambiguous.length,
        replacedDraft: !!opts.replaceDraft,
      },
    }, tx)
  }, { timeout: 120_000 })

  /*
   * The bracket is built by the site's own generator and seated by the site's own placement action.
   *
   * ── Why both, and in this order ──────────────────────────────────────────────────────────────────
   * `generateSeasonBracket` owns the SHAPE: how many rounds, how the ties feed forward, where the
   * byes fall. It seats people by the group-derived seeding, which is the right answer for a Season
   * being played and the wrong one for a Season being reconstructed — the archive already recorded
   * who met whom, and that is evidence, not something to re-derive from the standings.
   *
   * So the generator draws the bracket, then each archived player is moved into their recorded seat
   * through `setSeasonBracketSlot` — the same call the drag-and-drop editor makes, with the same
   * guards. Nothing here duplicates the bracket engine; it uses two parts of it in sequence.
   *
   * Only when the positions can actually be reproduced — see `canPlaceExactly`. With a
   * participants-only source, or an exact one whose field is not all here yet, there is no seating
   * this can honour, so the field is selected and the seats are left for the operator: an honest
   * empty slot beats an invented one.
   */
  let unresolvedSlots = preview.include.length
  if (preview.canPlaceExactly) {
    const gen = await generateSeasonBracket(actor, seasonId)
    if (!gen.ok) {
      return {
        ok: false, error: gen.error ?? 'The bracket could not be generated.',
        selected: preview.include.length, excluded: preview.exclude.length,
        placed: 0, unresolvedSlots: preview.include.length,
        missing: preview.missing.length, ambiguous: preview.ambiguous.length,
      }
    }

    /*
     * Archived seeds are written AFTER generating, because generating persists its own.
     *
     * `generateSeasonBracket` densifies the group-derived order into bracket seeds 1..N and saves
     * them. Writing the archived seeds first would simply have them overwritten; writing them now
     * means the numbers beside each name are the ones the archive recorded, and the placement below
     * picks them up as it seats people.
     */
    for (const i of preview.include) {
      if (i.seed == null) continue
      await prisma.seasonEntrant.update({ where: { id: i.entrantId }, data: { playoffSeed: i.seed } })
    }

    const firstRound = await prisma.seasonPlayoffMatch.findMany({
      where: { seasonId, round: 1 },
      select: { id: true, slot: true },
      orderBy: { slot: 'asc' },
    })
    // The planner numbers round-one slots from zero; the archive numbers its matches from one.
    const matchBySlot = new Map(firstRound.map((m) => [m.slot + 1, m.id]))

    // Clear the generator's seating first, so a player it happened to seat correctly is not left
    // behind in a slot the archive gives to somebody else.
    await prisma.seasonPlayoffMatch.updateMany({
      where: { seasonId, round: 1 },
      data: { homeEntrantId: null, awayEntrantId: null, homeUsername: null, awayUsername: null, homeSeed: null, awaySeed: null },
    })

    let seated = 0
    for (const i of preview.include) {
      // Somebody who entered in a later round has no first-round seat to take. Their slot stays
      // empty and is reported as unresolved rather than guessed at.
      if (i.firstRound !== 1 || i.matchNo == null || i.side == null) continue
      const matchId = matchBySlot.get(i.matchNo)
      if (matchId == null) continue
      const r = await setSeasonBracketSlot(actor, seasonId, matchId, i.side === 'a' ? 'home' : 'away', i.entrantId)
      if (r.ok) seated++
    }

    /*
     * A bye is an empty seat opposite a seeded player, and it has to say so.
     *
     * The generator labels its own byes as it builds; clearing the seating above wiped those labels,
     * so they are restored here for the first-round ties the archive recorded as walkovers. Without
     * it a bye is indistinguishable from a slot nobody has filled in yet.
     */
    for (const i of preview.include) {
      if (!i.bye || i.firstRound !== 1 || i.matchNo == null || i.side == null) continue
      const matchId = matchBySlot.get(i.matchNo)
      if (matchId == null) continue
      await prisma.seasonPlayoffMatch.update({
        where: { id: matchId },
        data: i.side === 'a' ? { awayUsername: 'Bye' } : { homeUsername: 'Bye' },
      })
    }

    placed = seated
    unresolvedSlots = preview.include.length - seated
  }

  return {
    ok: true,
    selected: preview.include.length,
    excluded: preview.exclude.length,
    placed,
    unresolvedSlots,
    missing: preview.missing.length,
    ambiguous: preview.ambiguous.length,
  }
}

/** Whether the button belongs on the playoff screen, and what to say when it cannot run. */
export async function playoffBracketAvailability(seasonId: number): Promise<{ show: boolean; disabledReason: string | null }> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId }, select: { archiveTemplateKey: true, lifecycleState: true },
  })
  if (!season?.archiveTemplateKey) return { show: false, disabledReason: null }

  const entry = manifestEntry(season.archiveTemplateKey)
  if (!entry) return { show: false, disabledReason: null }
  if (season.lifecycleState !== 'PLAYOFF_SETUP') return { show: false, disabledReason: null }

  if (entry.playoff.placement === 'none') {
    return { show: true, disabledReason: 'The archive holds no playoff record for this Season.' }
  }
  return { show: true, disabledReason: null }
}
