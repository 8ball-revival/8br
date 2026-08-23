import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The 8BRCAM archive manifest: source evidence about historical Seasons.
 *
 * ── Evidence, not records ────────────────────────────────────────────────────────────────────────
 * Every handle in here is a plain string copied from the archive. Loading this file creates no
 * Player, no account, no alias and no entrant, and nothing downstream is allowed to change that —
 * which real person a historical handle belongs to is the owner's decision, made by adding entrants
 * by hand. The manifest only remembers what the source said.
 *
 * ── Raw and normalized are both kept ─────────────────────────────────────────────────────────────
 * `rawHandle` is exactly what the archive wrote. `normalizedHandle` is lower-cased and trimmed and
 * exists only for matching. Replacing the raw value with the tidy one would destroy the only record
 * of the source text, and no later check could tell whether a match was justified.
 */

export interface ManifestParticipant {
  sourceId: string
  rawHandle: string
  normalizedHandle: string
  rawName: string
  normalizedName: string
  /**
   * A status the archive printed beside the handle in the group table — "x", "w/c", "x (7)".
   *
   * Split off the handle at build time, because no account is called "mr.8pac - x" and leaving it
   * attached made every annotated row unmatchable. Kept because it records something real about
   * that player's season; never matched on.
   */
  sourceNote: string | null
  groupName: string
  slot: number
}

export interface ManifestMatch {
  groupName: string
  aSourceId: string
  bSourceId: string
  aRawHandle: string
  bRawHandle: string
  scoreA: number | null
  scoreB: number | null
  winnerSourceId: string | null
  resultKind: 'exact' | 'winner-only' | 'unscored'
}

export interface ManifestStanding {
  groupName: string
  sourceId: string
  slot: number
  played: number | null
  wins: number | null
  losses: number | null
  draws: number | null
  points: number | null
  advanced: boolean | null
}

export interface ManifestPlayoffParticipant {
  sourceId: string
  rawHandle: string
  normalizedHandle: string
  /** The archive's seed. Only meaningful when placement is 'exact'. */
  seed: number | null
  /** First round this player appears in. Above 1 means they started later. */
  firstRound: number
  bye: boolean
  matchNo: number | null
  side: 'a' | 'b' | null
}

export interface ManifestPlayoff {
  /**
   * How much the archive actually knows.
   *
   *  'exact'             — full round-by-round topology: size, slots, byes, later-round starts.
   *  'participants-only' — who took part, and nothing reliable about where. The archive's seeds for
   *                        these Seasons are its own occurrence-count heuristic, not a recorded
   *                        order, so they are never used as placement.
   *  'none'              — no playoff record.
   */
  placement: 'exact' | 'participants-only' | 'none'
  sourceConfidence: string | null
  format: string | null
  bracketSize: number | null
  participants: ManifestPlayoffParticipant[]
  championSourceId: string | null
  runnerUpSourceId: string | null
  unresolved: string[]
}

export type GroupAssignmentState = 'complete' | 'partial' | 'missing' | 'undivided-source'
export type ExactResultState = 'complete' | 'partial' | 'missing'

export interface ManifestEntry {
  templateKey: string
  sourceKey: string
  competitionSlug: '8brcam'
  competitionYear: number
  seasonNumber: number
  division: 'A' | 'B'
  rawSeasonTitle: string
  rawDivision: string
  format: 'GROUPS_THEN_PLAYOFFS'
  /** The archive documents no month for any Season. Always null; never inferred. */
  competitionMonth: null
  gamesPerMatch: number | null
  groupNames: string[]
  participants: ManifestParticipant[]
  matches: ManifestMatch[]
  standings: ManifestStanding[]
  groupAssignments: GroupAssignmentState
  exactResults: ExactResultState
  /**
   * Set for the 2006 Seasons whose group stage ran undivided.
   *
   * Its presence BLOCKS both Auto Assign flows: applying the shared groups to each division would
   * count every result twice, and the archive does not say which group belonged to which division.
   */
  sharedGroupStageSourceKey: string | null
  /**
   * Identities the archive printed in more than one group of this Season.
   *
   * Kept as evidence rather than resolved. Auto Assign refuses to place any identity listed here,
   * because the source does not say which placement was the real one.
   */
  ambiguousPlacements: { sourceId: string; rawHandle: string; groups: string[] }[]
  /** What the archive records about this Season's playoffs. */
  playoff: ManifestPlayoff
  unresolved: string[]
  provenance: {
    sourceFile: string
    sourceSection: string
    sourceYear: number
    sourceMonth: null
    confidence: string
  }
}

