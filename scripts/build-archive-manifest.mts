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
interface RawSeason {
  key: string; seasonId: string; year: number; period: number
  division: 'A' | 'B' | 'single'; label: string; divisionLabel?: string
  groupStatus?: string; completeness?: string; notes?: string
  gamesPerMatch?: number; entrants?: number
  groups: RawGroup[]
  playoff?: { champion?: { pid: string; handle: string } | null; rounds?: unknown[] } | null
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

function buildParticipants(groups: RawGroup[], players: RawArchive['players']): ManifestParticipant[] {
  const out: ManifestParticipant[] = []
  for (const g of groups) {
    for (const r of g.rows) {
      const p = players[r.pid]
      const rawHandle = p?.handle ?? r.pid
      const rawName = p?.name ?? ''
      out.push({
        sourceId: r.pid,
        rawHandle,
        normalizedHandle: normalizeHandle(rawHandle),
        rawName,
        normalizedName: normalizeHandle(rawName),
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
        aRawHandle: players[m.a]?.handle ?? m.a,
        bRawHandle: players[m.b]?.handle ?? m.b,
        scoreA: exact ? m.sa : null,
        scoreB: exact ? m.sb : null,
        winnerSourceId: m.w ?? null,
        resultKind: exact ? 'exact' : m.w ? 'winner-only' : 'unscored',
      })
    }
  }
  return out
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
}

main()
