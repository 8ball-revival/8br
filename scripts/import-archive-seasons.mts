/**
 * Reconstruct every unfinished archive-linked Season from the validated manifest.
 *
 * ── What this does, and deliberately does not ────────────────────────────────────────────────────
 * Entrants, groups, group results, standings, closing the group stage, selecting the recorded
 * playoff field, and — where the archive proves positions — generating the bracket and seating
 * Round 1 including byes.
 *
 * It does NOT invent playoff results. The manifest records who took part, the champion and the
 * runner-up, but no per-match score, so a Season whose playoff results are unknown is left honestly
 * incomplete rather than completed with manufactured numbers.
 *
 * ── Composition, not reimplementation ────────────────────────────────────────────────────────────
 * Every step is an existing canonical service — the same ones the Creator buttons call, with the
 * same guards, audit entries and lifecycle rules. Nothing here writes competition data with raw SQL.
 * That is what makes the result identical to having clicked through it, and what keeps the archive
 * matcher singular.
 *
 * ── Resumability ─────────────────────────────────────────────────────────────────────────────────
 * Every step is idempotent and re-derives its own state, so a rerun is a no-op rather than a second
 * application. Progress is written to a JSON file after each Season, outside canonical data, so an
 * interrupted run continues from where it stopped without repeating finished work.
 *
 * Usage:
 *   tsx scripts/import-archive-seasons.mts --dry-run
 *   tsx scripts/import-archive-seasons.mts --apply [--limit N] [--season ID]
 *   tsx scripts/import-archive-seasons.mts --validate
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { manifestEntry } from '../src/lib/archive/manifest.ts'
import { applyAutoEntrants } from '../src/lib/archive/auto-entrants.ts'
import { applyGroupAssign, applyGroupScores } from '../src/lib/archive/auto-assign.ts'
import { applyArchiveSelection, applyArchivePlacement } from '../src/lib/archive/auto-playoffs.ts'
import { closeRegistration } from '../src/lib/seasons/service.ts'
import { closeSeasonGroups } from '../src/lib/seasons/group-stage.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'

assertLocalDatabase()

const ARGS = process.argv.slice(2)
const has = (f: string) => ARGS.includes(f)
const val = (f: string) => { const i = ARGS.indexOf(f); return i > -1 ? ARGS[i + 1] : null }
const APPLY = has('--apply')
const VALIDATE = has('--validate')
const LIMIT = val('--limit') ? Number(val('--limit')) : Infinity
const ONLY = val('--season') ? Number(val('--season')) : null

const ACTOR = { userId: 2, username: 'archive-import' }
const PROGRESS = 'reports/archive-import-progress.json'

type Stage =
  | 'pending' | 'entrants' | 'groups' | 'results' | 'groups-closed'
  | 'playoff-selected' | 'round1-placed' | 'blocked' | 'partial'

interface SeasonProgress {
  seasonId: number
  label: string
  year: number
  division: string | null
  stage: Stage
  bracketSize: number | null
  entrantsAdded: number
  playersCreated: number
  groupsPlaced: number
  resultsImported: number
  playoffSelected: number
  round1Placed: number
  byes: number
  unresolved: string[]
  notes: string[]
  error?: string
}

const progress: Record<string, SeasonProgress> = existsSync(PROGRESS)
  ? JSON.parse(readFileSync(PROGRESS, 'utf8'))
  : {}

const save = () => {
  mkdirSync('reports', { recursive: true })
  writeFileSync(PROGRESS, JSON.stringify(progress, null, 2))
}

const log = (s: string) => console.log(s)

/** Players that existed before this run, so newly created ones can be named afterwards. */
const playersBefore = new Set((await prisma.player.findMany({ select: { id: true } })).map((p) => p.id))

const seasons = await prisma.season.findMany({
  where: {
    archiveTemplateKey: { not: null },
    lifecycleState: { not: 'COMPLETED' },
    ...(ONLY ? { id: ONLY } : {}),
  },
  select: {
    id: true, number: true, division: true, competitionYear: true,
    archiveTemplateKey: true, lifecycleState: true,
  },
  orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }, { division: 'asc' }],
})

