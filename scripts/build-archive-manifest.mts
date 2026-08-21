/**
 * Turn the 8BRCAM archive into a validated, version-controlled manifest.
 *
 * ── What a manifest is for ───────────────────────────────────────────────────────────────────────
 * It is source EVIDENCE, not records. Every archived handle stays a plain string: importing this
 * file must never create a Player, an account, an alias or an entrant, because the whole point of
 * the reconstruction workflow is that the owner decides which real person each historical handle
 * corresponds to. The manifest only remembers what the archive said.
 *
 * ── Raw and normalized, both kept ────────────────────────────────────────────────────────────────
 * Every handle is stored twice: exactly as the archive wrote it, and lower-cased and trimmed for
 * matching. Overwriting the raw value with a tidied one would destroy the only copy of what the
 * source actually said, and there would be no way to check a match later.
 *
 * Read-only against the database. Writes one JSON file.
 *
 *   npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/build-archive-manifest.mts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

const ARCHIVE_DIR = 'C:/Claude/Archive Viewer/8BRCAM'
const JSON_SOURCE = `${ARCHIVE_DIR}/8brcam-season-archive.json`
const HTML_SOURCE = `${ARCHIVE_DIR}/8brcam-season-archive.html`
const INVENTORY = 'verification/archive-8brcam/inventory.json'
const OUT_DIR = 'src/lib/archive/data'
const OUT = `${OUT_DIR}/8brcam-manifest.json`

const sha256 = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex')

/** Lower-cased and trimmed. Deliberately nothing else — see `punctuationKey` for the looser one. */
export const normalizeHandle = (raw: string): string => raw.trim().toLowerCase()

interface RawMatch { a: string; b: string; sa: number | null; sb: number | null; w: string | null }
interface RawRow { pid: string; slot: number; played?: number; wins?: number; losses?: number; draws?: number; points?: number; total?: number; bonus?: number; adv?: boolean }
interface RawGroup { id: string; letter: string; scoreModel?: string; rows: RawRow[]; matches: RawMatch[] }
interface RawPlayoffMatch { no: number; a: string | null; b: string | null; score: string | null; w: string | null; l: string | null }
interface RawPlayoffRound { round: number; name: string; matches: RawPlayoffMatch[] }
interface RawPlayoff {
  format?: string
  champion?: { pid: string; handle: string } | null
  runnerUp?: { pid: string; handle: string } | null
  confidence?: string
  reconstructed?: boolean
  seeds?: Record<string, number>
  rounds?: RawPlayoffRound[]
}

interface RawSeason {
  key: string; seasonId: string; year: number; period: number
  division: 'A' | 'B' | 'single'; label: string; divisionLabel?: string
  groupStatus?: string; completeness?: string; notes?: string
  gamesPerMatch?: number; entrants?: number
  groups: RawGroup[]
  playoff?: RawPlayoff | null
}
interface RawArchive {
  meta: { counts: Record<string, unknown> }
  players: Record<string, { id: string; name: string; handle: string }>
  seasons: RawSeason[]
}

export interface ManifestParticipant {
  /** The archive's own identity id. Stable within the source; meaningless outside it. */
  sourceId: string
  /** Exactly as the archive wrote it. Never overwritten. */
  rawHandle: string
  /** Lower-cased and trimmed, for matching only. */
  normalizedHandle: string
  rawName: string
  normalizedName: string
  /** A status the archive printed beside the handle — "x", "w/c", "x (7)". Kept, never matched on. */
  sourceNote: string | null
  groupName: string
  /** Position within the group as the archive printed it. */
  slot: number
}

export interface ManifestMatch {
  groupName: string
  aSourceId: string
  bSourceId: string
  aRawHandle: string
  bRawHandle: string
  /** Null when the archive recorded a pairing without a numeric score. */
  scoreA: number | null
  scoreB: number | null
  winnerSourceId: string | null
  /** 'exact' when both scores are present; 'winner-only'; or 'unscored'. */
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
  /** True when their first-round match had no opponent. */
  bye: boolean
  /** Position in the first round they appear in, when the topology is exact. */
  matchNo: number | null
  side: 'a' | 'b' | null
}

