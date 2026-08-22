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

/**
 * Where the archive template comes from.
 *
 * ── Why this is a parameter ──────────────────────────────────────────────────────────────────────
 * Everything below is a pure decision about one template and one Season's rows. Nothing in it needs
 * to know that templates normally live in a JSON file on disk — but because it CALLED the file
 * loader directly, none of it could be exercised without a real archived Season, and every real
 * template key belongs to a Season somebody's history depends on.
 *
 * So the lookup is injected. Production passes nothing and gets `manifestEntry`, which reads the
 * manifest exactly as before; a test passes a synthetic template and exercises the same code with
 * no archive and no Season at risk. Not a global switch, not a test-only branch inside the engine —
 * an argument, typed, with the real implementation as its default.
 */
export type TemplateSource = (templateKey: string) => ManifestEntry | null

async function guardPlayoffs(
  seasonId: number,
  templateSource: TemplateSource = manifestEntry,
): Promise<
  { blocked?: false; ok: true; entry: ManifestEntry; lifecycleState: string } | AutoAssignBlocked
> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { archiveTemplateKey: true, lifecycleState: true },
  })
  if (!season) return { blocked: true, reason: 'That Season no longer exists.' }
  if (!season.archiveTemplateKey) return { blocked: true, reason: 'This Season has no verified archive template.' }

  const entry = templateSource(season.archiveTemplateKey)
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

export async function previewPlayoffBracket(
  seasonId: number,
  templateSource: TemplateSource = manifestEntry,
): Promise<PlayoffPlan | AutoAssignBlocked> {
  const g = await guardPlayoffs(seasonId, templateSource)
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

/**
 * Select Playoff Entrants — who qualified, and nothing else.
 *
 * ── Why this is its own operation ────────────────────────────────────────────────────────────────
 * These two decisions used to be one button. Choosing the playoff field and reproducing the archived
 * draw are different questions with different evidence and different risks: the first is a set of
 * checkboxes and is safe to redo, the second rearranges a bracket somebody may have arranged by
 * hand. Bundling them meant you could not do the safe one without risking the other, and it meant a
 * Season whose archive records participants but no topology went through bracket code for no reason.
 *
 * So this writes `playoffIncluded` and writes nothing else. No bracket is generated, no slot moves,
 * no lifecycle changes. Applying it twice is the same as applying it once.
 *
 * ── The stale-preview problem ────────────────────────────────────────────────────────────────────
 * A preview is a photograph. Between taking it and acting on it the Season can leave playoff setup
 * or have its archive template changed, so the transaction re-reads both and refuses rather than
 * writing against a world that has moved.
 */
export async function applyArchiveSelection(
  actor: { userId: number; username: string },
  seasonId: number,
  templateSource: TemplateSource = manifestEntry,
): Promise<SelectionApplyResult> {
  const preview = await previewPlayoffBracket(seasonId, templateSource)
  if (isBlocked(preview)) return { ok: false, error: preview.reason, selected: 0, excluded: 0, missing: 0, ambiguous: 0 }
  if (preview.refusal) return { ok: false, error: preview.refusal, selected: 0, excluded: 0, missing: 0, ambiguous: 0 }

  /*
   * Nothing to do is a success, not a no-op error.
   *
   * Re-running this after it has already been applied must be silent and must not write an audit
   * entry: an operator checking their work should not manufacture a history of changes.
   */
  const toInclude = preview.include.filter((i) => !i.alreadyIncluded).map((i) => i.entrantId)
  const toExclude = preview.exclude.filter((e) => !e.alreadyExcluded).map((e) => e.entrantId)
  if (toInclude.length === 0 && toExclude.length === 0) {
    return {
      ok: true, selected: preview.include.length, excluded: preview.exclude.length,
      missing: preview.missing.length, ambiguous: preview.ambiguous.length, changed: 0,
    }
  }

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

    if (toInclude.length > 0) {
      await tx.seasonEntrant.updateMany({
        where: { id: { in: toInclude } },
        data: { playoffIncluded: true, qualification: 'AUTOMATIC', qualificationReason: null },
      })
    }
    if (toExclude.length > 0) {
      await tx.seasonEntrant.updateMany({ where: { id: { in: toExclude } }, data: { playoffIncluded: false } })
    }

    await recordAudit(actor, {
      action: 'season.archive.selection',
      entity: 'Season',
      entityId: seasonId,
      newValue: {
        templateKey: preview.templateKey,
        selected: preview.include.length,
        excluded: preview.exclude.length,
        changed: toInclude.length + toExclude.length,
        missing: preview.missing.length,
        ambiguous: preview.ambiguous.length,
      },
    }, tx)
  }, { timeout: 120_000 })

  return {
    ok: true, selected: preview.include.length, excluded: preview.exclude.length,
    missing: preview.missing.length, ambiguous: preview.ambiguous.length,
    changed: toInclude.length + toExclude.length,
  }
}

