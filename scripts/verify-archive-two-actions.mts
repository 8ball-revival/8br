/**
 * Select Playoff Entrants and Apply Archive Placement, as two independent operations.
 *
 * ── What the split is for ────────────────────────────────────────────────────────────────────────
 * These were one button. Choosing the playoff field and reproducing the archived draw are different
 * decisions with different risk: the first is a set of checkboxes and is safe to redo, the second
 * rearranges a bracket somebody may have arranged by hand. Bundled, the safe one could not be done
 * without risking the other.
 *
 * So the thing worth proving is not that each works — it is that each does ONLY its own half.
 * Selection must leave the bracket byte-identical. Placement must be refused until a field exists.
 *
 * ── Everything here is synthetic ─────────────────────────────────────────────────────────────────
 * The Season, its entrants and its archive template are all created by this suite through the
 * injection seam, under a marked template key, and removed at the end. No real Season and no real
 * archive record is read or written — verified explicitly at the end by fingerprinting the archive
 * Seasons before and after.
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import type { TemplateSource } from '../src/lib/archive/auto-playoffs.ts'
import {
  previewPlayoffBracket, applyArchiveSelection, applyArchivePlacement,
} from '../src/lib/archive/auto-playoffs.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'

assertLocalDatabase()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const MARK = 'zz-two-actions'
const YEAR = 2094
const ACTOR = { userId: 2, username: 'two-actions-fixture' }

/*
 * A four-player archived bracket: seeds 1–4, two recorded first-round ties, no byes.
 * Handles are deliberately distinct from any real archive handle.
 */
const HANDLES = ['zzta_alpha', 'zzta_bravo', 'zzta_charlie', 'zzta_delta']

/*
 * A four-player archived bracket, in the shape the engine actually reads.
 *
 * Two recorded first-round ties, no byes, seeds 1–4. The handles are deliberately unlike any real
 * archive handle so a mis-wired matcher cannot accidentally hit a genuine player.
 */
const participant = (
  sourceId: string, rawHandle: string, seed: number, matchNo: number, side: 'a' | 'b',
  bye = false, firstRound = 1,
) => ({ sourceId, rawHandle, normalizedHandle: rawHandle.toLowerCase(), seed, firstRound, bye, matchNo, side })

const templateFor = (key: string): TemplateSource => (asked) => {
  if (asked !== key) return null
  return {
    templateKey: key,
    playoff: {
      placement: 'exact',
      sourceConfidence: 'synthetic',
      format: 'single-elim',
      bracketSize: 4,
      participants: [
        participant('S1', HANDLES[0], 1, 1, 'a'),
        participant('S2', HANDLES[3], 4, 1, 'b'),
        participant('S3', HANDLES[1], 2, 2, 'a'),
        participant('S4', HANDLES[2], 3, 2, 'b'),
      ],
      championSourceId: 'S1',
      runnerUpSourceId: 'S3',
      unresolved: [],
    },
  } as unknown as ReturnType<TemplateSource>
}

const bracketFingerprint = async (seasonId: number) =>
  JSON.stringify(await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId },
    select: { id: true, round: true, slot: true, homeEntrantId: true, awayEntrantId: true, homeUsername: true, awayUsername: true },
    orderBy: [{ round: 'asc' }, { slot: 'asc' }],
  }))

const cleanup = async () => {
  const seasons = await prisma.season.findMany({ where: { competitionYear: YEAR }, select: { id: true } })
  for (const { id } of seasons) {
    await prisma.seasonPlayoffMatch.deleteMany({ where: { seasonId: id } })
    await prisma.seasonMatch.deleteMany({ where: { seasonId: id } })
    await prisma.seasonStanding.deleteMany({ where: { seasonId: id } })
    await prisma.seasonGroupPlayer.deleteMany({ where: { group: { seasonId: id } } })
    await prisma.seasonGroup.deleteMany({ where: { seasonId: id } })
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: id } })
    await prisma.ratingLedger.deleteMany({ where: { seasonId: id } })
    await prisma.season.delete({ where: { id } })
  }
  await prisma.auditLog.deleteMany({ where: { actorUsername: ACTOR.username } })
}