export interface ManifestPlayoff {
  /**
   * How much the archive actually knows.
   *
   *  'exact'             — full round-by-round topology: bracket size, slots, byes and later-round
   *                        starts are all documented.
   *  'participants-only' — the archive lists who took part and nothing reliable about where. Its
   *                        `seeds` for these Seasons are the viewer's own occurrence-count heuristic,
   *                        not a recorded seeding, so they are NOT treated as placement.
   *  'none'              — no playoff record at all.
   */
  placement: 'exact' | 'participants-only' | 'none'
  /** The archive's own words, kept so the UI can be honest about provenance. */
  sourceConfidence: string | null
  format: string | null
  /** Slots in the first round, when the topology is exact. Null when it cannot be established. */
  bracketSize: number | null
  participants: ManifestPlayoffParticipant[]
  championSourceId: string | null
  runnerUpSourceId: string | null
  unresolved: string[]
}

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
  /** The archive documents no month anywhere. Never invented. */
  competitionMonth: null
  gamesPerMatch: number | null
  groupNames: string[]
  participants: ManifestParticipant[]
  matches: ManifestMatch[]
  standings: ManifestStanding[]
  groupAssignments: 'complete' | 'partial' | 'missing' | 'undivided-source'
  exactResults: 'complete' | 'partial' | 'missing'
  /**
   * The 2006 case: the group stage ran undivided and only the playoffs split. This names the source
   * entry holding the shared groups, and its presence BLOCKS both Auto Assign flows for this Season.
   */
  sharedGroupStageSourceKey: string | null
  /**
   * One archived identity printed in more than one group of the same Season.
   *
   * A real thing in the source — somebody moved group mid-Season, or the table was typed twice — and
   * the archive never says which placement is the right one. Both rows are kept exactly as found and
   * the identity is listed here so Auto Assign refuses to place it rather than picking one.
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

/** The undivided 2006 group stages, preserved whole rather than split between divisions. */
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
  /** Which divisional Seasons draw their playoffs from this shared stage. */
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

/**
 * The name to show for an archived person, and to match on.
 *
 * A handful of archive records carry an EMPTY handle and keep the person's identity in `name`
 * instead — `hazardhous_hustla` and `perfect.skillz` are handles by any reading, they just landed in
 * the wrong column. `?? pid` does not catch that, because an empty string is not null, and the
 * result is a blank row in the "no account exists for these" report: a player the owner is told to
 * create without being told who. Falling back to the name, and only then to the source id, keeps
 * every row nameable.
 */
function sourceHandle(p: { handle?: string; name?: string } | undefined, pid: string): string {
  const handle = splitSourceNote((p?.handle ?? '').trim()).handle
  if (handle) return handle
  const name = (p?.name ?? '').trim()
  return name || pid
}

/**
 * Separate an archived handle from the status the archive printed next to it.
 *
 * The original group tables annotate some rows: `mr.8pac - x`, `badass_drummer - w/c`,
 * `krazy_kevy - x (4)`, `ta.lent (wc)` — three spellings of the same idea, one of them without any
 * separator at all. The scraper captured the annotation as part of the handle and gave that
 * spelling its own player id, so the SAME person exists twice in the source — once annotated in the
 * group table, once plain in the playoff bracket. Nothing matches an annotated handle, because no
 * account is called "mr.8pac - x", and a whole Season's group results end up unresolved.
 *
 * Verified against the source before doing this: the suffix appears only in group tables, its
 * unsuffixed twin only in playoff brackets, both carry the same person's name, and stripping
 * introduces no duplicate inside any single table. The note is kept rather than discarded — it
 * records something real about that player's season — it just is not part of their name.
 *
 * Deliberately narrow: only the exact markers the archive actually uses, anchored at the end. Of the
 * handles that contain a space at all, the trailing token is one of these markers or one of `91`,
 * `d`, `yo`, `girl`, `rite`, `star*` — real words in real names. A general "strip the last word" or
 * "strip anything after a dash" rule would eat those.
 */
const SOURCE_NOTE = /\s+(?:[-–]\s+(?:x|w\/c)|\(wc\))(?:\s*\(\d+\))?$/i