export interface SelectionApplyResult {
  ok: boolean
  error?: string
  selected: number
  excluded: number
  missing: number
  ambiguous: number
  /** How many entrants actually changed. Zero on a second application. */
  changed?: number
}

/**
 * Apply Archive Placement — reproduce the draw the archive recorded.
 *
 * ── What it needs before it will run ─────────────────────────────────────────────────────────────
 * A selected playoff field. Placement seats the people who are IN the playoffs, so running it
 * against an unselected field would either seat nobody or seat whoever happened to be ticked. It
 * refuses rather than quietly doing half the job.
 *
 * ── Why it may generate ──────────────────────────────────────────────────────────────────────────
 * The archive records who met whom, not how a bracket is wired. `generateSeasonBracket` owns the
 * shape — rounds, feeders, where byes fall — so the draft is drawn by the site's own generator and
 * only then re-seated from the archive. Nothing here duplicates the bracket engine; it uses two
 * parts of it in sequence, and the seating goes through `setSeasonBracketSlot`, the same call the
 * drag-and-drop editor makes, with the same entry-slot guards.
 *
 * ── Partial success is the normal case ───────────────────────────────────────────────────────────
 * Archives are incomplete. A player who cannot be resolved leaves their seat empty and is named in
 * the result; the run does not fail because of them. An honest empty slot beats an invented one, and
 * guessing to make the preview look complete is the one thing this must never do.
 */