/** A Season sitting in PLAYOFF_SETUP with six entrants, four of whom the archive knows. */
let fixtureNumber = 0
async function makeSeason(key: string) {
  /*
   * Each fixture Season needs its own number.
   *
   * One competition, one year, one number, one division — the duplicate rule is a unique index, and
   * two fixtures sharing a number is a constraint violation rather than a test failure. It threw
   * after the counter had printed, which made 28/28 look like a clean run.
   */
  fixtureNumber++
  const series = await prisma.competitionSeries.findFirst({ select: { id: true }, orderBy: { id: 'asc' } })
  const season = await prisma.season.create({
    data: {
      number: fixtureNumber, competitionYear: YEAR, competitionSeriesId: series!.id,
      slug: `${key}-${Math.trunc(YEAR)}`,
      lifecycleState: 'PLAYOFF_SETUP', archiveTemplateKey: key,
      publiclyVisible: false, countsTowardRankings: false,
    },
    select: { id: true },
  })
  /*
   * A finished group, because the bracket generator seeds from one.
   *
   * `generateSeasonBracket` reads the overall seeding, which is derived from group standings — a
   * Season with entrants but no standings has nobody it can seed and refuses. The group here exists
   * only to give the six entrants a defensible order; the archive is what decides the seats.
   */
  const group = await prisma.seasonGroup.create({
    data: { seasonId: season.id, name: 'A', code: 'A', ordinal: 1 },
    select: { id: true },
  })
  const all = [...HANDLES, 'zzta_echo', 'zzta_foxtrot']
  let rank = 0
  for (const h of all) {
    rank++
    const entrant = await prisma.seasonEntrant.create({
      data: { seasonId: season.id, username: h, displayName: h, cueverseId: h, playoffIncluded: false },
      select: { id: true },
    })
    await prisma.seasonGroupPlayer.create({ data: { groupId: group.id, entrantId: entrant.id } })
    await prisma.seasonStanding.create({
      data: {
        seasonId: season.id, groupId: group.id, entrantId: entrant.id, username: h,
        played: 5, wins: 6 - rank, losses: rank - 1, draws: 0,
        gamesWon: 30 - rank, gamesLost: rank, points: (6 - rank) * 3, rank, qualified: true,
      },
    })
  }
  return season.id
}

