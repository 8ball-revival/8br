import 'server-only'
import type {} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { recordAudit } from '@/lib/competition/audit'
import {
  manifestEntry, isSharedStage, SHARED_STAGE_MESSAGE, loadManifest,
  type ManifestEntry, type ManifestParticipant, type ManifestMatch,
} from './manifest'
import { matchHandles, UNRESOLVED_LABEL, type EntrantIdentity, type MatchResult } from './matching'

/**
 * Auto Assign: place the owner's chosen entrants into the groups the archive recorded, and fill in
 * the scores it recorded for them.
 *
 * ── Preview, then apply ──────────────────────────────────────────────────────────────────────────
 * Every entry point here comes in two halves. The preview reads and returns exactly what would
 * happen; the apply re-reads it inside a transaction and writes. Nothing rewrites a Season on a
 * single click, and the apply never trusts the preview it was shown — the lifecycle and the
 * permissions are checked again inside the transaction, because between the two the Season could
 * have been closed by somebody else.
 *
 * ── What it will not do ──────────────────────────────────────────────────────────────────────────
 * Create a Player, an account, an alias or an entrant. Change a CueVerse ID. Remove anything. Guess
 * an ambiguous identity. Overwrite manual work without being asked. Fabricate a score.
 */

export interface AutoAssignBlocked {
  blocked: true
  reason: string
}

/** A type guard, because `'blocked' in x` does not narrow a union whose other arm has an optional. */
export function isBlocked(v: AutoAssignBlocked | { blocked?: false }): v is AutoAssignBlocked {
  return v.blocked === true
}

/**
 * Where a Season's archived groups and results actually live.
 *
 * Normally: on its own manifest entry. For the four 2006 Seasons the group stage was played
 * UNDIVIDED — one field of ~98 players across 14 groups — and only the playoffs split into Division
 * A and Division B. Their entry therefore carries no participants of its own; the groups sit in a
 * separate undivided source that both divisions point at.
 *
 * Returning that source here is what lets those Seasons be reconstructed at all. The safeguard that
 * makes it safe is not here but in `sharedStageClaim` below: the shared field may be applied to ONE
 * of the two divisions, never both.
 */
function templateData(entry: ManifestEntry): {
  participants: ManifestParticipant[]
  matches: ManifestMatch[]
  groupNames: string[]
  sharedFrom: string | null
} {
  if (!isSharedStage(entry)) {
    return {
      participants: entry.participants,
      matches: entry.matches,
      groupNames: entry.groupNames,
      sharedFrom: null,
    }
  }
  const source = loadManifest().undividedSources
    .find((u) => u.sourceKey === entry.sharedGroupStageSourceKey)
  if (!source) {
    return { participants: [], matches: [], groupNames: [], sharedFrom: entry.sharedGroupStageSourceKey }
  }
  return {
    participants: source.participants,
    matches: source.matches,
    groupNames: source.groupNames,
    sharedFrom: source.sourceKey,
  }
}

/**
 * Which division, if either, has already taken the shared 2006 group stage.
 *
 * The whole risk of an undivided source is applying it twice: the same ~98 players and their results
 * landing in Division A AND Division B, so every match counts double in anything derived from them.
 * So the field is first-come. Whichever divisional Season has group placements already owns it, and
 * the other is refused by name — not with a vague message, but saying exactly which Season holds it,
 * because the operator needs to know where their work went.
 *
 * "Has placements" is the test rather than a flag, so it stays true if the owner clears a Season and
 * starts again: releasing the claim is just emptying the groups.
 */
async function sharedStageClaim(entry: ManifestEntry, seasonId: number): Promise<
  { claimedByOther: false } | { claimedByOther: true; label: string }