export interface UndividedSource {
  sourceKey: string
  seasonId: string
  year: number
  seasonNumber: number
  rawSeasonTitle: string
  groupNames: string[]
  participants: ManifestParticipant[]
  matches: ManifestMatch[]
  standings: ManifestStanding[]
  feedsTemplateKeys: string[]
  note: string
}

export interface Manifest {
  version: 1
  generatedAt: string
  sourceFiles: Record<string, string>
  archiveCounts: Record<string, unknown>
  entries: ManifestEntry[]
  undividedSources: UndividedSource[]
}

const MANIFEST_PATH = join(process.cwd(), 'src/lib/archive/data/8brcam-manifest.json')

let cached: Manifest | null = null

/** Read the manifest once per process. It is a static file; re-reading four megabytes is waste. */
export function loadManifest(): Manifest {
  if (cached) return cached
  cached = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest
  return cached
}


/**
 * Strip a source annotation the archive printed beside a handle in a PLAYOFF table.
 *
 * The manifest builder splits these off group rows — "mr.8pac - x" becomes "mr.8pac" — but playoff
 * rows kept theirs, so 24 handles arrived as "d.aym0 w/c" or "xxl_machine_lxx [w/c]". Matching those
 * literally finds nobody, and creating accounts for them would have minted a second identity for
 * people who already exist; one of them was a handle that had just been merged.
 *
 * "w/c" is the archive's wildcard marker. It records how someone qualified, not who they are.
 */
export function stripSourceNote(handle: string): string {
  return handle
    /*
     * The wildcard marker, in all seven spellings the pages use.
     *
     * "(W/C)", "(WC)", "(w/c)", "(wc)", "W/C", "[w/c]" and "w/c" all appear across the captures,
     * and an earlier version matched only the four containing a slash. The others survived into the
     * handle, so "mvp.bank (WC)" resolved to nobody and the player looked absent from a bracket
     * they were plainly in. It records how somebody qualified, never who they are.
     */
    .replace(/\s*[[(]?\s*w\s*\/?\s*c\s*[\])]?\s*$/i, '')
    /*
     * The printing flourish some bracket pages append to a handle.
     *
     * It survives the capture as a lone 0xAE byte, and was only being removed inside the Wayback
     * parser — so the same person resolved from a parsed handle and failed to resolve from the raw
     * one, leaving four bracket positions empty in 2010 S4A. It belongs here, with the other things
     * the source prints beside a name without meaning them as part of it.
     */
    .replace(/[·•®Â�]+\s*$/, '')
    .replace(/\s*-\s*x$/i, '')
    .trim()
}

export function manifestEntry(templateKey: string): ManifestEntry | null {
  return loadManifest().entries.find((e) => e.templateKey === templateKey) ?? null
}

/** A Season is blocked from Auto Assign when its group stage was shared with another division. */
export function isSharedStage(entry: ManifestEntry): boolean {
  return entry.sharedGroupStageSourceKey != null
}

export const SHARED_STAGE_MESSAGE =
  'Shared group stage — Auto Assign unavailable pending shared-stage support'

// ─────────────────────────────────────────────────────────────────────────────────── validation

export interface ValidationIssue {
  templateKey: string
  problem: string
  detail: string
}

/**
 * Validate the whole manifest.
 *
 * Strict on purpose: this file drives writes to the database later, and a malformed entry that slips
 * through here becomes a wrong Season or a wrong result that somebody has to unpick by hand. Each
 * rule below corresponds to a way the source could be wrong in a way that would not be obvious.
 */
