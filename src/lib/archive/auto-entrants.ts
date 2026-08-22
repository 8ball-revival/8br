import 'server-only'

import { prisma } from '@/lib/prisma'
import { recordAudit } from '@/lib/competition/audit'
import { addSeasonEntrant } from '@/lib/seasons/service'
import { manifestEntry, isSharedStage, SHARED_STAGE_MESSAGE, type ManifestEntry, stripSourceNote } from './manifest'
import { matchHandles, UNRESOLVED_LABEL, type EntrantIdentity } from './matching'
import { isBlocked, type AutoAssignBlocked } from './auto-assign'

/**
 * Auto Add Entrants: find the Season's archived players among the accounts that already exist.
 *
 * ── How this differs from group Auto Assign ──────────────────────────────────────────────────────
 * Group assignment searches only the entrants the owner already chose. This searches the WHOLE
 * canonical Player database, because its job is the step before that one: turning a list of archived
 * handles into the Season's entrant list.
 *
 * The matching itself is the same engine and the same order of confidence, so a handle that would be
 * placed into a group is exactly the handle that gets added here — the two steps cannot disagree
 * about who somebody is.
 *
 * ── What it will not do ──────────────────────────────────────────────────────────────────────────
 * Create a Player, an account or an alias. Add a placeholder for a handle it cannot find. Change a
 * CueVerse ID. Remove an entrant. Assign anybody to a group — that is the next button, deliberately
 * separate, so adding a hundred people and arranging them stay two reviewable acts.
 */

export interface EntrantPlan {
  blocked?: false
  templateKey: string
  /** Confidently matched, not yet entered. */
  toAdd: {
    playerId: string
    rawHandle: string
    displayName: string | null
    cueverseId: string | null
    reasonLabel: string
    confidence: string
  }[]
  /** Matched to somebody already entered. Reported, never re-added. */
  alreadyEntered: { rawHandle: string; displayName: string | null; cueverseId: string | null }[]
  /** More than one account could be this archived handle. */
  ambiguous: {
    rawHandle: string
    candidates: { playerId: string; displayName: string | null; cueverseId: string | null; why: string }[]
  }[]
  /** No account matches. Listed by the EXACT archived handle so the owner can create them. */
  missing: { rawHandle: string; suggestions: { displayName: string | null; cueverseId: string | null; why: string }[] }[]
  /** The same handle appearing twice in the source, which the manifest recorded as a contradiction. */
  contradictions: { rawHandle: string; note: string }[]
  sourceParticipants: number
}

export interface EntrantApplyResult {
  ok: boolean
  error?: string
  added: number
  alreadyEntered: number
  ambiguous: number
  missing: number
}

/** Both the group field and the playoff field: a Season's archived people are the union. */
function archivedPeople(entry: ManifestEntry, shared: ManifestEntry['participants']) {
  const byId = new Map<string, { sourceId: string; rawHandle: string; normalizedHandle: string; rawName: string }>()
  for (const p of [...shared, ...entry.participants]) {
    if (!byId.has(p.sourceId)) {
      byId.set(p.sourceId, {
        sourceId: p.sourceId, rawHandle: p.rawHandle,
        normalizedHandle: p.normalizedHandle, rawName: p.rawName,
      })
    }
  }
  /*
   * Playoff participants are included too.
   *
   * A Season's playoff field is not always a subset of its group field — a player can appear in the
   * archive's playoff record without a surviving group row. Leaving them out would mean Build
   * Playoff Bracket later reporting them missing when the fix was to add them here.
   */
  for (const p of entry.playoff?.participants ?? []) {
    if (!byId.has(p.sourceId)) {
      byId.set(p.sourceId, {
        sourceId: p.sourceId, rawHandle: stripSourceNote(p.rawHandle),
        normalizedHandle: stripSourceNote(p.normalizedHandle), rawName: '',
      })
    }
  }
  /*
   * One person, one row — keyed on the handle, not the source id.
   *
   * The archive gives the same player two ids when its group table annotated them ("mr.8pac - x" in
   * the group, "mr.8pac" in the bracket). The annotation is stripped when the manifest is built, so
   * both now normalize to the same handle; without collapsing them here the matcher would claim the
   * entrant for the first and report the second as an account that does not exist.
   */
  const byHandle = new Map<string, ReturnType<typeof byId.get> & object>()
  for (const p of byId.values()) {
    const seen = byHandle.get(p.normalizedHandle)
    // Keep whichever row knows the person's name; the playoff copy carries none.
    if (!seen) byHandle.set(p.normalizedHandle, p)
    else if (!seen.rawName && p.rawName) byHandle.set(p.normalizedHandle, p)
  }
  return [...byHandle.values()]
}