> {
  const source = loadManifest().undividedSources
    .find((u) => u.sourceKey === entry.sharedGroupStageSourceKey)
  if (!source) return { claimedByOther: false }

  const siblingKeys = source.feedsTemplateKeys.filter((k) => k !== entry.templateKey)
  if (siblingKeys.length === 0) return { claimedByOther: false }

  const siblings = await prisma.season.findMany({
    where: { archiveTemplateKey: { in: siblingKeys } },
    select: {
      id: true, number: true, competitionYear: true, division: true,
      _count: { select: { groups: true } },
    },
  })
  for (const sib of siblings) {
    if (sib.id === seasonId) continue
    const placed = await prisma.seasonGroupPlayer.count({ where: { group: { seasonId: sib.id } } })
    if (placed > 0) {
      return {
        claimedByOther: true,
        label: `Season ${sib.number} ${sib.competitionYear} Division ${sib.division ?? '?'}`,
      }
    }
  }
  return { claimedByOther: false }
}

/** Every Auto Assign path refuses the same four situations, in the same order. */
/**
 * The archive entry a Season is assigned from, injectable for tests.
 *
 * The entrant and playoff services already take one. Without the same door here, a suite could only
 * exercise group assignment against a real unprocessed shell — and the reconstruction has processed
 * every one, so the fixture became unsatisfiable through the work succeeding.
 */
export type AssignTemplateSource = (key: string) => ReturnType<typeof manifestEntry>

async function guard(seasonId: number, phase: 'entrants' | 'scores', templateSource: AssignTemplateSource = manifestEntry): Promise<
  | { ok: true; season: { id: number; archiveTemplateKey: string | null; lifecycleState: string }; entry: ManifestEntry }
  | AutoAssignBlocked
> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { id: true, archiveTemplateKey: true, lifecycleState: true },
  })
  if (!season) return { blocked: true, reason: 'That Season no longer exists.' }
  if (!season.archiveTemplateKey) {
    return { blocked: true, reason: 'This Season has no verified archive template.' }
  }

  const entry = templateSource(season.archiveTemplateKey)
  if (!entry) return { blocked: true, reason: 'No verified archive data for this Season.' }

  /*
   * The 2006 shared group stage.
   *
   * Its groups belong to a field that was never divided, so applying them to Division A and again to
   * Division B would count every result twice and invent a divisional membership the archive does
   * not record. Blocked at the service, not just hidden in the UI.
   */
  /*
   * The shared 2006 field may be reconstructed — into ONE division.
   *
   * This used to refuse both outright, which made those four Seasons impossible to rebuild at all.
   * The real requirement was never "never apply it", it was "never apply it twice", and that is what
   * the claim check enforces.
   */
  if (isSharedStage(entry)) {
    const claim = await sharedStageClaim(entry, seasonId)
    if (claim.claimedByOther) {
      return {
        blocked: true,
        reason: `The 2006 group stage was played undivided, and ${claim.label} already holds it. `
          + 'Applying the same groups here would count every result twice. Clear that Season\'s groups '
          + 'first if it belongs here instead.',
      }
    }
  }

  const allowed = phase === 'entrants'
    ? ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'GROUP_SETUP']
    : ['GROUP_SETUP', 'GROUP_STAGE_LIVE']
  if (!allowed.includes(season.lifecycleState)) {
    return {
      blocked: true,
      reason: phase === 'entrants'
        ? 'Group assignment is only available while entrants and groups are still being set up.'
        : 'Group scores can only be filled in while the group stage is open.',
    }
  }

  return { ok: true, season, entry }
}

