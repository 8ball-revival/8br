/**
 * Create, once and globally, every Player the archive needs and the database does not have.
 *
 * ── Why this is a separate pass ──────────────────────────────────────────────────────────────────
 * `applyAutoEntrants` matches existing accounts and creates nobody — that is deliberate, because
 * entering a roster should never silently mint accounts. The consequence for a reconstruction is
 * that a Season gets only the entrants who already existed, and the first import run produced
 * Seasons with 17 entrants where the archive records 49.
 *
 * ── Why globally rather than per Season ──────────────────────────────────────────────────────────
 * One historical person appears across many Seasons under one handle. Resolving per Season would
 * create them once per Season — the same person, several accounts, each holding a fragment of their
 * record. So every unfinished Season is asked what it is missing first, the handles are pooled and
 * de-duplicated, and each is resolved exactly once.
 *
 * ── What it will not do ──────────────────────────────────────────────────────────────────────────
 * It never matches on Preferred Name, never chooses between two plausible Players, and never merges.
 * An ambiguous handle gets its own clearly reviewable identity and is reported with its candidates —
 * attaching a historical record to the wrong person is far harder to undo than merging two later.
 *
 * The handle→Player map is written after every creation, so an interrupted run cannot create a
 * second account for a handle it already made.
 *
 * Usage: tsx scripts/archive-create-players.mts [--dry-run|--apply]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { manifestEntry, stripSourceNote } from '../src/lib/archive/manifest.ts'
import { previewAutoEntrants } from '../src/lib/archive/auto-entrants.ts'
import { createMember } from '../src/lib/staff/create-member-service.ts'

assertLocalDatabase()

const APPLY = process.argv.includes('--apply')

/*
 * ── Division scope ───────────────────────────────────────────────────────────────────────────────
 * Division B is benched by owner decision: its playoff source does not survive, so there is nothing
 * this reconstruction can honestly add to it. Benching is not deletion — every shell and every row
 * already imported stays exactly as it is.
 *
 * The scope is an explicit flag rather than a guess from a competition name or an id range, because
 * a run that silently decides for itself which Seasons are in scope is a run nobody can audit.
 * Passing no flag means every division, which is what the reconstruction did before this.
 */
const DIVISION = process.argv.includes('--division')
  ? process.argv[process.argv.indexOf('--division') + 1]
  : null
if (DIVISION && !['A', 'B'].includes(DIVISION)) throw new Error(`--division must be A or B, got ${DIVISION}`)
const ACTOR = { userId: 2, username: 'archive-import' }
const MAP_PATH = 'reports/archive-handle-map.json'

interface MapEntry {
  rawHandle: string
  cueverseId: string
  playerId: string | null
  userId: number | null
  status: 'created' | 'reused' | 'ambiguous' | 'failed'
  seasons: string[]
  candidates: { cueverseId: string | null; displayName: string | null; why: string }[]
  reason: string
  error?: string
}

mkdirSync('reports', { recursive: true })
const map: Record<string, MapEntry> = existsSync(MAP_PATH) ? JSON.parse(readFileSync(MAP_PATH, 'utf8')) : {}
const saveMap = () => writeFileSync(MAP_PATH, JSON.stringify(map, null, 2))

const norm = (h: string) => h.trim().toLowerCase()

const seasons = await prisma.season.findMany({
  where: { archiveTemplateKey: { not: null }, lifecycleState: { not: 'COMPLETED' }, ...(DIVISION ? { division: DIVISION } : {}) },
  select: { id: true, number: true, division: true, competitionYear: true, archiveTemplateKey: true },
  orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }],
})

console.log(`scanning ${seasons.length} unfinished Season(s) for unresolved archive handles…`)

/** handle → the Seasons that need it. Pooled before anything is created. */
const needed = new Map<string, { rawHandle: string; seasons: string[]; candidates: MapEntry['candidates'] }>()
let skipped = 0

/*
 * Resolution is done here, against the manifest, rather than through `previewAutoEntrants`.
 *
 * The preview is an entrant-screen service and is only available while registration is open. An
 * earlier version of this pass called it for every Season, and because all 70 had already advanced
 * to group setup, every preview came back blocked and was quietly skipped — so the pass reported
 * "0 unresolved handles" having examined none of them. Reading the manifest directly means the
 * answer does not depend on what phase a Season happens to be sitting in.
 *
 * The matching rules are the strict ones: exact CueVerse ID, exact alias, or the persisted map.
 * Preferred Name is never used — six Chrises and six Craigs is precisely why.
 */