async function guardEntrants(seasonId: number): Promise<
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

  // Entrants are added while registration is open or closed, before the groups are built.
  if (!['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(season.lifecycleState)) {
    return { blocked: true, reason: 'Entrants can only be added while registration is open or closed.' }
  }
  return { ok: true, entry, lifecycleState: season.lifecycleState }
}

/**
 * Every Player, as a matchable identity.
 *
 * Loaded once with their aliases rather than queried per handle: a Season has around a hundred
 * archived people and the database has thousands of Players, so the join belongs here and not in a
 * loop.
 */
async function allPlayerIdentities(): Promise<EntrantIdentity[]> {
  const players = await prisma.player.findMany({
    where: { active: true, managementOnly: false },
    select: {
      id: true, primaryName: true, cueverseId: true,
      aliases: { select: { alias: true, aliasType: true } },
    },
  })
  return players.map((p, i) => ({
    // The matcher keys on entrantId; here it is a positional handle, mapped back through playerId.
    entrantId: i + 1,
    playerId: p.id,
    displayName: p.primaryName,
    cueverseId: p.cueverseId,
    aliases: p.aliases.map((a) => a.alias),
    archiveHandles: p.aliases.filter((a) => a.aliasType === 'HANDLE').map((a) => a.alias),
  }))
}

export async function previewAutoEntrants(seasonId: number): Promise<EntrantPlan | AutoAssignBlocked> {
  const g = await guardEntrants(seasonId)
  if (isBlocked(g)) return g
  const { entry } = g

  const { loadManifest } = await import('./manifest')
  const shared = isSharedStage(entry)
    ? loadManifest().undividedSources.find((u) => u.sourceKey === entry.sharedGroupStageSourceKey)?.participants ?? []
    : []

  const people = archivedPeople(entry, shared)
  const identities = await allPlayerIdentities()
  const byEntrantId = new Map(identities.map((p) => [p.entrantId, p]))

  const result = matchHandles(
    people.map((p) => ({ ...p, groupName: '-', slot: 0 })),
    identities,
    { ambiguousSourceIds: entry.ambiguousPlacements.map((a) => a.sourceId) },
  )

  const entered = await prisma.seasonEntrant.findMany({
    where: { seasonId, status: { not: 'WITHDRAWN' } },
    select: { playerId: true },
  })
  const enteredIds = new Set(entered.map((e) => e.playerId).filter((x): x is string => !!x))

  const plan: EntrantPlan = {
    templateKey: entry.templateKey,
    toAdd: [], alreadyEntered: [], ambiguous: [], missing: [],
    contradictions: entry.ambiguousPlacements.map((a) => ({
      rawHandle: a.rawHandle,
      note: `The archive places this handle in more than one group (${a.groups.join(', ')}).`,
    })),
    sourceParticipants: people.length,
  }

  for (const m of result.matched) {
    const p = byEntrantId.get(m.entrantId)
    if (!p) continue
    if (enteredIds.has(p.playerId)) {
      plan.alreadyEntered.push({ rawHandle: m.rawHandle, displayName: p.displayName, cueverseId: p.cueverseId })
    } else {
      plan.toAdd.push({
        playerId: p.playerId, rawHandle: m.rawHandle,
        displayName: p.displayName, cueverseId: p.cueverseId,
        reasonLabel: m.reasonLabel, confidence: m.confidence,
      })
    }
  }

  for (const u of result.unresolved) {
    if (u.reason === 'multiple-possible-entrants') {
      plan.ambiguous.push({
        rawHandle: u.rawHandle,
        candidates: u.suggestions.map((s) => ({
          playerId: s.playerId, displayName: s.displayName, cueverseId: s.cueverseId, why: s.why,
        })),
      })
    } else if (u.reason === 'player-not-among-entrants') {
      // Here that label means "no account exists", because the search was the whole database.
      plan.missing.push({
        rawHandle: u.rawHandle,
        suggestions: u.suggestions.map((s) => ({ displayName: s.displayName, cueverseId: s.cueverseId, why: s.why })),
      })
    } else {
      plan.contradictions.push({ rawHandle: u.rawHandle, note: UNRESOLVED_LABEL[u.reason] })
    }
  }

  return plan
}