/** Load the Season's entrants with every identity string they answer to. */
async function loadEntrantIdentities(seasonId: number): Promise<EntrantIdentity[]> {
  const rows = await prisma.seasonEntrant.findMany({
    where: { seasonId, status: { not: 'WITHDRAWN' } },
    select: { id: true, playerId: true, displayName: true, username: true, cueverseId: true },
  })
  const linked = rows.filter((r) => r.playerId != null)

  /*
   * Players are fetched in one query, not one per entrant.
   *
   * SeasonEntrant carries a playerId without a relation, so the join has to happen here. Doing it
   * per row would be forty queries on a Season with forty entrants, every time a preview opens.
   */
  const players = await prisma.player.findMany({
    where: { id: { in: linked.map((r) => r.playerId!) } },
    select: {
      id: true, primaryName: true, cueverseId: true,
      aliases: { select: { alias: true, aliasType: true } },
    },
  })
  const byId = new Map(players.map((p) => [p.id, p]))

  return linked.map((r) => {
    const p = byId.get(r.playerId!)
    return {
      entrantId: r.id,
      playerId: r.playerId!,
      // The entrant's own snapshot is the fallback: a Player row can be missing, and the entrant
      // still has the identity it was added under.
      displayName: p?.primaryName ?? r.displayName,
      cueverseId: p?.cueverseId ?? r.cueverseId ?? r.username,
      aliases: (p?.aliases ?? []).map((a) => a.alias),
      /*
       * Historical handles already promoted onto this Player.
       *
       * HANDLE is the alias type the identity system uses for a name somebody played under; the
       * others (YAHOO_MESSENGER, EMAIL, FORUM) are contact details and must never match an archived
       * competitor handle. Nothing is ever promoted automatically — that is a separate deliberate act
       * by the owner.
       */
      archiveHandles: (p?.aliases ?? [])
        .filter((a) => a.aliasType === 'HANDLE')
        .map((a) => a.alias),
    }
  })
}

// ══════════════════════════════════════════════════════════════════ group assignment

export interface GroupAssignPlan {
  blocked?: false
  templateKey: string
  groupNames: string[]
  /** Assignments already correct — reported, never rewritten. */
  alreadyCorrect: { rawHandle: string; groupName: string; slot: number; displayName: string | null; cueverseId: string | null }[]
  /** New placements this run would make. */
  toPlace: { entrantId: number; rawHandle: string; groupName: string; slot: number; displayName: string | null; cueverseId: string | null; reasonLabel: string; confidence: string }[]
  /** An entrant the owner already placed somewhere else. Left alone by default. */
  conflicts: { entrantId: number; rawHandle: string; displayName: string | null; currentGroup: string; archiveGroup: string }[]
  unresolved: { rawHandle: string; groupName: string; slot: number; reasonLabel: string; message: string; suggestions: { entrantId: number; displayName: string | null; cueverseId: string | null; why: string }[] }[]
  unusedEntrants: { entrantId: number; displayName: string | null; cueverseId: string | null }[]
  sourceParticipants: number
  sourceGroups: number
}