const resolvedCache = new Map<string, boolean>()
const resolves = async (handle: string): Promise<boolean> => {
  const key = handle.toLowerCase()
  const hit = resolvedCache.get(key)
  if (hit !== undefined) return hit
  const byId = await prisma.player.count({ where: { cueverseIdNormalized: key } })
  const byAlias = byId > 0 ? 0 : await prisma.playerAlias.count({ where: { alias: { equals: handle, mode: 'insensitive' } } })
  const mapped = map[key]?.playerId ? 1 : 0
  const ok = byId + byAlias + mapped > 0
  resolvedCache.set(key, ok)
  return ok
}

for (const s of seasons) {
  const entry = manifestEntry(s.archiveTemplateKey!)
  // The undivided shells are never reconstructed, so their handles are not wanted either.
  if (!entry || entry.sharedGroupStageSourceKey || entry.groupAssignments === 'undivided-source') { skipped++; continue }

  const label = `${s.competitionYear} S${s.number}${s.division ?? ''}`
  /*
   * Both tables. 261 handles across 56 Seasons appear in a playoff bracket but not in that Season's
   * group table, and the entrant service needs every one of them present before a recorded bracket
   * can be seated.
   */
  const recorded = [...entry.participants, ...(entry.playoff?.participants ?? [])]
  for (const participant of recorded) {
    const handle = stripSourceNote(participant.normalizedHandle)
    const key = handle.toLowerCase()
    if (!handle || await resolves(handle)) continue
    const cur = needed.get(key) ?? { rawHandle: stripSourceNote(participant.rawHandle), seasons: [], candidates: [] }
    if (!cur.seasons.includes(label)) cur.seasons.push(label)
    needed.set(key, cur)
  }
}

console.log(`${needed.size} distinct unresolved handle(s) across ${seasons.length - skipped} Season(s)`)
if (!APPLY) {
  const sample = [...needed.entries()].slice(0, 10)
  for (const [k, v] of sample) console.log(`  ${k} — ${v.seasons.length} Season(s), ${v.candidates.length} candidate(s)`)
  console.log('\nDRY RUN — nothing created. Re-run with --apply.')
  await prisma.$disconnect()
  process.exit(0)
}

let created = 0, reused = 0, ambiguous = 0, failed = 0

for (const [key, want] of needed) {
  if (map[key]?.status === 'created' || map[key]?.status === 'reused') {
    // Already resolved by an earlier run; the map is the guard against duplicate accounts.
    map[key].seasons = [...new Set([...map[key].seasons, ...want.seasons])]
    continue
  }

  /*
   * One last resolution attempt against the live database.
   *
   * The pooled list came from previews taken before anything was created, so a handle that a
   * previous iteration of THIS run already created would otherwise be created twice.
   */
  const existing = await prisma.player.findFirst({
    where: { cueverseIdNormalized: key },
    select: { id: true, linkedUserId: true },
  })
  if (existing) {
    map[key] = {
      rawHandle: want.rawHandle, cueverseId: want.rawHandle, playerId: existing.id,
      userId: existing.linkedUserId ? Number(existing.linkedUserId) : null,
      status: 'reused', seasons: want.seasons, candidates: want.candidates,
      reason: 'an existing Player already holds this exact CueVerse ID',
    }
    reused++; saveMap(); continue
  }

  /*
   * Ambiguity is recorded, not resolved.
   *
   * A handle with more than one plausible existing Player still gets its own account: attaching a
   * historical record to the wrong person is much harder to undo than merging two afterwards. The
   * candidates travel with it into the report so the merge can be made deliberately.
   */
  const isAmbiguous = want.candidates.length > 1

  const res = await createMember(ACTOR, { cueverseId: want.rawHandle })
  if (!res.ok || !res.playerId) {
    map[key] = {
      rawHandle: want.rawHandle, cueverseId: want.rawHandle, playerId: null, userId: null,
      status: 'failed', seasons: want.seasons, candidates: want.candidates,
      reason: 'creation refused', error: res.error ?? 'unknown',
    }
    failed++; saveMap(); continue
  }

  map[key] = {
    rawHandle: want.rawHandle,
    cueverseId: want.rawHandle,
    playerId: res.playerId,
    userId: res.userId ?? null,
    status: 'created',
    seasons: want.seasons,
    candidates: want.candidates,
    reason: isAmbiguous
      ? 'more than one existing Player was plausible; a separate identity was created for manual review rather than guessing'
      : 'no existing Player matched this archive handle by CueVerse ID, alias or attached handle',
  }
  created++
  if (isAmbiguous) ambiguous++
  saveMap()
  if (created % 25 === 0) console.log(`  created ${created}…`)
}

saveMap()
console.log(JSON.stringify({ distinctHandles: needed.size, created, reused, ambiguous, failed }, null, 2))

await prisma.$disconnect()