export function splitSourceNote(raw: string): { handle: string; note: string | null } {
  const m = raw.match(SOURCE_NOTE)
  if (!m) return { handle: raw, note: null }
  return { handle: raw.slice(0, m.index).trim(), note: m[0].replace(/^\s*[-–]?\s*/, '').trim() }
}

function buildParticipants(groups: RawGroup[], players: RawArchive['players']): ManifestParticipant[] {
  const out: ManifestParticipant[] = []
  for (const g of groups) {
    for (const r of g.rows) {
      const p = players[r.pid]
      const rawHandle = sourceHandle(p, r.pid)
      const rawName = p?.name ?? ''
      out.push({
        sourceId: r.pid,
        rawHandle,
        normalizedHandle: normalizeHandle(rawHandle),
        rawName,
        normalizedName: normalizeHandle(rawName),
        sourceNote: splitSourceNote((p?.handle ?? '').trim()).note,
        groupName: g.letter,
        slot: r.slot,
      })
    }
  }
  return out
}

function buildMatches(groups: RawGroup[], players: RawArchive['players']): ManifestMatch[] {
  const out: ManifestMatch[] = []
  for (const g of groups) {
    for (const m of g.matches ?? []) {
      const exact = typeof m.sa === 'number' && typeof m.sb === 'number'
      out.push({
        groupName: g.letter,
        aSourceId: m.a,
        bSourceId: m.b,
        // Through the same helper as the participants, so a match reads with the same names the
        // rest of the manifest uses — no annotation, no blank where the handle column was empty.
        aRawHandle: sourceHandle(players[m.a], m.a),
        bRawHandle: sourceHandle(players[m.b], m.b),
        scoreA: exact ? m.sa : null,
        scoreB: exact ? m.sb : null,
        winnerSourceId: m.w ?? null,
        resultKind: exact ? 'exact' : m.w ? 'winner-only' : 'unscored',
      })
    }
  }
  return out
}

/**
 * What the archive knows about one Season's playoffs.
 *
 * ── The distinction that matters ─────────────────────────────────────────────────────────────────
 * Two thirds of these Seasons carry `confidence: heuristic(occurrence-count)` and a single round that
 * simply lists who appeared. Their `seeds` are the archive VIEWER's guess, derived by counting how
 * often a name occurs — not a seeding anybody recorded. Treating that as placement would put players
 * in slots the source never claimed, and it would be indistinguishable from real data afterwards. So
 * those Seasons yield participants and nothing else.
 *
 * The remaining Seasons carry `confidence: exact` with the full round-by-round topology, and those
 * give real bracket size, slots, byes and later-round starts.
 */
function buildPlayoff(po: RawPlayoff | null | undefined, players: RawArchive['players']): ManifestPlayoff {
  const rounds = po?.rounds ?? []
  const unresolved: string[] = []

  if (!po || rounds.length === 0) {
    return {
      placement: 'none', sourceConfidence: po?.confidence ?? null, format: po?.format ?? null,
      bracketSize: null, participants: [], championSourceId: null, runnerUpSourceId: null,
      unresolved: ['The archive holds no playoff record for this Season.'],
    }
  }

  const exact = po.confidence === 'exact' && rounds.length > 1
  const seeds = po.seeds ?? {}

  // First appearance decides a player's entry point; byes are a first-round match with no opponent.
  const first = new Map<string, { round: number; matchNo: number; side: 'a' | 'b'; bye: boolean }>()
  for (const r of rounds) {
    for (const m of r.matches ?? []) {
      for (const side of ['a', 'b'] as const) {
        const pid = m[side]
        // A self-match (a === b) is how the single-round listings pad a name; it is not a pairing.
        if (!pid || (m.a === m.b && side === 'b')) continue
        if (first.has(pid)) continue
        first.set(pid, {
          round: r.round,
          matchNo: m.no,
          side,
          bye: r.round === 1 && (m.b == null || m.a === m.b),
        })
      }
    }
  }

  const participants: ManifestPlayoffParticipant[] = [...first.entries()].map(([sourceId, at]) => {
    const raw = sourceHandle(players[sourceId], sourceId)
    return {
      sourceId,
      rawHandle: raw,
      normalizedHandle: normalizeHandle(raw),
      seed: exact ? (seeds[sourceId] ?? null) : null,
      firstRound: at.round,
      bye: exact ? at.bye : false,
      matchNo: exact ? at.matchNo : null,
      side: exact ? at.side : null,
    }
  })

  const r1 = rounds.find((r) => r.round === 1)
  const bracketSize = exact && r1 ? (r1.matches?.length ?? 0) * 2 : null

  if (!exact) {
    unresolved.push(
      `The archive lists ${participants.length} playoff participant(s) but records no bracket `
      + `placement — its seeding for this Season is an occurrence-count heuristic, not a recorded `
      + 'order. Participants can be selected; positions must be set by hand.',
    )
  }
  const later = participants.filter((p) => p.firstRound > 1)
  if (exact && later.length > 0) {
    unresolved.push(`${later.length} player(s) enter after round 1 and are placed at that round.`)
  }

  return {
    placement: exact ? 'exact' : 'participants-only',
    sourceConfidence: po.confidence ?? null,
    format: po.format ?? null,
    bracketSize,
    participants,
    championSourceId: po.champion?.pid ?? null,
    runnerUpSourceId: po.runnerUp?.pid ?? null,
    unresolved,
  }
}