log(`${seasons.length} unfinished archive-linked Season(s)${APPLY ? '' : ' — DRY RUN, nothing will be written'}`)

let processed = 0
for (const s of seasons) {
  if (processed >= LIMIT) break
  const label = `${s.competitionYear} S${s.number}${s.division ?? ''}`
  const key = String(s.id)
  const p: SeasonProgress = progress[key] ?? {
    seasonId: s.id, label, year: s.competitionYear, division: s.division,
    stage: 'pending', bracketSize: null, entrantsAdded: 0, playersCreated: 0,
    groupsPlaced: 0, resultsImported: 0, playoffSelected: 0, round1Placed: 0,
    byes: 0, unresolved: [], notes: [],
  }
  progress[key] = p

  const entry = manifestEntry(s.archiveTemplateKey!)
  if (!entry) {
    p.stage = 'blocked'; p.error = 'no manifest entry'; save(); continue
  }

  /*
   * The 2006 Seasons whose group stage ran undivided are refused outright.
   *
   * Applying the shared groups to each division separately would double-count the same matches in
   * the Rankings. The manifest marks them and the assignment service refuses them; this skips them
   * before doing any work rather than getting a refusal halfway through.
   */
  if (entry.undividedSource) {
    p.stage = 'blocked'
    p.error = 'undivided shared group stage — applying it per division would double-count matches'
    save(); continue
  }
  if (entry.groupAssignments === 'missing' && entry.exactResults === 'missing') {
    p.stage = 'blocked'; p.error = 'the archive records neither group assignments nor results'
    save(); continue
  }

  processed++
  log(`\n[${processed}] ${label} (id ${s.id}) — ${entry.participants.length} participants, groups:${entry.groupAssignments} results:${entry.exactResults} playoff:${entry.playoff?.placement ?? 'none'}`)

  if (!APPLY) {
    p.notes = [`would import ${entry.participants.length} entrants, ${entry.matches.length} group matches`]
    p.bracketSize = entry.playoff?.bracketSize ?? null
    save(); continue
  }

  try {
    // ── 1–2. Entrants (resolves existing Players, creates missing ones canonically) ─────────────
    const before = await prisma.seasonEntrant.count({ where: { seasonId: s.id } })
    if (before === 0) {
      const r = await applyAutoEntrants(ACTOR, s.id)
      if (!r.ok) { p.stage = 'blocked'; p.error = `entrants: ${r.error}`; save(); continue }
      p.entrantsAdded = (r as { added?: number }).added ?? 0
      p.unresolved.push(...((r as { missingHandles?: string[] }).missingHandles ?? []))
    } else {
      p.notes.push(`${before} entrants already present`)
    }
    p.stage = 'entrants'; save()

    // ── Registration has to close before groups exist ───────────────────────────────────────────
    const state = async () => String((await prisma.season.findUniqueOrThrow({ where: { id: s.id }, select: { lifecycleState: true } })).lifecycleState)
    if (await state() === 'REGISTRATION_OPEN') await closeRegistration(ACTOR, s.id)
    if (await state() === 'REGISTRATION_CLOSED') await transitionSeasonState(ACTOR, s.id, 'GROUP_SETUP').catch(() => {})

    // ── 3–4. Groups and the recorded assignment ─────────────────────────────────────────────────
    const g = await applyGroupAssign(ACTOR, s.id)
    p.groupsPlaced = (g as { placed?: number }).placed ?? 0
    if (!g.ok) p.notes.push(`group assign: ${g.error}`)
    p.stage = 'groups'; save()

    // ── 5–6. Exact recorded results, and the standings they produce ─────────────────────────────
    if (entry.exactResults !== 'missing') {
      const r = await applyGroupScores(ACTOR, s.id)
      p.resultsImported = (r as { applied?: number }).applied ?? 0
      if (!r.ok) p.notes.push(`scores: ${r.error}`)
    } else {
      p.notes.push('archive records no exact group results')
    }
    p.stage = 'results'; save()

    // ── 7. Close the group stage through the canonical action ───────────────────────────────────
    if (await state() === 'GROUP_STAGE_LIVE' || await state() === 'GROUP_SETUP') {
      // A draft group board has to be published before it can be closed.
      if (await state() === 'GROUP_SETUP') {
        const { publishSeasonGroups } = await import('../src/lib/seasons/groups.ts')
        await publishSeasonGroups(ACTOR, s.id).catch(() => {})
      }
      const c = await closeSeasonGroups(ACTOR, s.id)
      if (!c.ok) { p.stage = 'partial'; p.error = `close groups: ${c.error}`; save(); continue }
      p.notes.push(`groups closed${c.noContest ? `, ${c.noContest} no-contest` : ''}`)
    }
    p.stage = 'groups-closed'; save()

    // ── 8. The recorded playoff field ───────────────────────────────────────────────────────────
    if (await state() === 'GROUPS_CLOSED') {
      await transitionSeasonState(ACTOR, s.id, 'PLAYOFF_SETUP').catch(() => {})
    }
    const sel = await applyArchiveSelection(ACTOR, s.id)
    if (sel.ok) {
      p.playoffSelected = sel.selected
      p.unresolved.push(...(sel.missing > 0 ? [`${sel.missing} playoff handle(s) unmatched`] : []))
    } else {
      p.notes.push(`selection: ${sel.error}`)
    }
    p.stage = 'playoff-selected'; save()

    // ── 9–10. Bracket and Round 1, only where the archive proves the positions ──────────────────
    if (entry.playoff?.placement === 'exact') {
      const place = await applyArchivePlacement(ACTOR, s.id, { replaceDraft: true })
      if (place.ok) {
        p.round1Placed = place.placed
        p.bracketSize = entry.playoff.bracketSize ?? null
        p.byes = entry.playoff.participants.filter((x) => x.bye).length
        if (place.unresolvedSlots > 0) p.unresolved.push(`${place.unresolvedSlots} Round 1 position(s) unresolved`)
        p.stage = place.unresolvedSlots === 0 ? 'round1-placed' : 'partial'
      } else {
        p.notes.push(`placement: ${place.error}`)
        p.stage = 'partial'
      }
    } else {
      /*
       * Participants-only. The archive names who played but not where they were drawn, and its
       * seeds for these Seasons are its own occurrence-count heuristic rather than a recorded order.
       * Generating a bracket from current group standings would be inventing a draw, so the field is
       * selected and the bracket is left for manual arrangement.
       */
      p.notes.push('playoff positions not recorded — selection only, bracket left unarranged')
      p.stage = 'playoff-selected'
    }
    save()
    log(`   entrants=${p.entrantsAdded} groups=${p.groupsPlaced} results=${p.resultsImported} selected=${p.playoffSelected} round1=${p.round1Placed} stage=${p.stage}`)
  } catch (e) {
    p.stage = 'blocked'
    p.error = (e as Error).message.split('\n')[0]
    save()
    log(`   BLOCKED: ${p.error}`)
  }
}

// ── Newly created Players, captured by difference ─────────────────────────────────────────────
const after = await prisma.player.findMany({
  select: { id: true, cueverseId: true, primaryName: true, linkedUserId: true, createdAt: true },
})
const created = after.filter((p) => !playersBefore.has(p.id))

const summary = {
  seasonsSeen: seasons.length,
  processed,
  byStage: Object.values(progress).reduce<Record<string, number>>((a, p) => {
    a[p.stage] = (a[p.stage] ?? 0) + 1; return a
  }, {}),
  playersCreated: created.length,
  entrantsAdded: Object.values(progress).reduce((n, p) => n + p.entrantsAdded, 0),
  resultsImported: Object.values(progress).reduce((n, p) => n + p.resultsImported, 0),
  playoffSelected: Object.values(progress).reduce((n, p) => n + p.playoffSelected, 0),
  round1Placed: Object.values(progress).reduce((n, p) => n + p.round1Placed, 0),
}
log('\n' + JSON.stringify(summary, null, 2))
save()

if (VALIDATE || APPLY) {
  writeFileSync('reports/archive-import-created-players.json', JSON.stringify(created, null, 2))
  log(`\ncreated players recorded: ${created.length} → reports/archive-import-created-players.json`)
}

await prisma.$disconnect()