try {
  await cleanup()
  const archiveBefore = await prisma.season.count({ where: { archiveTemplateKey: { not: null }, competitionYear: { not: YEAR } } })
  const realSeasonFingerprint = JSON.stringify(await prisma.season.findMany({
    where: { archiveTemplateKey: { not: null }, competitionYear: { not: YEAR } },
    select: { id: true, lifecycleState: true, archiveTemplateKey: true },
    orderBy: { id: 'asc' },
  }))

  const key = `${MARK}-a`
  const seasonId = await makeSeason(key)
  const src = templateFor(key)

  section('The preview resolves by handle, and names what it cannot')
  const plan = await previewPlayoffBracket(seasonId, src)
  if ('blocked' in plan && plan.blocked) {
    check('the synthetic template was read', false, plan.reason)
  } else {
    check('the four archived players resolve', plan.include.length === 4, String(plan.include.length))
    check('...each carrying a CueVerse ID', plan.include.every((i) => !!i.cueverseId))
    check('the two who did not play are marked for unselection', plan.exclude.length === 2, String(plan.exclude.length))
    check('the archived bracket size is read from the source', plan.bracketSize === 4, String(plan.bracketSize))
    check('...and its positions can be reproduced', plan.canPlaceExactly === true)
    check('every archived handle was matched', plan.missing.length === 0, JSON.stringify(plan.missing))
    check('nothing was ambiguous', plan.ambiguous.length === 0)
  }

  section('Selection changes the field, and only the field')
  const bracketBefore = await bracketFingerprint(seasonId)
  const sel = await applyArchiveSelection(ACTOR, seasonId, src)
  check('it applied', sel.ok, sel.error)
  check('...selecting the four archived players', sel.selected === 4, String(sel.selected))
  check('...unselecting the other two', sel.excluded === 2, String(sel.excluded))

  const included = await prisma.seasonEntrant.findMany({ where: { seasonId, playoffIncluded: true }, select: { cueverseId: true } })
  check('the right four are in', included.length === 4 && included.every((e) => HANDLES.includes(e.cueverseId ?? '')),
    JSON.stringify(included.map((e) => e.cueverseId)))

  check('NO bracket was created', (await prisma.seasonPlayoffMatch.count({ where: { seasonId } })) === 0)
  check('...and the bracket is byte-identical to before', (await bracketFingerprint(seasonId)) === bracketBefore)
  const stateAfterSel = await prisma.season.findUniqueOrThrow({ where: { id: seasonId }, select: { lifecycleState: true } })
  check('no lifecycle transition', String(stateAfterSel.lifecycleState) === 'PLAYOFF_SETUP')

  section('Applying selection twice writes nothing the second time')
  const auditsAfterFirst = await prisma.auditLog.count({ where: { entityId: String(seasonId), action: 'season.archive.selection' } })
  const sel2 = await applyArchiveSelection(ACTOR, seasonId, src)
  check('it succeeds', sel2.ok)
  check('...reporting nothing changed', sel2.changed === 0, String(sel2.changed))
  check('...and writes no second audit entry',
    (await prisma.auditLog.count({ where: { entityId: String(seasonId), action: 'season.archive.selection' } })) === auditsAfterFirst)

  section('Placement reproduces the archived draw')
  const place = await applyArchivePlacement(ACTOR, seasonId, {}, src)
  check('it applied', place.ok, place.error)
  check('...seating all four', place.placed === 4, String(place.placed))
  check('...with nothing left unresolved', place.unresolvedSlots === 0, String(place.unresolvedSlots))

  const r1 = await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId, round: 1 }, orderBy: { slot: 'asc' },
    select: { slot: true, homeUsername: true, awayUsername: true },
  })
  check('a four-player bracket was drawn', r1.length === 2, String(r1.length))
  check('match 1 is the archived pairing (1 v 4)', r1[0]?.homeUsername === HANDLES[0] && r1[0]?.awayUsername === HANDLES[3],
    JSON.stringify(r1[0]))
  check('match 2 is the archived pairing (2 v 3)', r1[1]?.homeUsername === HANDLES[1] && r1[1]?.awayUsername === HANDLES[2],
    JSON.stringify(r1[1]))

  section('Placement is idempotent')
  const afterFirstPlacement = await bracketFingerprint(seasonId)
  const place2 = await applyArchivePlacement(ACTOR, seasonId, { replaceDraft: true }, src)
  check('a second application succeeds', place2.ok, place2.error)
  check('...and seats the same people in the same seats',
    JSON.parse(await bracketFingerprint(seasonId)).map((m: { homeUsername: string; awayUsername: string }) => `${m.homeUsername}/${m.awayUsername}`).join('|')
    === JSON.parse(afterFirstPlacement).map((m: { homeUsername: string; awayUsername: string }) => `${m.homeUsername}/${m.awayUsername}`).join('|'))
  const stateAfterPlace = await prisma.season.findUniqueOrThrow({ where: { id: seasonId }, select: { lifecycleState: true } })
  check('no Start Playoffs transition', String(stateAfterPlace.lifecycleState) === 'PLAYOFF_SETUP')

  section('Placement refuses to run before a field is chosen')
  const key2 = `${MARK}-b`
  const fresh = await makeSeason(key2)
  const early = await applyArchivePlacement(ACTOR, fresh, {}, templateFor(key2))
  check('it refuses', early.ok === false)
  check('...saying to select the entrants first', /[Ss]elect the playoff entrants first/.test(early.error ?? ''), early.error)
  check('...and draws no bracket', (await prisma.seasonPlayoffMatch.count({ where: { seasonId: fresh } })) === 0)

  section('An existing hand-arranged draft is not replaced without confirmation')
  await applyArchiveSelection(ACTOR, fresh, templateFor(key2))
  await applyArchivePlacement(ACTOR, fresh, {}, templateFor(key2))
  const guard = await applyArchivePlacement(ACTOR, fresh, {}, templateFor(key2))
  check('a second run without confirmation is refused when the draft holds placements',
    guard.ok === false && /[Cc]onfirm replacement/.test(guard.error ?? ''), guard.error)

  section('A stale preview cannot write')
  await transitionSeasonState(ACTOR, fresh, 'PLAYOFFS_LIVE').catch(() => {})
  const stale = await applyArchiveSelection(ACTOR, fresh, templateFor(key2))
  /*
   * The refusal comes from the preview's own guard rather than the transaction's re-read — the
   * archive tools stop looking at a Season the moment its playoffs are live. Either wording is a
   * correct refusal; what matters is that nothing was written.
   */
  check('selection refuses once the Season has left playoff setup',
    stale.ok === false && /playoff setup|playoffs have already started/i.test(stale.error ?? ''), stale.error)

  section('No real archive record was touched')
  check('the archive Season count is unchanged',
    (await prisma.season.count({ where: { archiveTemplateKey: { not: null }, competitionYear: { not: YEAR } } })) === archiveBefore)
  check('...and every real archive Season is byte-identical',
    JSON.stringify(await prisma.season.findMany({
      where: { archiveTemplateKey: { not: null }, competitionYear: { not: YEAR } },
      select: { id: true, lifecycleState: true, archiveTemplateKey: true },
      orderBy: { id: 'asc' },
    })) === realSeasonFingerprint)
} catch (e) {
  /*
   * A throw is a failed suite, not a short one — the counter only knows about checks that ran,
   * so an exception halfway through would otherwise print a clean-looking RESULT line.
   */
  fail++
  console.log('  FAILED before finishing: ' + (e as Error).message.split('\n')[0])
} finally {
  await cleanup()
  check('no fixture Season remains', (await prisma.season.count({ where: { competitionYear: YEAR } })) === 0)
  check('no fixture entrant remains', (await prisma.seasonEntrant.count({ where: { cueverseId: { startsWith: 'zzta_' } } })) === 0)
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
}

await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