export async function applyArchivePlacement(
  actor: { userId: number; username: string },
  seasonId: number,
  opts: { replaceDraft?: boolean } = {},
  templateSource: TemplateSource = manifestEntry,
): Promise<PlayoffApplyResult> {
  const empty = { selected: 0, excluded: 0, placed: 0, unresolvedSlots: 0, missing: 0, ambiguous: 0 }
  const preview = await previewPlayoffBracket(seasonId, templateSource)
  if (isBlocked(preview)) return { ok: false, error: preview.reason, ...empty }
  if (preview.refusal) return { ok: false, error: preview.refusal, ...empty }

  if (!preview.canPlaceExactly) {
    return {
      ok: false,
      error: 'The archive does not record enough of this playoff bracket to reproduce its positions. Select the field and arrange the draw by hand.',
      ...empty,
    }
  }

  // The field has to be chosen first — this seats the people who are in it.
  const selectedCount = await prisma.seasonEntrant.count({ where: { seasonId, playoffIncluded: true } })
  if (selectedCount === 0) {
    return { ok: false, error: 'Select the playoff entrants first, then apply the archived placement.', ...empty }
  }

  // Replacing somebody's arranged draft is a separate, explicit decision.
  if (preview.existingDraft && preview.draftPlacements > 0 && !opts.replaceDraft) {
    return {
      ok: false,
      error: `A draft bracket already holds ${preview.draftPlacements} placement(s). Confirm replacement to rebuild it from the archive.`,
      ...empty,
    }
  }

  /*
   * Revalidated here, not only in the preview.
   *
   * Generating and seating cannot all live inside one transaction — `generateSeasonBracket` and
   * `setSeasonBracketSlot` open their own — so the lifecycle and template are re-read immediately
   * before anything is written, and every seating call re-checks the slot it is given.
   */
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId }, select: { lifecycleState: true, archiveTemplateKey: true },
  })
  if (season.lifecycleState !== 'PLAYOFF_SETUP') {
    return { ok: false, error: 'This Season left playoff setup while the preview was open. Nothing was changed.', ...empty }
  }
  if (season.archiveTemplateKey !== preview.templateKey) {
    return { ok: false, error: 'This Season\'s archive template changed while the preview was open. Nothing was changed.', ...empty }
  }

  const gen = await generateSeasonBracket(actor, seasonId)
  if (!gen.ok) {
    return { ok: false, error: gen.error ?? 'The bracket could not be generated.', ...empty }
  }

  /*
   * Archived seeds are written AFTER generating, because generating persists its own.
   *
   * `generateSeasonBracket` densifies the group-derived order into bracket seeds 1..N and saves
   * them. Writing the archived seeds first would simply have them overwritten.
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
    // Somebody who entered in a later round has no first-round seat to take. Their slot stays empty
    // and is reported as unresolved rather than guessed at.
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
   * so they are restored for the first-round ties the archive recorded as walkovers. Without it a
   * bye is indistinguishable from a slot nobody has filled in yet.
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

  await recordAudit(actor, {
    action: 'season.archive.placement',
    entity: 'Season',
    entityId: seasonId,
    newValue: {
      templateKey: preview.templateKey,
      bracketSize: preview.bracketSize,
      placed: seated,
      unresolvedSlots: preview.include.length - seated,
      replacedDraft: !!opts.replaceDraft,
    },
  })

  return {
    ok: true,
    selected: preview.include.length,
    excluded: preview.exclude.length,
    placed: seated,
    unresolvedSlots: preview.include.length - seated,
    missing: preview.missing.length,
    ambiguous: preview.ambiguous.length,
  }
}

// ---------------------------------------------------------------------------------------------
// Place Entrants — seat the archived players on the bracket that is already there
// ---------------------------------------------------------------------------------------------

/**
 * The reason a single archived player could not be seated. Never a bare count: whoever is
 * reconstructing the Season has to be able to go and look the person up.
 */
export type PlacementSkipReason =
  | 'not-an-entrant'
  | 'ambiguous'
  | 'no-recorded-seat'
  | 'slot-not-in-bracket'
  | 'refused'

export interface PlacementPlan {
  blocked?: false
  templateKey: string
  bracketSize: number | null
  /** Seats that will be written: who goes where, in bracket order. */
  place: {
    entrantId: number
    rawHandle: string
    displayName: string | null
    cueverseId: string | null
    matchNo: number
    side: 'a' | 'b'
    seed: number | null
    bye: boolean
    /** Already in exactly this seat — applying changes nothing for them. */
    alreadyThere: boolean
  }[]
  /** Archived players this cannot confirm, each with the reason. */
  skipped: { rawHandle: string; displayName: string | null; reason: PlacementSkipReason; detail?: string }[]
  /**
   * Entrants sitting in a first-round seat by hand who are not part of the archived draw.
   *
   * Placing evicts them, because the archived arrangement is the thing being reproduced. They are
   * named so that is a decision rather than a surprise.
   */
  displaced: { entrantId: number; displayName: string | null; cueverseId: string | null }[]
  refusal: string | null
}

export interface PlacementApplyResult {
  ok: boolean
  error?: string
  placed: number
  skipped: number
  displaced: number
}

/**
 * Where each archived player belongs on the bracket in front of us.
 *
 * ── Not the same job as Build Playoff Bracket ────────────────────────────────────────────────────
 * That one picks the field and draws the bracket from scratch, and refuses unless every archived
 * player is present — an all-or-nothing rebuild. This is for the step after: the bracket exists,
 * somebody is part-way through arranging it by hand, and they want the archive to finish the job.
 * So it seats everyone it can confirm and names everyone it cannot, which is the only useful answer
 * when a Season is half-reconstructed.
 *
 * It never generates, never changes the field, never touches a later round. First-round seats only.
 */