export async function previewGroupAssign(
  seasonId: number,
  manualResolutions: Record<string, number> = {},
  templateSource: AssignTemplateSource = manifestEntry,
): Promise<GroupAssignPlan | AutoAssignBlocked> {
  const g = await guard(seasonId, 'entrants', templateSource)
  if ('blocked' in g) return g
  const { entry } = g

  const data = templateData(entry)
  const entrants = await loadEntrantIdentities(seasonId)
  const result: MatchResult = matchHandles(
    data.participants.map((p) => ({
      sourceId: p.sourceId, rawHandle: p.rawHandle, normalizedHandle: p.normalizedHandle,
      rawName: p.rawName, groupName: p.groupName, slot: p.slot,
    })),
    entrants,
    { ambiguousSourceIds: entry.ambiguousPlacements.map((a) => a.sourceId), manualResolutions },
  )

  // Where the entrants already sit, so "already correct" and "conflict" can be told apart.
  const placed = await prisma.seasonGroupPlayer.findMany({
    where: { group: { seasonId } },
    select: { entrantId: true, seed: true, group: { select: { code: true } } },
  })
  const placedBy = new Map(placed.map((p) => [p.entrantId, { group: p.group.code, seed: p.seed }]))

  const plan: GroupAssignPlan = {
    templateKey: entry.templateKey,
    groupNames: data.groupNames,
    alreadyCorrect: [], toPlace: [], conflicts: [],
    unresolved: result.unresolved.map((u) => ({
      rawHandle: u.rawHandle, groupName: u.groupName, slot: u.slot,
      reasonLabel: UNRESOLVED_LABEL[u.reason], message: u.message,
      suggestions: u.suggestions.map((s) => ({ entrantId: s.entrantId, displayName: s.displayName, cueverseId: s.cueverseId, why: s.why })),
    })),
    unusedEntrants: result.unusedEntrants.map((e) => ({ entrantId: e.entrantId, displayName: e.displayName, cueverseId: e.cueverseId })),
    sourceParticipants: data.participants.length,
    sourceGroups: data.groupNames.length,
  }

  for (const m of result.matched) {
    const current = placedBy.get(m.entrantId)
    if (!current) {
      plan.toPlace.push({
        entrantId: m.entrantId, rawHandle: m.rawHandle, groupName: m.groupName, slot: m.slot,
        displayName: m.displayName, cueverseId: m.cueverseId,
        reasonLabel: m.reasonLabel, confidence: m.confidence,
      })
    } else if (current.group === m.groupName) {
      plan.alreadyCorrect.push({
        rawHandle: m.rawHandle, groupName: m.groupName, slot: m.slot,
        displayName: m.displayName, cueverseId: m.cueverseId,
      })
    } else {
      // Somewhere else by hand. Default is to leave it exactly where the owner put it.
      plan.conflicts.push({
        entrantId: m.entrantId, rawHandle: m.rawHandle, displayName: m.displayName,
        currentGroup: current.group, archiveGroup: m.groupName,
      })
    }
  }

  return plan
}

export interface ApplyResult {
  ok: boolean
  error?: string
  placed: number
  alreadyCorrect: number
  conflicts: number
  unresolved: number
  unusedEntrants: number
  groupsCreated: number
}

