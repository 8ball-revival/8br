/**
 * Matching archived handles to the entrants the owner has already chosen.
 *
 * ── The one rule everything else follows from ────────────────────────────────────────────────────
 * This NEVER searches outside the Season's selected entrants, and it never creates anybody. The
 * archive says "trojan_man played in Group C"; only the owner knows which real account that is, and
 * they say so by adding that Player as an entrant. If they have not, the handle stays unresolved.
 * A matcher that could reach further would eventually attach a historical result to the wrong
 * person, and nobody would notice for years.
 *
 * ── Conservative by construction ─────────────────────────────────────────────────────────────────
 * The rules run in confidence order and stop at the first hit. Everything looser than exact text is
 * either refused or downgraded to a SUGGESTION, which is shown and never applied. Where two entrants
 * could be the same archived person, that is ambiguity — the answer is "I do not know", not a
 * coin toss.
 *
 * Pure. No database, no imports beyond types, so every rule can be tested directly.
 */

export type MatchReason =
  | 'exact-cueverse-id'
  | 'exact-alias'
  | 'exact-archive-handle'
  | 'case-and-space'
  | 'punctuation'
  | 'second-spelling'
  | 'suggestion-only'

export type MatchConfidence = 'exact' | 'high' | 'suggestion'

/** How confident each rule is, and whether Auto Assign may act on it without being asked. */
export const RULE_CONFIDENCE: Record<MatchReason, { confidence: MatchConfidence; autoApply: boolean; label: string }> = {
  'exact-cueverse-id':   { confidence: 'exact',      autoApply: true,  label: 'CueVerse ID matches exactly' },
  'exact-alias':         { confidence: 'exact',      autoApply: true,  label: 'a saved alias matches exactly' },
  'exact-archive-handle':{ confidence: 'exact',      autoApply: true,  label: 'this Player already carries that archive handle' },
  'case-and-space':      { confidence: 'high',       autoApply: true,  label: 'matches apart from capitals or spacing' },
  'punctuation':         { confidence: 'high',       autoApply: true,  label: 'matches once punctuation is ignored, and only one entrant does' },
  'second-spelling':     { confidence: 'high',       autoApply: true,  label: 'the same person the source already named under another spelling' },
  'suggestion-only':     { confidence: 'suggestion', autoApply: false, label: 'looks similar — needs a person to confirm' },
}

/** One entrant already added to the Season, with every identity string they answer to. */
export interface EntrantIdentity {
  entrantId: number
  playerId: string
  /** Preferred Name. Never sufficient on its own — see the note in `matchHandles`. */
  displayName: string | null
  cueverseId: string | null
  /** Saved aliases from the canonical identity system. */
  aliases: string[]
  /** Historical handles already attached to this Player. */
  archiveHandles: string[]
}

export interface ArchiveIdentity {
  sourceId: string
  rawHandle: string
  normalizedHandle: string
  rawName: string
  groupName: string
  slot: number
}

export interface HandleMatch {
  sourceId: string
  rawHandle: string
  groupName: string
  slot: number
  entrantId: number
  playerId: string
  displayName: string | null
  cueverseId: string | null
  reason: MatchReason
  confidence: MatchConfidence
  reasonLabel: string
}

export interface UnresolvedHandle {
  sourceId: string
  rawHandle: string
  groupName: string
  slot: number
  reason:
    | 'player-not-among-entrants'
    | 'multiple-possible-entrants'
    | 'ambiguous-source-placement'
    | 'entrant-already-used'
  /** Plain language, for the report the owner reads. */
  message: string
  /** Never applied. Offered so a person can confirm one. */
  suggestions: { entrantId: number; playerId: string; displayName: string | null; cueverseId: string | null; why: string }[]
}

export interface MatchResult {
  matched: HandleMatch[]
  unresolved: UnresolvedHandle[]
  /** Entrants the owner added who do not appear in the archive at all. Left alone, never removed. */
  unusedEntrants: EntrantIdentity[]
}

const norm = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase()

/**
 * Strip everything that is not a letter or a digit.
 *
 * Used only for the last automatic rule, and only when it produces exactly ONE candidate. Archive
 * handles are full of underscores, dots and dashes that were typed inconsistently — `Top_Dog___` and
 * `top.dog` are plainly the same person — but the same stripping makes `x_1` and `x1` identical too,
 * so a collision means the rule cannot be trusted here and the handle goes to unresolved instead.
 */