export async function previewPlacement(
  seasonId: number,
  templateSource: TemplateSource = manifestEntry,
): Promise<PlacementPlan | AutoAssignBlocked> {
  const g = await guardPlayoffs(seasonId, templateSource)
  if (isBlocked(g)) return g
  const { entry } = g
  const po = entry.playoff

  if (po.placement !== 'exact') {
    return {
      blocked: true,
      reason:
        'The archive lists who played in this Season\u2019s playoffs but not where. There are no recorded positions to reproduce, so placing them would be guesswork.',
    }
  }

  const first = await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId, round: 1 },
    select: { id: true, slot: true, homeEntrantId: true, awayEntrantId: true, status: true, winnerEntrantId: true },
    orderBy: { slot: 'asc' },
  })
  if (first.length === 0) {
    return { blocked: true, reason: 'There is no draft bracket yet. Generate one first, then place the entrants on it.' }
  }
  if (first.some((m) => m.winnerEntrantId != null)) {
    return { blocked: true, reason: 'A first-round tie already has a result. Clear it before rearranging the draw.' }
  }

  // The planner numbers round-one slots from zero; the archive numbers its matches from one.
  const matchByNo = new Map(first.map((m) => [m.slot + 1, m]))

  const entrantRows = await prisma.seasonEntrant.findMany({
    where: { seasonId, status: { not: 'WITHDRAWN' } },
    select: { id: true, playerId: true, displayName: true, username: true, cueverseId: true },
  })
  const players = await prisma.player.findMany({
    where: { id: { in: entrantRows.map((e) => e.playerId).filter((x): x is string => !!x) } },
    select: { id: true, primaryName: true, cueverseId: true, aliases: { select: { alias: true, aliasType: true } } },
  })
  const playerById = new Map(players.map((pl) => [pl.id, pl]))

  const identities: EntrantIdentity[] = entrantRows.map((e) => {
    const pl = e.playerId ? playerById.get(e.playerId) : undefined
    return {
      entrantId: e.id,
      playerId: e.playerId ?? String(e.id),
      displayName: pl?.primaryName ?? e.displayName,
      cueverseId: pl?.cueverseId ?? e.cueverseId ?? e.username,
      aliases: (pl?.aliases ?? []).map((a) => a.alias),
      archiveHandles: (pl?.aliases ?? []).filter((a) => a.aliasType === 'HANDLE').map((a) => a.alias),
    }
  })

  // Matched against THIS Season's entrants only, never the wider database — the same rule the rest
  // of Auto Assign follows, and the reason a name that exists elsewhere is still reported here.
  const match = matchHandles(
    po.participants.map((x) => ({
      sourceId: x.sourceId, rawHandle: x.rawHandle, normalizedHandle: x.normalizedHandle,
      rawName: '', groupName: '-', slot: 0,
    })),
    identities,
  )
  const bySource = new Map(match.matched.map((m) => [m.sourceId, m]))
  // The matcher reports every failure in one list with a reason; "more than one candidate" is the
  // one worth naming separately, because it is the operator's to settle rather than the data's.
  const unresolvedBySource = new Map(match.unresolved.map((u) => [u.sourceId, u]))

  const place: PlacementPlan['place'] = []
  const skipped: PlacementPlan['skipped'] = []

  for (const x of po.participants) {
    const m = bySource.get(x.sourceId)
    if (!m) {
      const u = unresolvedBySource.get(x.sourceId)
      skipped.push({
        rawHandle: x.rawHandle,
        displayName: null,
        reason: u?.reason === 'multiple-possible-entrants' ? 'ambiguous' : 'not-an-entrant',
        detail: u?.message ?? 'No entrant in this Season matches this handle.',
      })
      continue
    }
    if (x.firstRound !== 1 || x.matchNo == null || x.side == null) {
      skipped.push({
        rawHandle: x.rawHandle, displayName: m.displayName, reason: 'no-recorded-seat',
        detail: x.firstRound > 1 ? `The archive has them entering at round ${x.firstRound}.` : 'The archive records no first-round seat.',
      })
      continue
    }
    const target = matchByNo.get(x.matchNo)
    if (!target) {
      skipped.push({
        rawHandle: x.rawHandle, displayName: m.displayName, reason: 'slot-not-in-bracket',
        detail: `The archive puts them in match ${x.matchNo}, which this bracket does not have.`,
      })
      continue
    }
    const held = x.side === 'a' ? target.homeEntrantId : target.awayEntrantId
    place.push({
      entrantId: m.entrantId,
      rawHandle: x.rawHandle,
      displayName: m.displayName,
      cueverseId: m.cueverseId,
      matchNo: x.matchNo,
      side: x.side,
      seed: x.seed,
      bye: x.bye,
      alreadyThere: held === m.entrantId,
    })
  }

  /*
   * Who loses a seat.
   *
   * Only somebody sitting in a seat the archive gives to someone else, and who is not being seated
   * elsewhere themselves. A player already in the right place is not displaced, and neither is one
   * merely being moved.
   */
  const placedIds = new Set(place.map((x) => x.entrantId))
  const targetKeys = new Set(place.map((x) => `${x.matchNo}:${x.side}`))
  const displacedIds = new Set<number>()
  for (const m of first) {
    for (const side of ['a', 'b'] as const) {
      const occupant = side === 'a' ? m.homeEntrantId : m.awayEntrantId
      if (occupant == null || placedIds.has(occupant)) continue
      if (targetKeys.has(`${m.slot + 1}:${side}`)) displacedIds.add(occupant)
    }
  }
  const entrantById = new Map(entrantRows.map((e) => [e.id, e]))
  const displaced = [...displacedIds].map((id) => {
    const e = entrantById.get(id)
    const pl = e?.playerId ? playerById.get(e.playerId) : undefined
    return {
      entrantId: id,
      displayName: pl?.primaryName ?? e?.displayName ?? null,
      cueverseId: pl?.cueverseId ?? e?.cueverseId ?? e?.username ?? null,
    }
  })

  return {
    templateKey: g.entry.templateKey,
    bracketSize: po.bracketSize,
    place,
    skipped,
    displaced,
    refusal: place.length === 0 ? 'None of the archived players could be matched to an entrant in this Season.' : null,
  }
}