export async function applyAutoEntrants(
  actor: { userId: number; username: string },
  seasonId: number,
): Promise<EntrantApplyResult> {
  const preview = await previewAutoEntrants(seasonId)
  if (isBlocked(preview)) {
    return { ok: false, error: preview.reason, added: 0, alreadyEntered: 0, ambiguous: 0, missing: 0 }
  }

  /*
   * The lifecycle is re-checked here, and again by addSeasonEntrant for every row.
   *
   * The preview was a separate request. `addSeasonEntrant` is the site's own entrant service, so
   * reusing it means this path obeys exactly the same rules as adding somebody by hand — including
   * its own phase gate and its reactivation of a prior withdrawal.
   */
  const season = await prisma.season.findUnique({ where: { id: seasonId }, select: { lifecycleState: true } })
  if (!season || !['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(season.lifecycleState)) {
    return {
      ok: false, error: 'This Season moved past entrant entry while the preview was open. Nothing was added.',
      added: 0, alreadyEntered: 0, ambiguous: 0, missing: 0,
    }
  }

  let added = 0
  for (const p of preview.toAdd) {
    // Idempotent: the service refuses a duplicate, so a rerun adds only what is genuinely new.
    const r = await addSeasonEntrant(actor, seasonId, p.playerId)
    if (r.ok) added++
  }

  /*
   * A run that adds nobody is not an event.
   *
   * Re-running the reconstruction must be provably free of side effects, and an audit entry is a
   * side effect. Only a run that actually changed the field is recorded.
   */
  if (added > 0) await recordAudit(actor, {
    action: 'season.archive.autoentrants',
    entity: 'Season',
    entityId: seasonId,
    newValue: {
      templateKey: preview.templateKey,
      added,
      alreadyEntered: preview.alreadyEntered.length,
      ambiguous: preview.ambiguous.length,
      missing: preview.missing.length,
    },
  })

  return {
    ok: true,
    added,
    alreadyEntered: preview.alreadyEntered.length,
    ambiguous: preview.ambiguous.length,
    missing: preview.missing.length,
  }
}

/** Whether the button belongs on the entrant screen, and what to say when it cannot run. */
export async function autoEntrantsAvailability(seasonId: number): Promise<{ show: boolean; disabledReason: string | null }> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId }, select: { archiveTemplateKey: true, lifecycleState: true },
  })
  if (!season?.archiveTemplateKey) return { show: false, disabledReason: null }

  const entry = manifestEntry(season.archiveTemplateKey)
  if (!entry) return { show: false, disabledReason: null }
  if (!['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(season.lifecycleState)) {
    return { show: false, disabledReason: null }
  }

  /*
   * A shared 2006 stage is NOT blocked here.
   *
   * The block exists so the same group results are not applied to both divisions. Adding people to a
   * Season creates no result and duplicates nothing — and those Seasons need their entrants more
   * than any others, since their group data lives elsewhere.
   */
  if (isSharedStage(entry)) {
    return { show: true, disabledReason: null }
  }
  return { show: true, disabledReason: null }
}

export { SHARED_STAGE_MESSAGE }