export function validateManifest(m: Manifest = loadManifest()): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (templateKey: string, problem: string, detail: string) =>
    issues.push({ templateKey, problem, detail })

  const seenKeys = new Set<string>()
  const seenIdentity = new Set<string>()

  for (const e of m.entries) {
    if (seenKeys.has(e.templateKey)) add(e.templateKey, 'duplicate template key', e.templateKey)
    seenKeys.add(e.templateKey)

    // Competition, year, number and division together are the Season's natural identity.
    const identity = `${e.competitionSlug}|${e.competitionYear}|${e.seasonNumber}|${e.division}`
    if (seenIdentity.has(identity)) add(e.templateKey, 'duplicate Season identity', identity)
    seenIdentity.add(identity)

    if (e.competitionYear < 2006 || e.competitionYear > 2014) {
      add(e.templateKey, 'year out of range', String(e.competitionYear))
    }
    if (e.division !== 'A' && e.division !== 'B') {
      add(e.templateKey, 'division is not A or B', String(e.division))
    }
    if (!Number.isInteger(e.seasonNumber) || e.seasonNumber < 1) {
      add(e.templateKey, 'invalid Season number', String(e.seasonNumber))
    }
    // The template key encodes the identity; a mismatch means one of the two is wrong.
    const expectedKey = `8brcam-${e.competitionYear}-s${e.seasonNumber}-${e.division.toLowerCase()}`
    if (e.templateKey !== expectedKey) {
      add(e.templateKey, 'template key does not match its identity', `expected ${expectedKey}`)
    }
    if (e.competitionMonth !== null) {
      add(e.templateKey, 'a month was invented', String(e.competitionMonth))
    }
    if (!e.provenance?.sourceFile || !e.provenance?.sourceSection) {
      add(e.templateKey, 'missing provenance', JSON.stringify(e.provenance))
    }

    // One source identity may not sit in two groups: that is either a source error or a person who
    // moved, and either way it cannot be applied without an explanation.
    const groupsById = new Map<string, Set<string>>()
    for (const p of e.participants) {
      const set = groupsById.get(p.sourceId) ?? new Set<string>()
      set.add(p.groupName)
      groupsById.set(p.sourceId, set)
    }
    for (const [sourceId, groups] of groupsById) {
      if (groups.size <= 1) continue
      // Recorded ambiguity is acceptable evidence; an UNRECORDED one is a manifest that would let
      // Auto Assign place somebody the source cannot actually place.
      const recorded = (e.ambiguousPlacements ?? []).some((a) => a.sourceId === sourceId)
      if (!recorded) {
        add(e.templateKey, 'one identity in several groups, not recorded as ambiguous',
          `${sourceId} in ${[...groups].join(', ')}`)
      }
    }
    for (const a of e.ambiguousPlacements ?? []) {
      if (!e.unresolved.some((u) => u.includes(a.sourceId))) {
        add(e.templateKey, 'ambiguous placement missing from the unresolved notes', a.sourceId)
      }
    }

    // A slot within a group must be unique, or two people claim the same seat.
    const slots = new Set<string>()
    for (const p of e.participants) {
      const k = `${p.groupName}#${p.slot}`
      if (slots.has(k)) add(e.templateKey, 'duplicate group slot', k)
      slots.add(k)
    }

    for (const p of e.participants) {
      if (!p.rawHandle) add(e.templateKey, 'participant with no raw handle', p.sourceId)
      if (p.normalizedHandle !== p.rawHandle.trim().toLowerCase()) {
        add(e.templateKey, 'normalized handle does not match its raw value', p.rawHandle)
      }
    }

    const known = new Set(e.participants.map((p) => p.sourceId))
    for (const mt of e.matches) {
      if (mt.aSourceId === mt.bSourceId) {
        add(e.templateKey, 'a player matched against themselves', mt.aSourceId)
      }
      if (!known.has(mt.aSourceId) || !known.has(mt.bSourceId)) {
        add(e.templateKey, 'match names somebody not in the groups', `${mt.aSourceId} v ${mt.bSourceId}`)
      }
      if (mt.resultKind === 'exact') {
        if (mt.scoreA == null || mt.scoreB == null) {
          add(e.templateKey, 'exact result with a missing score', `${mt.aSourceId} v ${mt.bSourceId}`)
        } else if (mt.scoreA < 0 || mt.scoreB < 0 || !Number.isInteger(mt.scoreA) || !Number.isInteger(mt.scoreB)) {
          add(e.templateKey, 'impossible score', `${mt.scoreA}-${mt.scoreB}`)
        }
      }
      if (mt.winnerSourceId && mt.winnerSourceId !== mt.aSourceId && mt.winnerSourceId !== mt.bSourceId) {
        add(e.templateKey, 'winner is not one of the two players', String(mt.winnerSourceId))
      }
      if (!e.groupNames.includes(mt.groupName)) {
        add(e.templateKey, 'match in a group the Season does not have', mt.groupName)
      }
    }

    // A shared stage must say so in its unresolved notes, or the UI has nothing to warn with.
    if (e.sharedGroupStageSourceKey && !e.unresolved.some((u) => u.includes('Shared group stage'))) {
      add(e.templateKey, 'shared stage not flagged in unresolved notes', e.sharedGroupStageSourceKey)
    }
    if (e.sharedGroupStageSourceKey && e.participants.length > 0) {
      add(e.templateKey, 'a shared-stage Season must not carry its own participants',
        `${e.participants.length} present`)
    }
  }

  for (const u of m.undividedSources) {
    if (u.feedsTemplateKeys.length === 0) {
      add(u.sourceKey, 'undivided source feeds no Season', u.sourceKey)
    }
    for (const k of u.feedsTemplateKeys) {
      if (!seenKeys.has(k)) add(u.sourceKey, 'undivided source names an unknown Season', k)
    }
  }

  return issues
}