export async function applyGroupAssign(
  actor: { userId: number; username: string },
  seasonId: number,
  manualResolutions: Record<string, number> = {},
): Promise<ApplyResult> {
  const preview = await previewGroupAssign(seasonId, manualResolutions)
  if (isBlocked(preview)) {
    return { ok: false, error: preview.reason, placed: 0, alreadyCorrect: 0, conflicts: 0, unresolved: 0, unusedEntrants: 0, groupsCreated: 0 }
  }

  let groupsCreated = 0
  let placed = 0

  await prisma.$transaction(async (tx) => {
    /*
     * The lifecycle is checked AGAIN, here, inside the transaction.
     *
     * The preview was a separate request. Between the two, somebody could have closed registration
     * or started the group stage, and applying then would write into a Season that has moved on.
     */
    const season = await tx.season.findUniqueOrThrow({
      where: { id: seasonId }, select: { lifecycleState: true, archiveTemplateKey: true },
    })
    if (!['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'GROUP_SETUP'].includes(season.lifecycleState)) {
      throw new Error('This Season moved past group setup while the preview was open. Nothing was changed.')
    }
    if (season.archiveTemplateKey !== preview.templateKey) {
      throw new Error('This Season\'s archive template changed while the preview was open. Nothing was changed.')
    }

    // Create only the groups the template names, and only the ones missing.
    const existing = await tx.seasonGroup.findMany({ where: { seasonId }, select: { id: true, code: true } })
    const byCode = new Map(existing.map((g) => [g.code, g.id]))
    for (const [i, code] of preview.groupNames.entries()) {
      if (byCode.has(code)) continue
      const made = await tx.seasonGroup.create({
        data: { seasonId, code, ordinal: i },
        select: { id: true },
      })
      byCode.set(code, made.id)
      groupsCreated++
    }

    for (const p of preview.toPlace) {
      const groupId = byCode.get(p.groupName)
      if (groupId == null) continue

      /*
       * Idempotent at the row level.
       *
       * A retry after a partial failure, or a second click, must not place the same entrant twice.
       * Checking here rather than trusting the preview means the guarantee holds even when the two
       * requests race.
       */
      const already = await tx.seasonGroupPlayer.findFirst({
        where: { entrantId: p.entrantId, group: { seasonId } }, select: { id: true },
      })
      if (already) continue

      await tx.seasonGroupPlayer.create({
        // The archive's slot is zero-based; the site seeds from 1.
        data: { groupId, entrantId: p.entrantId, seed: p.slot + 1 },
      })
      placed++
    }

    /*
     * Creating groups moves the Season into GROUP_SETUP, exactly as Generate Groups does.
     *
     * Without this the Season kept sitting in REGISTRATION_CLOSED while holding a full set of
     * groups and placements — and "Group Stage Live" refuses that transition, so a Season built with
     * Auto Assign could not be started at all. The two paths create the same thing and must leave the
     * Season in the same state; anything else makes which button you pressed matter later.
     */
    if (season.lifecycleState === 'REGISTRATION_CLOSED' && (groupsCreated > 0 || placed > 0)) {
      await tx.season.update({ where: { id: seasonId }, data: { lifecycleState: 'GROUP_SETUP' } })
    }

    await recordAudit(actor, {
      action: 'season.archive.autoassign.groups',
      entity: 'Season',
      entityId: seasonId,
      newValue: {
        templateKey: preview.templateKey,
        groupsCreated,
        placed,
        alreadyCorrect: preview.alreadyCorrect.length,
        conflictsLeftAlone: preview.conflicts.length,
        unresolved: preview.unresolved.length,
      },
    }, tx)
  }, { timeout: 120_000 })

  return {
    ok: true,
    placed,
    groupsCreated,
    alreadyCorrect: preview.alreadyCorrect.length,
    conflicts: preview.conflicts.length,
    unresolved: preview.unresolved.length,
    unusedEntrants: preview.unusedEntrants.length,
  }
}

// ══════════════════════════════════════════════════════════════════════ group scores

export interface ScorePlanRow {
  groupName: string
  aHandle: string
  bHandle: string
  scoreA: number | null
  scoreB: number | null
  status:
    | 'will-apply'
    | 'already-matches'
    | 'manual-conflict'
    | 'participant-not-entered'
    | 'participant-wrong-group'
    | 'exact-score-unavailable'
    | 'ambiguous-source'
  statusLabel: string
  currentA?: number | null
  currentB?: number | null
}

export interface ScorePlan {
  blocked?: false
  templateKey: string
  rows: ScorePlanRow[]
  willApply: number
  alreadyMatches: number
  conflicts: number
  unresolved: number
  standingsOnly: boolean
}

const SCORE_STATUS_LABEL: Record<ScorePlanRow['status'], string> = {
  'will-apply': 'Will apply',
  'already-matches': 'Already matches',
  'manual-conflict': 'Existing manual score conflicts',
  'participant-not-entered': 'Player not among current entrants',
  'participant-wrong-group': 'Entrant assigned to another group',
  'exact-score-unavailable': 'Exact score unavailable',
  'ambiguous-source': 'Unsupported or ambiguous archive entry',
}

export async function previewGroupScores(seasonId: number): Promise<ScorePlan | AutoAssignBlocked> {
  const g = await guard(seasonId, 'scores')
  if ('blocked' in g) return g
  const { entry } = g

  const data = templateData(entry)
  const entrants = await loadEntrantIdentities(seasonId)
  const match = matchHandles(
    data.participants.map((p) => ({
      sourceId: p.sourceId, rawHandle: p.rawHandle, normalizedHandle: p.normalizedHandle,
      rawName: p.rawName, groupName: p.groupName, slot: p.slot,
    })),
    entrants,
    { ambiguousSourceIds: entry.ambiguousPlacements.map((a) => a.sourceId) },
  )
  const entrantBySource = new Map(match.matched.map((m) => [m.sourceId, m]))

  const placed = await prisma.seasonGroupPlayer.findMany({
    where: { group: { seasonId } },
    select: { entrantId: true, group: { select: { code: true } } },
  })
  const groupOf = new Map(placed.map((p) => [p.entrantId, p.group.code]))

  const existingMatches = await prisma.seasonMatch.findMany({
    where: { seasonId },
    select: { id: true, homeEntrantId: true, awayEntrantId: true, homeGames: true, awayGames: true, status: true },
  })
  const existingByPair = new Map(
    existingMatches.map((m) => [pairKey(m.homeEntrantId, m.awayEntrantId), m]),
  )

  const rows: ScorePlanRow[] = []
  for (const mt of data.matches) {
    const a = entrantBySource.get(mt.aSourceId)
    const b = entrantBySource.get(mt.bSourceId)
    const base = { groupName: mt.groupName, aHandle: mt.aRawHandle, bHandle: mt.bRawHandle, scoreA: mt.scoreA, scoreB: mt.scoreB }

    if (mt.resultKind !== 'exact') {
      // Never invent a score from a winner or from standings.
      rows.push({ ...base, status: 'exact-score-unavailable', statusLabel: SCORE_STATUS_LABEL['exact-score-unavailable'] })
      continue
    }
    if (!a || !b) {
      rows.push({ ...base, status: 'participant-not-entered', statusLabel: SCORE_STATUS_LABEL['participant-not-entered'] })
      continue
    }
    if (groupOf.get(a.entrantId) !== mt.groupName || groupOf.get(b.entrantId) !== mt.groupName) {
      rows.push({ ...base, status: 'participant-wrong-group', statusLabel: SCORE_STATUS_LABEL['participant-wrong-group'] })
      continue
    }

    const existing = existingByPair.get(pairKey(a.entrantId, b.entrantId))
    if (existing && existing.homeGames != null && existing.awayGames != null) {
      // Orient the stored result the way the archive wrote it before comparing: the site may have
      // recorded the same match with the two players the other way round.
      const [storedA, storedB] = existing.homeEntrantId === a.entrantId
        ? [existing.homeGames, existing.awayGames]
        : [existing.awayGames, existing.homeGames]
      if (storedA === mt.scoreA && storedB === mt.scoreB) {
        rows.push({ ...base, status: 'already-matches', statusLabel: SCORE_STATUS_LABEL['already-matches'], currentA: storedA, currentB: storedB })
      } else {
        rows.push({ ...base, status: 'manual-conflict', statusLabel: SCORE_STATUS_LABEL['manual-conflict'], currentA: storedA, currentB: storedB })
      }
      continue
    }

    rows.push({ ...base, status: 'will-apply', statusLabel: SCORE_STATUS_LABEL['will-apply'] })
  }

  return {
    templateKey: entry.templateKey,
    rows,
    willApply: rows.filter((r) => r.status === 'will-apply').length,
    alreadyMatches: rows.filter((r) => r.status === 'already-matches').length,
    conflicts: rows.filter((r) => r.status === 'manual-conflict').length,
    unresolved: rows.filter((r) => !['will-apply', 'already-matches'].includes(r.status)).length,
    standingsOnly: data.matches.length === 0 && entry.standings.length > 0,
  }
}

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`)

export interface ScoreApplyResult {
  ok: boolean
  error?: string
  applied: number
  alreadyMatched: number
  conflicted: number
  unresolved: number
}

export async function applyGroupScores(
  actor: { userId: number; username: string },
  seasonId: number,
): Promise<ScoreApplyResult> {
  const preview = await previewGroupScores(seasonId)
  if (isBlocked(preview)) {
    return { ok: false, error: preview.reason, applied: 0, alreadyMatched: 0, conflicted: 0, unresolved: 0 }
  }

  const entrants = await loadEntrantIdentities(seasonId)
  const entry = manifestEntry(preview.templateKey)
  if (!entry) return { ok: false, error: 'No verified archive data.', applied: 0, alreadyMatched: 0, conflicted: 0, unresolved: 0 }

  const applyData = templateData(entry)
  const match = matchHandles(
    applyData.participants.map((p) => ({
      sourceId: p.sourceId, rawHandle: p.rawHandle, normalizedHandle: p.normalizedHandle,
      rawName: p.rawName, groupName: p.groupName, slot: p.slot,
    })),
    entrants,
    { ambiguousSourceIds: entry.ambiguousPlacements.map((a) => a.sourceId) },
  )
  const bySource = new Map(match.matched.map((m) => [m.sourceId, m]))

  let applied = 0

  await prisma.$transaction(async (tx) => {
    const season = await tx.season.findUniqueOrThrow({
      where: { id: seasonId }, select: { lifecycleState: true, archiveTemplateKey: true },
    })
    if (!['GROUP_SETUP', 'GROUP_STAGE_LIVE'].includes(season.lifecycleState)) {
      throw new Error('This Season moved past the group stage while the preview was open. Nothing was changed.')
    }
    if (season.archiveTemplateKey !== preview.templateKey) {
      throw new Error('This Season\'s archive template changed while the preview was open. Nothing was changed.')
    }

    const groups = await tx.seasonGroup.findMany({ where: { seasonId }, select: { id: true, code: true } })
    const groupIdByCode = new Map(groups.map((g) => [g.code, g.id]))

    for (const mt of applyData.matches) {
      if (mt.resultKind !== 'exact') continue
      const a = bySource.get(mt.aSourceId)
      const b = bySource.get(mt.bSourceId)
      if (!a || !b) continue

      const groupId = groupIdByCode.get(mt.groupName)
      if (groupId == null) continue

      // Both must actually be in this group right now, not merely matched to it.
      const inGroup = await tx.seasonGroupPlayer.count({
        where: { groupId, entrantId: { in: [a.entrantId, b.entrantId] } },
      })
      if (inGroup !== 2) continue

      const existing = await tx.seasonMatch.findFirst({
        where: {
          seasonId,
          OR: [
            { homeEntrantId: a.entrantId, awayEntrantId: b.entrantId },
            { homeEntrantId: b.entrantId, awayEntrantId: a.entrantId },
          ],
        },
        select: { id: true, homeEntrantId: true, homeGames: true, awayGames: true },
      })
      // A recorded result is the owner's until they say otherwise — and this also makes a retry a
      // no-op, because the row this run wrote a moment ago is now a recorded result too.
      if (existing && existing.homeGames != null && existing.awayGames != null) continue

      /*
       * Orient the score to whichever way the row stores the two players.
       *
       * The archive's A and B are not necessarily the site's home and away. Writing the archive's
       * numbers into an existing row without checking would silently reverse the result.
       */
      const flip = existing != null && existing.homeEntrantId !== a.entrantId
      const homeGames = flip ? mt.scoreB! : mt.scoreA!
      const awayGames = flip ? mt.scoreA! : mt.scoreB!
      const homeId = existing?.homeEntrantId ?? a.entrantId
      const awayId = homeId === a.entrantId ? b.entrantId : a.entrantId
      const winner = homeGames === awayGames ? null : homeGames > awayGames ? homeId : awayId
      const loser = winner == null ? null : winner === homeId ? awayId : homeId

      if (existing) {
        await tx.seasonMatch.update({
          where: { id: existing.id },
          data: {
            homeGames, awayGames, status: 'COMPLETED',
            winnerEntrantId: winner, loserEntrantId: loser,
            completedAt: new Date(), version: { increment: 1 },
          },
        })
      } else {
        await tx.seasonMatch.create({
          data: {
            seasonId, groupId, round: 1,
            homeEntrantId: a.entrantId, awayEntrantId: b.entrantId,
            homeUsername: a.cueverseId ?? a.displayName ?? '',
            awayUsername: b.cueverseId ?? b.displayName ?? '',
            homeGames, awayGames, status: 'COMPLETED',
            winnerEntrantId: winner, loserEntrantId: loser,
            completedAt: new Date(),
          },
        })
      }
      applied++
    }

    await recordAudit(actor, {
      action: 'season.archive.autoassign.scores',
      entity: 'Season',
      entityId: seasonId,
      newValue: {
        templateKey: preview.templateKey,
        applied,
        alreadyMatched: preview.alreadyMatches,
        conflictsLeftAlone: preview.conflicts,
        unresolved: preview.unresolved,
      },
    }, tx)
  }, { timeout: 300_000 })

  /*
   * Standings come from the canonical service, never from this file.
   *
   * Writing totals directly would produce a table that agrees with the archive and disagrees with
   * the matches underneath it. Recomputing means the standings are derived from the results that
   * were actually applied, which is the only version that stays true.
   */
  if (applied > 0) {
    const { recomputeSeasonStandings } = await import('@/lib/seasons/group-stage')
    await recomputeSeasonStandings(seasonId).catch(() => { /* reported by the caller's summary */ })
  }

  return {
    ok: true,
    applied,
    alreadyMatched: preview.alreadyMatches,
    conflicted: preview.conflicts,
    unresolved: preview.unresolved,
  }
}

// ═══════════════════════════════════════════════════════════════════════════ availability

export interface AutoAssignAvailability {
  /** Whether the button belongs on this screen at all. */
  show: boolean
  /** Non-null when the button should be shown but explain itself instead of acting. */
  disabledReason: string | null
}

/**
 * Whether Auto Assign belongs on a given workspace, and what to say if it cannot run.
 *
 * The phase and blocking rules live HERE rather than in each component, so the entrant board and the
 * score board cannot drift apart about when the button appears — and so a component can never be the
 * thing that decides a Season is eligible. `guard` remains the authority at apply time; this only
 * decides what to draw.
 */
export async function autoAssignAvailability(
  seasonId: number,
  phase: 'entrants' | 'scores',
): Promise<AutoAssignAvailability> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    select: { archiveTemplateKey: true, lifecycleState: true },
  })
  // No template means this is not a reconstruction: the button has nothing to do with this Season.
  if (!season?.archiveTemplateKey) return { show: false, disabledReason: null }

  const entry = manifestEntry(season.archiveTemplateKey)
  if (!entry) return { show: false, disabledReason: null }

  if (isSharedStage(entry)) {
    const claim = await sharedStageClaim(entry, seasonId)
    if (claim.claimedByOther) {
      return { show: true, disabledReason: `${SHARED_STAGE_MESSAGE} — ${claim.label} already holds it.` }
    }
    // Free to take. The preview will say plainly that the field is the undivided one.
    return { show: true, disabledReason: null }
  }

  const allowed = phase === 'entrants'
    ? ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'GROUP_SETUP']
    : ['GROUP_SETUP', 'GROUP_STAGE_LIVE']
  if (!allowed.includes(season.lifecycleState)) {
    // Out of phase: the button is not drawn rather than drawn-and-refusing, because a control that
    // can never work here is noise on a screen that has other work to do.
    return { show: false, disabledReason: null }
  }

  const avail = templateData(entry)
  if (phase === 'entrants' && avail.participants.length === 0) {
    return { show: true, disabledReason: 'No archived group assignments for this Season.' }
  }
  if (phase === 'scores' && avail.matches.length === 0) {
    return {
      show: true,
      disabledReason: entry.standings.length > 0
        ? 'Standings available; exact match-level scores unavailable.'
        : 'No archived group results for this Season.',
    }
  }

  return { show: true, disabledReason: null }
}