function buildStandings(groups: RawGroup[]): ManifestStanding[] {
  const out: ManifestStanding[] = []
  for (const g of groups) {
    for (const r of g.rows) {
      out.push({
        groupName: g.letter,
        sourceId: r.pid,
        slot: r.slot,
        played: r.played ?? null,
        wins: r.wins ?? null,
        losses: r.losses ?? null,
        draws: r.draws ?? null,
        points: r.total ?? r.points ?? null,
        advanced: r.adv ?? null,
      })
    }
  }
  return out
}

function main() {
  const archive = JSON.parse(readFileSync(JSON_SOURCE, 'utf8')) as RawArchive
  const inventory = JSON.parse(readFileSync(INVENTORY, 'utf8')) as {
    entries: { templateKey: string; sourceKey: string; classification: string; groupAssignments: string; exactResults: string; unresolved: string[]; provenance: Record<string, unknown> }[]
  }

  const bySourceKey = new Map(archive.seasons.map((s) => [s.key, s]))
  const included = inventory.entries.filter((e) => e.classification === 'included')

  const entries: ManifestEntry[] = []
  const undividedByKey = new Map<string, UndividedSource>()

  for (const inv of included) {
    const s = bySourceKey.get(inv.sourceKey)
    if (!s) throw new Error(`inventory names a source key the archive does not have: ${inv.sourceKey}`)
    if (s.division !== 'A' && s.division !== 'B') throw new Error(`included entry is not divisional: ${s.key}`)

    // The undivided sibling, where one exists.
    const sibling = inv.groupAssignments === 'undivided-source'
      ? archive.seasons.find((x) => x.seasonId === s.seasonId && x.division === 'single')
      : undefined

    const entry: ManifestEntry = {
      templateKey: inv.templateKey,
      sourceKey: s.key,
      competitionSlug: '8brcam',
      competitionYear: s.year,
      seasonNumber: s.period,
      division: s.division,
      rawSeasonTitle: s.label,
      rawDivision: s.divisionLabel ?? s.division,
      format: 'GROUPS_THEN_PLAYOFFS',
      competitionMonth: null,
      gamesPerMatch: s.gamesPerMatch ?? null,
      groupNames: (s.groups ?? []).map((g) => g.letter),
      participants: buildParticipants(s.groups ?? [], archive.players),
      matches: buildMatches(s.groups ?? [], archive.players),
      standings: buildStandings(s.groups ?? []),
      ambiguousPlacements: [],
      playoff: buildPlayoff(s.playoff, archive.players),
      groupAssignments: inv.groupAssignments as ManifestEntry['groupAssignments'],
      exactResults: inv.exactResults as ManifestEntry['exactResults'],
      sharedGroupStageSourceKey: sibling?.key ?? null,
      unresolved: [...inv.unresolved],
      provenance: {
        sourceFile: '8brcam-season-archive.json',
        sourceSection: `seasons[key=${s.key}]`,
        sourceYear: s.year,
        sourceMonth: null,
        confidence: String(inv.provenance.confidence ?? 'unknown'),
      },
    }

    /*
     * Detect an identity printed in two groups before anything downstream sees it.
     *
     * Recorded rather than resolved: the raw rows both stay, and Auto Assign will skip the identity
     * as ambiguous. Choosing one of the two placements here would be a guess wearing the clothes of
     * a fact.
     */
    const placementsById = new Map<string, Set<string>>()
    for (const part of entry.participants) {
      const set = placementsById.get(part.sourceId) ?? new Set<string>()
      set.add(part.groupName)
      placementsById.set(part.sourceId, set)
    }
    for (const [sourceId, groups] of placementsById) {
      if (groups.size < 2) continue
      const raw = entry.participants.find((x) => x.sourceId === sourceId)?.rawHandle ?? sourceId
      entry.ambiguousPlacements.push({ sourceId, rawHandle: raw, groups: [...groups].sort() })
      entry.unresolved.push(
        `Archive places "${raw}" (${sourceId}) in more than one group: ${[...groups].sort().join(', ')}. `
        + 'The source does not say which is correct, so Auto Assign will not place this entrant.',
      )
    }

    if (sibling) {
      entry.unresolved.push(
        'Shared group stage — Auto Assign unavailable pending shared-stage support.',
      )
      const existing = undividedByKey.get(sibling.key)
      if (existing) {
        existing.feedsTemplateKeys.push(entry.templateKey)
      } else {
        undividedByKey.set(sibling.key, {
          sourceKey: sibling.key,
          seasonId: sibling.seasonId,
          year: sibling.year,
          seasonNumber: sibling.period,
          rawSeasonTitle: sibling.label,
          groupNames: (sibling.groups ?? []).map((g) => g.letter),
          participants: buildParticipants(sibling.groups ?? [], archive.players),
          matches: buildMatches(sibling.groups ?? [], archive.players),
          standings: buildStandings(sibling.groups ?? []),
          feedsTemplateKeys: [entry.templateKey],
          note:
            'The group stage ran undivided and only the playoffs split into Divisions A and B. The '
            + 'archive does not record which division each group belonged to, so these groups are kept '
            + 'whole here and are never split between the two Seasons. Duplicating them into both '
            + 'divisions would count every result twice.',
        })
      }
    }

    entries.push(entry)
  }

  const manifest: Manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceFiles: {
      '8brcam-season-archive.json': sha256(JSON_SOURCE),
      '8brcam-season-archive.html': sha256(HTML_SOURCE),
    },
    archiveCounts: archive.meta.counts,
    entries,
    undividedSources: [...undividedByKey.values()],
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT, JSON.stringify(manifest, null, 1))

  console.log(`manifest → ${OUT}`)
  console.log(`  entries              ${manifest.entries.length}`)
  console.log(`  division A           ${entries.filter((e) => e.division === 'A').length}`)
  console.log(`  division B           ${entries.filter((e) => e.division === 'B').length}`)
  console.log(`  participants         ${entries.reduce((n, e) => n + e.participants.length, 0)}`)
  console.log(`  exact group matches  ${entries.reduce((n, e) => n + e.matches.filter((m) => m.resultKind === 'exact').length, 0)}`)
  console.log(`  winner-only matches  ${entries.reduce((n, e) => n + e.matches.filter((m) => m.resultKind === 'winner-only').length, 0)}`)
  console.log(`  undivided sources    ${manifest.undividedSources.length}`)
  for (const u of manifest.undividedSources) {
    console.log(`    ${u.sourceKey}: ${u.groupNames.length} groups, ${u.participants.length} participants → feeds ${u.feedsTemplateKeys.join(', ')}`)
  }
  console.log(`  blocked by shared stage ${entries.filter((e) => e.sharedGroupStageSourceKey).length}`)
  console.log(`  playoff exact placement  ${entries.filter((e) => e.playoff.placement === 'exact').length}`)
  console.log(`  playoff participants only ${entries.filter((e) => e.playoff.placement === 'participants-only').length}`)
  console.log(`  playoff none             ${entries.filter((e) => e.playoff.placement === 'none').length}`)
  console.log(`  playoff participants     ${entries.reduce((n, e) => n + e.playoff.participants.length, 0)}`)
}

main()