/** Everything the Creator page needs to describe a template at a glance. */
export interface TemplateStatus {
  templateKey: string
  exists: boolean
  sharedStage: boolean
  sharedStageMessage: string | null
  groupAssignments: GroupAssignmentState
  exactResults: ExactResultState
  participantCount: number
  groupCount: number
  exactMatchCount: number
  standingsOnly: boolean
  unresolvedCount: number
  unresolved: string[]
  /** Identities Auto Assign will refuse to place, because the source contradicts itself. */
  ambiguousCount: number
  playoffPlacement: 'exact' | 'participants-only' | 'none'
  playoffParticipants: number
  playoffBracketSize: number | null
}

export function templateStatus(templateKey: string): TemplateStatus {
  const e = manifestEntry(templateKey)
  if (!e) {
    return {
      templateKey, exists: false, sharedStage: false, sharedStageMessage: null,
      groupAssignments: 'missing', exactResults: 'missing',
      participantCount: 0, groupCount: 0, exactMatchCount: 0,
      standingsOnly: false, unresolvedCount: 0, unresolved: [], ambiguousCount: 0,
      playoffPlacement: 'none', playoffParticipants: 0, playoffBracketSize: null,
    }
  }
  const exactMatchCount = e.matches.filter((m) => m.resultKind === 'exact').length
  return {
    templateKey,
    exists: true,
    sharedStage: isSharedStage(e),
    sharedStageMessage: isSharedStage(e) ? SHARED_STAGE_MESSAGE : null,
    groupAssignments: e.groupAssignments,
    exactResults: e.exactResults,
    participantCount: e.participants.length,
    groupCount: e.groupNames.length,
    exactMatchCount,
    // Standings but no match-level scores: the archive knows the table and not how it was reached.
    standingsOnly: exactMatchCount === 0 && e.standings.length > 0,
    unresolvedCount: e.unresolved.length,
    unresolved: e.unresolved,
    ambiguousCount: (e.ambiguousPlacements ?? []).length,
    playoffPlacement: e.playoff?.placement ?? 'none',
    playoffParticipants: e.playoff?.participants.length ?? 0,
    playoffBracketSize: e.playoff?.bracketSize ?? null,
  }
}
