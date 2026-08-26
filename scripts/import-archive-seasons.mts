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
import { manifestEntry, stripSourceNote } from '../src/lib/archive/manifest.ts'
import { parseWayback } from '../src/lib/archive/wayback.ts'
import { applyAutoEntrants, previewAutoEntrants } from '../src/lib/archive/auto-entrants.ts'
import { applyGroupAssign, applyGroupScores, isBlocked } from '../src/lib/archive/auto-assign.ts'
import { applyArchiveSelection, applyArchivePlacement } from '../src/lib/archive/auto-playoffs.ts'
import { closeRegistration } from '../src/lib/seasons/service.ts'
import { closeSeasonGroups } from '../src/lib/seasons/group-stage.ts'
import { publishSeasonGroups } from '../src/lib/seasons/groups.ts'
import { generateSeasonBracket } from '../src/lib/seasons/playoffs.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'

assertLocalDatabase()

const ARGS = process.argv.slice(2)
const has = (f: string) => ARGS.includes(f)
const val = (f: string) => { const i = ARGS.indexOf(f); return i > -1 ? ARGS[i + 1] : null }
const APPLY = has('--apply')
const VALIDATE = has('--validate')
const LIMIT = val('--limit') ? Number(val('--limit')) : Infinity
const ONLY = val('--season') ? Number(val('--season')) : null

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
const DIVISION = val('--division')
if (DIVISION && !['A', 'B'].includes(DIVISION)) throw new Error(`--division must be A or B, got ${DIVISION}`)

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
      ...(DIVISION ? { division: DIVISION } : {}),
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
  if (entry.undividedSource || entry.groupAssignments === 'undivided-source') {
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
    /*
     * ── 1-2. Entrants: complete the field, rather than skip a Season that has some ──────────────
     *
     * The first run tested `before === 0` and left anything non-empty alone. Because entrants were
     * added before every archive handle had a Player, 65 Seasons ended up holding only the fraction
     * that happened to resolve — 17 of 49, 12 of 42 — and the skip meant no later run would ever
     * finish them. Completeness is measured against the manifest, not against zero.
     *
     * Entrant entry is only open during registration, so a Season already advanced to group setup
     * is walked BACK through the lifecycle's own legal transition rather than having rows inserted
     * behind the service's back. It is returned to where it was before the step either way.
     */
    /*
     * Who the archive records as having played in this Season — both tables, not just the first.
     *
     * 261 handles across 56 Seasons appear in a playoff bracket without appearing in that Season's
     * group table, because the archived group page is truncated or they came through as a wildcard.
     * Taking only the group list left them out of the field, which then made the playoff bracket
     * unplaceable: it needs every recorded playoff player present before it will seat anyone.
     *
     * They are entrants with no recorded group. That is what the source says, and leaving them
     * ungrouped is more faithful than inventing a group for them.
     */
    /*
     * The archived bracket page counts as a record of who played, alongside the manifest.
     *
     * Three people hold an entry position on a validated bracket and are absent from their Season's
     * participant table. Treating only the manifest as evidence made the stray sweep delete them
     * moments after they were deliberately entered — the importer undoing an owner's decision on the
     * strength of a table that was already known to be incomplete.
     */
    const bracketHandles = (() => {
      const file = `archive/wayback-seasons/${s.competitionYear}/${s.competitionYear} s${s.number}.txt`
      if ((s.division ?? 'A') !== 'A' || !existsSync(file)) return [] as string[]
      const b = parseWayback(readFileSync(file, 'utf8'), file)
      return b.matches
        .filter((m) => m.round === 1)
        .flatMap((m) => [m.home, m.away])
        .filter((x): x is NonNullable<typeof x> => Boolean(x) && !x!.bye)
        .map((x) => stripSourceNote(x.normalizedHandle).toLowerCase())
    })()

    const manifestHandles = new Set([
      ...entry.participants.map((x) => stripSourceNote(x.normalizedHandle).toLowerCase()),
      ...(entry.playoff?.participants ?? []).map((x) => stripSourceNote(x.normalizedHandle).toLowerCase()),
    ])
    const wanted = manifestHandles.size

    /*
     * The bracket protects people from the stray sweep; it does not raise the target.
     *
     * Folding bracket handles into the expected count made every Season with a bracket-only player
     * look permanently short, so each run rewound the group stage chasing somebody applyAutoEntrants
     * cannot add — it only enters manifest participants. The two ideas are separate: what the field
     * should contain comes from the manifest, and who may not be swept away is anyone either source
     * records.
     */
    const recordedAnywhere = new Set([...manifestHandles, ...bracketHandles])

    /*
     * Entrants the archive does not record are removed before the field is completed.
     *
     * The first import seated whoever happened to resolve, by a looser rule than the manifest, and
     * left people on Seasons they never entered. An entrant is kept only if this Season's own
     * participant list names them — by CueVerse ID, or by an alias, which is how a merged handle
     * still counts as the person the archive printed.
     *
     * Removed outright rather than withdrawn: WITHDRAWN would assert they entered and pulled out.
     */
    const existing = await prisma.seasonEntrant.findMany({
      where: { seasonId: s.id },
      select: { id: true, playerId: true, cueverseId: true, username: true },
    })
    /*
     * The alias test asks the same question the direct test does, of the same set.
     *
     * It used to ask only the manifest, which quietly undid the exemption above: somebody entered
     * because the bracket seats them, whose account holds a different CueVerse ID from the one the
     * bracket prints, matched neither by handle nor by alias and was swept away on the next run.
     * That is most of them — the reason a bracket names people the group table does not is that
     * they had changed their ID.
     *
     * Aliases are stored with separators removed, so the recorded set is compared in both forms.
     */
    const strippedAnywhere = new Set([...recordedAnywhere].map((h) => h.replace(/[^a-z0-9]/g, '')))
    const strays: number[] = []
    for (const e of existing) {
      const handle = String(e.cueverseId ?? e.username).toLowerCase()
      let recorded = recordedAnywhere.has(handle) || strippedAnywhere.has(handle.replace(/[^a-z0-9]/g, ''))
      if (!recorded && e.playerId) {
        const aliases = await prisma.playerAlias.findMany({ where: { playerId: e.playerId }, select: { alias: true } })
        recorded = aliases.some((a) => recordedAnywhere.has(a.alias.toLowerCase()) || strippedAnywhere.has(a.alias.toLowerCase().replace(/[^a-z0-9]/g, '')))
      }
      if (!recorded) strays.push(e.id)
    }
    if (strays.length > 0) {
      await prisma.seasonEntrant.deleteMany({ where: { id: { in: strays } } })
      p.notes.push(`removed ${strays.length} entrant(s) the archive does not record for this Season`)
    }

    const before = await prisma.seasonEntrant.count({ where: { seasonId: s.id, status: 'APPROVED' } })

    if (before < wanted) {
      const stateNow = String((await prisma.season.findUniqueOrThrow({
        where: { id: s.id }, select: { lifecycleState: true },
      })).lifecycleState)

      /*
       * A Season that has already advanced is rewound before its field is completed.
       *
       * Entrant entry closes at registration, and the lifecycle deliberately offers no way back to
       * it from a live group stage — the groups and their schedule are derived from the field, so
       * changing the field afterwards would leave them describing a competition that no longer
       * matches. That guard is right, and the answer is to undo the derived work rather than to
       * force an entrant in behind it.
       *
       * Only ever for a reconstruction that has contributed nothing: no ledger row, no champion,
       * not completed. Everything deleted here is rebuilt from the manifest moments later, and the
       * rollback itself goes through the lifecycle's own recovery path so it is audited as what it
       * is rather than done behind the service's back.
       */
      if (stateNow !== 'REGISTRATION_OPEN' && stateNow !== 'REGISTRATION_CLOSED') {
        const guard = {
          ledger: await prisma.ratingLedger.count({ where: { seasonId: s.id } }),
          champion: (await prisma.season.findUniqueOrThrow({ where: { id: s.id }, select: { championName: true } })).championName,
        }
        if (stateNow === 'COMPLETED' || guard.ledger > 0 || guard.champion) {
          p.stage = 'partial'
          p.error = `entrants: ${before} of ${wanted}, and this Season has already contributed results — not rewound`
          save(); continue
        }
        await prisma.$transaction(async (tx) => {
          await tx.seasonPlayoffMatch.deleteMany({ where: { seasonId: s.id } })
          await tx.seasonStanding.deleteMany({ where: { seasonId: s.id } })
          await tx.seasonMatch.deleteMany({ where: { seasonId: s.id } })
          await tx.seasonGroupPlayer.deleteMany({ where: { group: { seasonId: s.id } } })
          await tx.seasonGroup.deleteMany({ where: { seasonId: s.id } })
        }, { timeout: 120_000 })
        const back = await transitionSeasonState(ACTOR, s.id, 'REGISTRATION_OPEN', {
          recovery: true,
          reason: 'archive reconstruction: the recorded entrant field was incomplete, so the derived group stage was rebuilt from it',
        })
        if (!back.ok) { p.stage = 'partial'; p.error = `rewind: ${back.error}`; save(); continue }
        p.notes.push(`rewound from ${stateNow} to complete the entrant field`)
      } else if (stateNow === 'REGISTRATION_CLOSED') {
        const back = await transitionSeasonState(ACTOR, s.id, 'REGISTRATION_OPEN',
          { reason: 'archive reconstruction: completing the recorded entrant field' })
        if (!back.ok) { p.stage = 'partial'; p.error = `reopen registration: ${back.error}`; save(); continue }
      }
      const r = await applyAutoEntrants(ACTOR, s.id)
      if (!r.ok) { p.stage = 'blocked'; p.error = `entrants: ${r.error}`; save(); continue }
      p.entrantsAdded = (r as { added?: number }).added ?? 0
      p.unresolved.push(...((r as { missingHandles?: string[] }).missingHandles ?? []))
    }

    // The field must now match the archive exactly, or this Season goes no further.
    const nowEntrants = await prisma.seasonEntrant.findMany({
      where: { seasonId: s.id, status: 'APPROVED' },
      select: { playerId: true, cueverseId: true, username: true },
    })
    const players = nowEntrants.map((e) => e.playerId).filter(Boolean)
    if (new Set(players).size !== players.length) {
      p.stage = 'partial'; p.error = 'entrants: the same Player is entered twice'; save(); continue
    }
    /*
     * Completeness is judged by what the entrant service still cannot place, not by a head count.
     *
     * Two archive handles can be one person — a handle and the handle it was merged into can both
     * appear in the same Season's tables — and one person is one entrant. Comparing against the
     * number of distinct SPELLINGS therefore declared seven Seasons short by exactly one when
     * nothing was actually missing.
     */
    const after = await previewAutoEntrants(s.id)
    const reportedMissing = isBlocked(after) ? [] : after.missing.map((m) => m.rawHandle)

    /*
     * A handle that survives as somebody's alias is not missing — that person is already entered.
     *
     * The archive spells one player two ways across a Season's tables, and after a merge the older
     * spelling lives on as an alias of the account that absorbed it. The entrant preview matches on
     * CueVerse ID, so it calls the alias an account that does not exist; adding it would be a second
     * entrant row for one person, which the unique key on (Season, Player) rightly refuses.
     */
    const stillMissing: string[] = []
    for (const handle of reportedMissing) {
      const alias = await prisma.playerAlias.findFirst({
        where: { alias: { equals: stripSourceNote(handle), mode: 'insensitive' } },
        select: { playerId: true },
      })
      const entered = alias
        ? await prisma.seasonEntrant.count({ where: { seasonId: s.id, playerId: alias.playerId } })
        : 0
      if (entered > 0) p.notes.push(`${handle} is entered as an alias of an existing entrant`)
      else stillMissing.push(handle)
    }

    if (stillMissing.length > 0) {
      p.stage = 'partial'
      p.error = `entrants: ${stillMissing.length} recorded handle(s) have no account`
      p.unresolved.push(...stillMissing.slice(0, 10))
      save(); continue
    }
    if (nowEntrants.length !== wanted) {
      p.notes.push(`${wanted} recorded handles resolve to ${nowEntrants.length} distinct people`)
    }
    p.error = null
    p.notes = p.notes.filter((n) => n.startsWith('removed '))
    p.unresolved = []
    p.stage = 'entrants'; save()

    /*
     * The canonical order, which the first run got wrong.
     *
     * `publishSeasonGroups` is the single action behind Creator's "Group Stage Live" button, and it
     * owns three things at once: the round-robin schedule, the standings rows, and the transition to
     * GROUP_STAGE_LIVE. The first run imported scores before publishing, so the standings already
     * existed and publish died on a unique constraint — which a `` then turned into a
     * silent skip and a misleading "group stage is not live" across all 70 Seasons.
     *
     * Nothing here suppresses a failure. A refusal records the stage and the original message, marks
     * this Season partial, and lets every other Season carry on.
     */
    const state = async () => String((await prisma.season.findUniqueOrThrow({
      where: { id: s.id }, select: { lifecycleState: true },
    })).lifecycleState)

    const stop = (stage: string, err: string | undefined) => {
      p.stage = 'partial'
      p.error = `${stage}: ${err ?? 'no reason given'}`
      p.notes.push(`stopped at ${stage}; template=${s.archiveTemplateKey}; entrants=${p.entrantsAdded} groups=${p.groupsPlaced} results=${p.resultsImported}`)
      save()
      log(`   PARTIAL at ${stage}: ${err}`)
    }

    if (await state() === 'REGISTRATION_OPEN') {
      const r = await closeRegistration(ACTOR, s.id)
      if (!r.ok) { stop('close registration', r.error); continue }
    }
    if (await state() === 'REGISTRATION_CLOSED') {
      await transitionSeasonState(ACTOR, s.id, 'GROUP_SETUP')
    }

    // ── 3-4. Groups and the recorded assignment ─────────────────────────────────────────────────
    if (await state() === 'GROUP_SETUP') {
      const g = await applyGroupAssign(ACTOR, s.id)
      p.groupsPlaced = (g as { placed?: number }).placed ?? 0
      if (!g.ok) { stop('group assign', g.error); continue }
    }
    p.stage = 'groups'; save()

    // ── 5. Publish: schedule, standings and the live stage, in one canonical action ─────────────
    if (await state() === 'GROUP_SETUP') {
      const pub = await publishSeasonGroups(ACTOR, s.id)
      if (!pub.ok) { stop('publish groups', pub.error); continue }
    }
    /*
     * Resumption, not just first-run correctness.
     *
     * A Season that already reached playoff setup on an earlier run has passed this point; demanding
     * exactly GROUP_STAGE_LIVE made every rerun of a finished group stage report a failure. What
     * matters is that the stage is at or beyond live, never that it stopped there.
     */
    const ORDER = ['REGISTRATION_SCHEDULED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'GROUP_SETUP',
      'GROUP_STAGE_LIVE', 'GROUPS_CLOSED', 'PLAYOFF_SETUP', 'PLAYOFFS_LIVE', 'COMPLETED']
    const atLeast = (a: string, b: string) => ORDER.indexOf(a) >= ORDER.indexOf(b)
    const afterPublish = await state()
    if (!atLeast(afterPublish, 'GROUP_STAGE_LIVE')) {
      stop('publish groups', `expected the group stage to be live, found ${afterPublish}`)
      continue
    }

    // ── 6. The recorded results, onto the schedule publication just created ─────────────────────
    if (entry.exactResults === 'missing') {
      p.notes.push('archive records no exact group results')
    } else if (await state() === 'GROUP_STAGE_LIVE') {
      const r = await applyGroupScores(ACTOR, s.id)
      p.resultsImported = (r as { applied?: number }).applied ?? 0
      if (!r.ok) { stop('group scores', r.error); continue }
    }
    p.stage = 'results'; save()

    // ── 7. Close the group stage ────────────────────────────────────────────────────────────────
    if (await state() === 'GROUP_STAGE_LIVE') {
      const c = await closeSeasonGroups(ACTOR, s.id)
      if (!c.ok) { stop('close groups', c.error); continue }
      p.notes.push(`groups closed${c.noContest ? `, ${c.noContest} no-contest` : ''}`)
    }
    p.stage = 'groups-closed'; save()

    // ── 8. The recorded playoff field ───────────────────────────────────────────────────────────
    if (await state() === 'GROUPS_CLOSED') {
      await transitionSeasonState(ACTOR, s.id, 'PLAYOFF_SETUP')
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
      /*
       * The bracket has to exist before anyone can be seated on it.
       *
       * Its SIZE comes from the archive, not from the size of the field: a 26-player playoff was
       * played as a bracket of 32 with six byes, and rebuilding it as a bracket of 32 is what
       * happened rather than a preference. Placement then fills the recorded positions.
       */
      const size = entry.playoff.bracketSize ?? undefined
      const drafted = await prisma.seasonPlayoffMatch.count({ where: { seasonId: s.id } })
      if (drafted === 0) {
        const gen = await generateSeasonBracket(ACTOR, s.id, size ? { size } : {})
        if (!gen.ok) { p.notes.push(`bracket: ${gen.error}`); p.stage = 'partial'; save(); continue }
        p.bracketSize = gen.size ?? size ?? null
      }
      /*
       * Placement is skipped once the recorded positions are already on the board.
       *
       * Re-placing produced an identical bracket but wrote a fresh audit entry for every slot it
       * touched — 28 rows per rerun that record no change. Replacing the draft is also the one
       * step here that would discard a position somebody had since set by hand.
       */
      const expected = entry.playoff.participants.length
      const seated = await prisma.seasonPlayoffMatch.count({
        where: { seasonId: s.id, round: 1, OR: [{ homeEntrantId: { not: null } }, { awayEntrantId: { not: null } }] },
      })
      const alreadyPlaced = await prisma.seasonPlayoffMatch.findMany({
        where: { seasonId: s.id, round: 1 },
        select: { homeEntrantId: true, awayEntrantId: true },
      })
      const seatedPlayers = alreadyPlaced.flatMap((m) => [m.homeEntrantId, m.awayEntrantId]).filter(Boolean).length
      if (seatedPlayers >= expected) {
        p.round1Placed = seatedPlayers
        p.byes = entry.playoff.participants.filter((x) => x.bye).length
        p.stage = 'round1-placed'
        save()
        log(`   entrants=${p.entrantsAdded} groups=${p.groupsPlaced} results=${p.resultsImported} selected=${p.playoffSelected} round1=${p.round1Placed} stage=${p.stage}`)
        continue
      }
      void seated
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