const punctuationKey = (v: string | null | undefined): string =>
  (v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Match a Season's archived identities against its selected entrants.
 *
 * ── Preferred Name is deliberately not a rule ────────────────────────────────────────────────────
 * Two people can share a display name, and a display name is editable — so matching on it would
 * quietly attach somebody's historical record to whoever happens to be called that today. It appears
 * only as a SUGGESTION, and only when it is unique.
 *
 * ── Each side is used once ───────────────────────────────────────────────────────────────────────
 * An entrant claimed by one archived handle is out of the running for the rest, and vice versa. Two
 * archived people cannot collapse into one account, which is exactly what a careless matcher does
 * when a handle appears twice in a source.
 */
export function matchHandles(
  archive: ArchiveIdentity[],
  entrants: EntrantIdentity[],
  opts: {
    /** Source identities the manifest recorded as contradicting themselves. Never placed. */
    ambiguousSourceIds?: string[]
    /** Season-scoped resolutions the owner has confirmed: sourceId → entrantId. */
    manualResolutions?: Record<string, number>
  } = {},
): MatchResult {
  const ambiguous = new Set(opts.ambiguousSourceIds ?? [])
  const manual = opts.manualResolutions ?? {}

  const available = new Map(entrants.map((e) => [e.entrantId, e]))
  const matched: HandleMatch[] = []
  const unresolved: UnresolvedHandle[] = []

  /** Entrants that have been claimed, kept so a second spelling of the same person can find them. */
  const claimed = new Map<number, EntrantIdentity>()

  const claim = (entrant: EntrantIdentity, a: ArchiveIdentity, reason: MatchReason) => {
    available.delete(entrant.entrantId)
    claimed.set(entrant.entrantId, entrant)
    matched.push({
      sourceId: a.sourceId,
      rawHandle: a.rawHandle,
      groupName: a.groupName,
      slot: a.slot,
      entrantId: entrant.entrantId,
      playerId: entrant.playerId,
      displayName: entrant.displayName,
      cueverseId: entrant.cueverseId,
      reason,
      confidence: RULE_CONFIDENCE[reason].confidence,
      reasonLabel: RULE_CONFIDENCE[reason].label,
    })
  }

  /*
   * Ordered by confidence, and each pass runs across ALL handles before the next begins.
   *
   * That matters: if a loose rule ran on handle 1 before the exact rule ran on handle 2, the loose
   * match could take an entrant that handle 2 was entitled to. Passing in confidence order means a
   * weaker rule can only ever claim what no stronger rule wanted.
   */
  const pending = archive.filter((a) => {
    if (!ambiguous.has(a.sourceId)) return true
    unresolved.push({
      sourceId: a.sourceId,
      rawHandle: a.rawHandle,
      groupName: a.groupName,
      slot: a.slot,
      reason: 'ambiguous-source-placement',
      message: `The archive places "${a.rawHandle}" in more than one group of this Season, so it cannot say where they belong.`,
      suggestions: [],
    })
    return false
  })

  const remaining = new Set(pending.map((a) => a.sourceId))

  // Pass 0 — resolutions the owner confirmed for this Season. Their word beats every rule.
  for (const a of pending) {
    const entrantId = manual[a.sourceId]
    if (entrantId == null) continue
    const e = available.get(entrantId)
    if (!e) continue
    claim(e, a, 'exact-cueverse-id')
    remaining.delete(a.sourceId)
  }

  const passes: { reason: MatchReason; key: (e: EntrantIdentity) => string[]; target: (a: ArchiveIdentity) => string }[] = [
    { reason: 'exact-cueverse-id',    key: (e) => [norm(e.cueverseId)],                    target: (a) => a.normalizedHandle },
    { reason: 'exact-alias',          key: (e) => e.aliases.map(norm),                     target: (a) => a.normalizedHandle },
    { reason: 'exact-archive-handle', key: (e) => e.archiveHandles.map(norm),              target: (a) => a.normalizedHandle },
    // Case and surrounding space are already folded by `norm`, so this pass exists to catch INNER
    // whitespace differences, which the earlier passes treat as distinct text.
    { reason: 'case-and-space',       key: (e) => [norm(e.cueverseId).replace(/\s+/g, ''), ...e.aliases.map((x) => norm(x).replace(/\s+/g, ''))], target: (a) => a.normalizedHandle.replace(/\s+/g, '') },
    { reason: 'punctuation',          key: (e) => [punctuationKey(e.cueverseId), ...e.aliases.map(punctuationKey), ...e.archiveHandles.map(punctuationKey)], target: (a) => punctuationKey(a.rawHandle) },
  ]

  for (const pass of passes) {
    for (const a of pending) {
      if (!remaining.has(a.sourceId)) continue
      const want = pass.target(a)
      if (!want) continue

      const candidates = [...available.values()].filter((e) => pass.key(e).filter(Boolean).includes(want))
      if (candidates.length === 1) {
        claim(candidates[0], a, pass.reason)
        remaining.delete(a.sourceId)
      } else if (candidates.length > 1) {
        // Two entrants answer to the same string. That is not a match, it is a question.
        unresolved.push({
          sourceId: a.sourceId,
          rawHandle: a.rawHandle,
          groupName: a.groupName,
          slot: a.slot,
          reason: 'multiple-possible-entrants',
          message: `More than one selected entrant could be "${a.rawHandle}".`,
          suggestions: candidates.map((c) => ({
            entrantId: c.entrantId, playerId: c.playerId, displayName: c.displayName,
            cueverseId: c.cueverseId, why: RULE_CONFIDENCE[pass.reason].label,
          })),
        })
        remaining.delete(a.sourceId)
      }
    }
  }

  /*
   * ── One person, two spellings, one entrant ────────────────────────────────────────────────────
   * A player who changed their CueVerse ID mid-Season appears in the source twice: the group table
   * under the old handle, the bracket under the new one. The owner's identity decisions make both
   * spellings resolve to the same Player -- and that is when this became visible, because the first
   * spelling claims the entrant and the second then finds nobody left.
   *
   * Reporting that second spelling as a participant with no entrant is wrong twice over: it invents
   * a missing person the source never had, and it stalls the import of a Season whose field is
   * actually complete. So a leftover handle that names an ALREADY-CLAIMED entrant is recorded as
   * what it is -- another spelling of somebody already matched.
   *
   * The guard is the group. If the source puts the two spellings in different groups they cannot be
   * one person in one competition, and that is a contradiction to report rather than fold away.
   */
  for (const a of pending) {
    if (!remaining.has(a.sourceId)) continue
    const want = punctuationKey(a.rawHandle)
    if (!want) continue

    const sameEntrant = [...claimed.values()].filter((e) =>
      [punctuationKey(e.cueverseId), ...e.aliases.map(punctuationKey), ...e.archiveHandles.map(punctuationKey)]
        .filter(Boolean)
        .includes(want))
    if (sameEntrant.length !== 1) continue

    const entrant = sameEntrant[0]
    const firstSpelling = matched.find((m) => m.entrantId === entrant.entrantId)
    if (a.groupName && firstSpelling?.groupName && a.groupName !== firstSpelling.groupName) continue

    matched.push({
      sourceId: a.sourceId,
      rawHandle: a.rawHandle,
      groupName: a.groupName,
      slot: a.slot,
      entrantId: entrant.entrantId,
      playerId: entrant.playerId,
      displayName: entrant.displayName,
      cueverseId: entrant.cueverseId,
      reason: 'second-spelling',
      confidence: RULE_CONFIDENCE['second-spelling'].confidence,
      reasonLabel: RULE_CONFIDENCE['second-spelling'].label,
    })
    remaining.delete(a.sourceId)
  }

  // Whatever is left has no entrant. Offer a suggestion where one is obvious, and apply none of it.
  for (const a of pending) {
    if (!remaining.has(a.sourceId)) continue
    const key = punctuationKey(a.rawHandle)
    const nameKey = norm(a.rawName)
    const suggestions = [...available.values()]
      .map((e) => {
        // Preferred Name only ever appears here, as something for a person to confirm.
        if (nameKey && norm(e.displayName) === nameKey) return { e, why: 'Preferred Name is the same — confirm before using' }
        if (key && key.length >= 4 && punctuationKey(e.cueverseId).includes(key)) return { e, why: 'CueVerse ID contains the archived handle' }
        if (key && key.length >= 4 && key.includes(punctuationKey(e.cueverseId)) && punctuationKey(e.cueverseId).length >= 4) {
          return { e, why: 'archived handle contains their CueVerse ID' }
        }
        return null
      })
      .filter((x): x is { e: EntrantIdentity; why: string } => x != null)
      .slice(0, 5)

    unresolved.push({
      sourceId: a.sourceId,
      rawHandle: a.rawHandle,
      groupName: a.groupName,
      slot: a.slot,
      reason: 'player-not-among-entrants',
      message: `No selected entrant matches "${a.rawHandle}" by CueVerse ID, alias or archive handle.`,
      suggestions: suggestions.map((s) => ({
        entrantId: s.e.entrantId, playerId: s.e.playerId, displayName: s.e.displayName,
        cueverseId: s.e.cueverseId, why: s.why,
      })),
    })
  }

  return {
    matched,
    unresolved,
    // Everything still available was added by the owner and is not in the archive. It stays.
    unusedEntrants: [...available.values()],
  }
}

/** Plain-language reasons, for the copyable report. */
export const UNRESOLVED_LABEL: Record<UnresolvedHandle['reason'], string> = {
  'player-not-among-entrants': 'Player not among current entrants',
  'multiple-possible-entrants': 'Multiple possible entrants',
  'ambiguous-source-placement': 'Unsupported or ambiguous archive entry',
  'entrant-already-used': 'That entrant is already matched to another archive handle',
}