/**
 * Seat them.
 *
 * Surgical on purpose: it clears only the seats it is about to write and the seats currently held by
 * the people it is about to move, then writes the archived arrangement. A manual placement elsewhere
 * in the first round survives untouched, because the archive has nothing to say about it and
 * throwing away somebody's work is not this button's job.
 */
export async function applyPlacement(
  actor: { userId: number; username: string },
  seasonId: number,
  templateSource: TemplateSource = manifestEntry,
): Promise<PlacementApplyResult> {
  const preview = await previewPlacement(seasonId, templateSource)
  if (isBlocked(preview)) return { ok: false, error: preview.reason, placed: 0, skipped: 0, displaced: 0 }
  if (preview.refusal) return { ok: false, error: preview.refusal, placed: 0, skipped: 0, displaced: 0 }

  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId }, select: { lifecycleState: true, archiveTemplateKey: true },
  })
  if (season.lifecycleState !== 'PLAYOFF_SETUP') {
    return { ok: false, error: 'This Season left playoff setup while the preview was open. Nothing was changed.', placed: 0, skipped: 0, displaced: 0 }
  }
  if (season.archiveTemplateKey !== preview.templateKey) {
    return { ok: false, error: 'This Season\u2019s archive template changed while the preview was open. Nothing was changed.', placed: 0, skipped: 0, displaced: 0 }
  }

  const first = await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId, round: 1 }, select: { id: true, slot: true }, orderBy: { slot: 'asc' },
  })
  const matchByNo = new Map(first.map((m) => [m.slot + 1, m.id]))
  const targetIds = new Set(preview.place.map((x) => matchByNo.get(x.matchNo)).filter((x): x is number => x != null))
  const movingIds = preview.place.map((x) => x.entrantId)

  /*
   * Clear before writing, or a swap will undo the previous one.
   *
   * `setSeasonBracketSlot` exchanges places when the target is occupied, which is right for a person
   * dragging one player at a time and wrong for writing a whole arrangement in sequence: each swap
   * would shuffle somebody already seated correctly back out again. Emptying the seats involved
   * first makes every write a plain placement.
   */
  await prisma.$transaction(async (tx) => {
    for (const id of targetIds) {
      await tx.seasonPlayoffMatch.update({
        where: { id },
        data: { homeEntrantId: null, homeUsername: null, homeSeed: null, awayEntrantId: null, awayUsername: null, awaySeed: null },
      })
    }
    // And wherever the movers currently sit, so nobody ends up on the bracket twice.
    for (const side of ['home', 'away'] as const) {
      await tx.seasonPlayoffMatch.updateMany({
        where: { seasonId, round: 1, ...(side === 'home' ? { homeEntrantId: { in: movingIds } } : { awayEntrantId: { in: movingIds } }) },
        data: side === 'home'
          ? { homeEntrantId: null, homeUsername: null, homeSeed: null }
          : { awayEntrantId: null, awayUsername: null, awaySeed: null },
      })
    }
  })

  // The seeds the archive recorded, so the numbers beside each name are its own.
  for (const x of preview.place) {
    if (x.seed == null) continue
    await prisma.seasonEntrant.update({ where: { id: x.entrantId }, data: { playoffSeed: x.seed } }).catch(() => {})
  }

  let placed = 0
  for (const x of preview.place) {
    const matchId = matchByNo.get(x.matchNo)
    if (matchId == null) continue
    const r = await setSeasonBracketSlot(actor, seasonId, matchId, x.side === 'a' ? 'home' : 'away', x.entrantId)
    if (r.ok) placed++
  }

  // A bye is an empty seat opposite a seeded player, and it has to say so — otherwise it is
  // indistinguishable from a slot nobody has filled in yet.
  for (const x of preview.place) {
    if (!x.bye) continue
    const matchId = matchByNo.get(x.matchNo)
    if (matchId == null) continue
    await prisma.seasonPlayoffMatch.update({
      where: { id: matchId },
      data: x.side === 'a' ? { awayUsername: 'Bye' } : { homeUsername: 'Bye' },
    }).catch(() => {})
  }

  await recordAudit(actor, {
    action: 'season.archive.placeentrants',
    entity: 'Season',
    entityId: seasonId,
    newValue: {
      templateKey: preview.templateKey,
      placed,
      skipped: preview.skipped.length,
      displaced: preview.displaced.length,
      unplaced: preview.skipped.map((sk) => sk.rawHandle),
    },
  })

  return { ok: true, placed, skipped: preview.skipped.length, displaced: preview.displaced.length }
}

/** Whether Place Entrants belongs on the playoff screen, and what to say when it cannot run. */
export async function placementAvailability(seasonId: number): Promise<{ show: boolean; disabledReason: string | null }> {
  const g = await guardPlayoffs(seasonId)
  if (isBlocked(g)) return { show: false, disabledReason: null }
  const entry = g.entry
  // Only ever offered where the archive recorded real positions.
  if (entry.playoff.placement !== 'exact') return { show: false, disabledReason: null }
  const draft = await prisma.seasonPlayoffMatch.count({ where: { seasonId, round: 1 } })
  if (draft === 0) return { show: true, disabledReason: 'Generate a bracket first, then place the entrants on it.' }
  return { show: true, disabledReason: null }
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
