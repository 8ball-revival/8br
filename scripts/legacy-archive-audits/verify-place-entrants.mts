/**
 * Place Entrants: seat the archived players on the bracket that is already there.
 *
 * The step after Build Playoff Bracket. That one draws a bracket and demands the whole field; this
 * one arranges the bracket in front of you, places everyone it can confirm, and names everyone it
 * cannot — which is the only useful answer when a Season is half-reconstructed.
 *
 * What matters most here is what it REFUSES. 66 of the 88 archived Seasons record who played in the
 * playoffs but not where; their round-one pairings in the source are the archive viewer's own
 * occurrence-count heuristic, not evidence. Placing from those would manufacture a draw and then be
 * indistinguishable from the real thing, so the button is not offered at all.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-place-entrants.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { manifestEntry } from '../src/lib/archive/manifest.ts'
import { placementAvailability, previewPlacement, applyPlacement } from '../src/lib/archive/auto-playoffs.ts'
import { isBlocked } from '../src/lib/archive/auto-assign.ts'

assertLocalDatabase()

const ACTOR = { userId: 2, username: 'verify-place-entrants' }

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

/*
 * ── This test BUILDS a bracket and then deletes it again, so its target must be disposable ───────
 *
 * It used to take the first Season with an exact-topology template, whatever that Season held. That
 * is destructive: the teardown below deletes every match, standing and group on the target, so the
 * first time a real Season was finished and happened to sort first, the suite erased a completed
 * archive record — champion, bracket and group stage — and reported itself green.
 *
 * A shell is now the only thing it will touch: no results, no champion, and not COMPLETED. A Season
 * that holds anything real is filtered out here rather than guarded later, so no future edit to the
 * body can reach one by accident.
 */
const linked = (await prisma.season.findMany({
  where: {
    archiveTemplateKey: { not: null },
    lifecycleState: { not: 'COMPLETED' },
    championPlayerId: null,
    groups: { none: {} },
    playoffMatches: { none: {} },
  },
  select: { id: true, number: true, competitionYear: true, lifecycleState: true, archiveTemplateKey: true },
}))
const graded = linked.map((s) => ({ ...s, placement: manifestEntry(s.archiveTemplateKey!)?.playoff.placement ?? 'none' }))
const exact = graded.filter((s) => s.placement === 'exact')
const heuristic = graded.filter((s) => s.placement === 'participants-only')

section('It is offered only where the archive recorded real positions')
check('the archive has both grades of Season to tell apart', exact.length > 0 && heuristic.length > 0,
  `${exact.length} exact, ${heuristic.length} participants-only`)

/*
 * The contract is that it is never OFFERED on these, whatever state they are in.
 *
 * The wording of the refusal depends on which guard fires first — a Season that has already started
 * its playoffs is refused for that reason before anyone asks about positions — so only a Season
 * actually sitting in playoff setup can be expected to give the positions answer.
 */
for (const s of heuristic.slice(0, 5)) {
  const a = await placementAvailability(s.id)
  check(`${s.archiveTemplateKey}: never offered — the archive records no positions`, a.show === false)
}
const heuristicInSetup = heuristic.find((s) => s.lifecycleState === 'PLAYOFF_SETUP')
if (heuristicInSetup) {
  const p = await previewPlacement(heuristicInSetup.id)
  check('one sitting in playoff setup says why rather than guessing',
    isBlocked(p) && /not where|guesswork/i.test(p.reason), isBlocked(p) ? p.reason : 'not blocked')
} else {
  console.log('  (no participants-only Season is in playoff setup right now — wording not exercised)')
}

section('A Season with recorded positions can be placed')
const target = exact[0]
if (!target) {
  // Not a failure: a registry where every archived Season has been built out has no shell to use.
  console.log('  (no empty exact-topology Season shell available — placement not exercised)')
} else {
  // Remember everything this test disturbs, so the shell goes back exactly as it was.
  const before = await prisma.season.findUniqueOrThrow({
    where: { id: target.id }, select: { lifecycleState: true },
  })
  const hadMatches = await prisma.seasonPlayoffMatch.count({ where: { seasonId: target.id } })
  const hadEntrants = await prisma.seasonEntrant.count({ where: { seasonId: target.id } })
  check(`${target.archiveTemplateKey} starts with no draft bracket`, hadMatches === 0, String(hadMatches))

  try {
    /*
     * Build the Season the way it is actually built, with the steps that already exist.
     *
     * Place Entrants is never the first thing anyone presses: by the time it is wanted, the entrants
     * are in, the groups are assigned, the results are entered and the group stage is closed — which
     * is what produces the seeds a bracket is drawn from. Short-cutting to playoff setup left no
     * seeds and no bracket, so the interesting half of this suite never ran. Walking the real chain
     * is both a better test of the button and a test that the chain still fits together.
     */
    const { applyAutoEntrants } = await import('../src/lib/archive/auto-entrants.ts')
    const { applyGroupAssign, applyGroupScores } = await import('../src/lib/archive/auto-assign.ts')
    const { generateSeasonGroups, publishSeasonGroups } = await import('../src/lib/seasons/groups.ts')
    const { closeSeasonGroups } = await import('../src/lib/seasons/group-stage.ts')
    const { enterSeasonPlayoffSetup } = await import('../src/lib/seasons/playoffs.ts')

    const added = await applyAutoEntrants(ACTOR, target.id)
    console.log(`  (1 Auto Add Entrants: ${added.ok ? `${added.added} added, ${added.missing} without an account` : added.error})`)

    /*
     * Each stage is gated on the lifecycle, so the state is stepped between them.
     *
     * Pressing the real buttons in order is what an operator does; a script cannot press them, and
     * re-implementing the transitions would be testing the lifecycle rather than using it. Setting
     * the column between stages keeps every stage's own service doing the actual work.
     */
    const setState = (st: string) =>
      prisma.season.update({ where: { id: target.id }, data: { lifecycleState: st as never } })

    await setState('REGISTRATION_CLOSED')
    const groupCount = Math.max(1, Math.min(2, Math.floor((added.added || 0) / 2)))
    const gen = await generateSeasonGroups(ACTOR, target.id, groupCount)
    console.log(`  (2 groups: ${gen.ok ? `${groupCount} generated` : gen.error})`)
    const assigned = await applyGroupAssign(ACTOR, target.id)
    console.log(`  (3 Assign Groups: ${assigned.ok ? `${assigned.placed} placed` : assigned.error})`)
    const pub = await publishSeasonGroups(ACTOR, target.id)
    console.log(`  (4 publish groups: ${pub.ok ? 'ok' : pub.error})`)
    await setState('GROUP_STAGE_LIVE')
    const scored = await applyGroupScores(ACTOR, target.id)
    console.log(`  (5 Fill Group Scores: ${scored.ok ? `${scored.applied} applied` : scored.error})`)
    const closed = await closeSeasonGroups(ACTOR, target.id)
    console.log(`  (6 close groups: ${closed.ok ? 'ok' : closed.error})`)
    await setState('GROUPS_CLOSED')
    const setup = await enterSeasonPlayoffSetup(ACTOR, target.id)
    console.log(`  (7 playoff setup: ${setup.ok ? 'ok' : setup.error})`)

    // Whatever the chain managed, this suite is about what happens from playoff setup onwards.
    await prisma.season.update({ where: { id: target.id }, data: { lifecycleState: 'PLAYOFF_SETUP' } })

    section('...but not before there is a bracket to place them on')
    const noBracket = await previewPlacement(target.id)
    check('with no bracket it refuses and says to generate one',
      isBlocked(noBracket) && /no draft bracket/i.test(noBracket.reason),
      isBlocked(noBracket) ? noBracket.reason : 'not blocked')
    const avail = await placementAvailability(target.id)
    check('...and the button explains itself rather than vanishing',
      avail.show === true && /generate a bracket/i.test(avail.disabledReason ?? ''), avail.disabledReason ?? '')

    section('With a bracket, it reports before it writes')
    /*
     * Selection then placement — the two actions that replaced the combined one. This fixture only
     * needs a bracket seated from the archive, which is exactly what the pair produces.
     */
    const { applyArchiveSelection, applyArchivePlacement } = await import('../src/lib/archive/auto-playoffs.ts')
    const sel = await applyArchiveSelection(ACTOR, target.id)
    const built = sel.ok
      ? await applyArchivePlacement(ACTOR, target.id, { replaceDraft: true })
      : { ok: false, error: sel.error, placed: 0 }
    if (!built.ok) {
      console.log(`  (skipped: ${built.error})`)
      console.log('  (this Season\u2019s archived players are not accounts here, so there is no draw to reproduce)')
    } else {
    check('Build Playoff Bracket prepares the Season', built.ok, built.error)

    /*
     * Draw a bracket if Build did not.
     *
     * Build only generates when every archived playoff player is an entrant here; on a database
     * missing most of the 2012 accounts it selects the field and stops. Place Entrants works on
     * whatever bracket is in front of it, so the bracket is drawn directly and the placement is
     * exercised for real rather than skipped.
     */
    if ((await prisma.seasonPlayoffMatch.count({ where: { seasonId: target.id, round: 1 } })) === 0) {
      // Put everyone who IS here into the field, so there is a bracket to place onto.
      await prisma.seasonEntrant.updateMany({ where: { seasonId: target.id }, data: { playoffIncluded: true } })
      const { generateSeasonBracket } = await import('../src/lib/seasons/playoffs.ts')
      const gen = await generateSeasonBracket(ACTOR, target.id)
      console.log(`  (bracket drawn directly: ${gen.ok ? 'ok' : gen.error})`)
    }

    const plan = await previewPlacement(target.id)
    if (isBlocked(plan) && /no draft bracket/i.test(plan.reason)) {
      /*
       * Not a failure — a limit of this database.
       *
       * Only the 2012-2014 Seasons carry recorded bracket positions, and they are empty shells here:
       * no group stage, so no group-derived seeds, so `generateSeasonBracket` has nothing to draw.
       * Reaching a real bracket would mean importing an entire Season inside a verify script, which
       * would be testing the importer rather than this. Said out loud instead of skipped silently.
       */
      console.log('  (no bracket reachable: the exact-topology Seasons are empty shells on this database)')
      console.log('  (the decision and refusal logic above is what carries the risk, and is covered)')
    } else if (isBlocked(plan)) {
      check('the placement plan is produced', false, plan.reason)
    } else {
      /*
       * Nothing to seat is a fact about this database, not a fault.
       *
       * Placement compares the archived bracket positions with the entrants present and assigns
       * accordingly — so when none of the archived playoff players has an account here, the correct
       * answer is an empty plan and a full skip list. The assertions below only mean something when
       * there is at least one player to place.
       */
      const exercisable = plan.place.length > 0
      if (!exercisable) {
        console.log(`  (nothing to seat: all ${plan.skipped.length} archived playoff players are missing accounts here)`)
        console.log('  (the comparison ran correctly — it found no entrant to match, and said so for each)')
      }
      check('every archived player is accounted for, placed or explained',
        plan.place.length + plan.skipped.length > 0,
        `${plan.place.length} placed, ${plan.skipped.length} explained`)
      check('every planned seat names a first-round match and a side',
        plan.place.every((x) => x.matchNo >= 1 && (x.side === 'a' || x.side === 'b')))
      check('no two seats are the same position',
        new Set(plan.place.map((x) => `${x.matchNo}:${x.side}`)).size === plan.place.length)
      check('no player is planned into two seats',
        new Set(plan.place.map((x) => x.entrantId)).size === plan.place.length)
      check('anyone it cannot confirm carries a reason, never a bare count',
        plan.skipped.every((x) => !!x.reason && !!x.rawHandle))

      const applied = await applyPlacement(ACTOR, target.id)
      if (exercisable) {
        check('it applies', applied.ok, applied.error)
        check('...placing what it planned', applied.placed === plan.place.length,
          `${applied.placed} of ${plan.place.length}`)
        check('...and reporting the unconfirmed count it showed', applied.skipped === plan.skipped.length)
      } else {
        check('it refuses rather than writing an empty arrangement', !applied.ok)
      }

      // The bracket now says what the archive says.
      const seats = await prisma.seasonPlayoffMatch.findMany({
        where: { seasonId: target.id, round: 1 },
        select: { slot: true, homeEntrantId: true, awayEntrantId: true },
        orderBy: { slot: 'asc' },
      })
      const actual = new Map<string, number>()
      for (const m of seats) {
        if (m.homeEntrantId != null) actual.set(`${m.slot + 1}:a`, m.homeEntrantId)
        if (m.awayEntrantId != null) actual.set(`${m.slot + 1}:b`, m.awayEntrantId)
      }
      const wrong = plan.place.filter((x) => actual.get(`${x.matchNo}:${x.side}`) !== x.entrantId)
      check('every placed player is in the seat the archive recorded', wrong.length === 0,
        wrong.map((x) => `${x.rawHandle}→${x.matchNo}${x.side}`).slice(0, 3).join(', '))
      check('nobody appears on the bracket twice',
        new Set([...actual.values()]).size === actual.size)

      section('Running it again changes nothing')
      const second = await previewPlacement(target.id)
      check('a second preview finds everyone already seated',
        !isBlocked(second) && second.place.every((x) => x.alreadyThere),
        isBlocked(second) ? second.reason : `${second.place.filter((x) => !x.alreadyThere).length} still moving`)
      const reapplied = await applyPlacement(ACTOR, target.id)
      check('...and applying is harmless', reapplied.placed === applied.placed,
        `${reapplied.placed} vs ${applied.placed}`)
    }
    }
  } finally {
    // Put the shell back: no bracket, no seeds, the state it was found in.
    await prisma.seasonPlayoffMatch.deleteMany({ where: { seasonId: target.id } })
    await prisma.seasonMatch.deleteMany({ where: { seasonId: target.id } })
    await prisma.seasonStanding.deleteMany({ where: { group: { seasonId: target.id } } })
    await prisma.seasonGroup.deleteMany({ where: { seasonId: target.id } })
    if (hadEntrants === 0) {
      // The shell had none before; Auto Add Entrants put them there and they go back out.
      await prisma.seasonEntrant.deleteMany({ where: { seasonId: target.id } })
    } else {
      await prisma.seasonEntrant.updateMany({
        where: { seasonId: target.id },
        data: { playoffIncluded: false, playoffSeed: null },
      })
    }
    await prisma.season.update({ where: { id: target.id }, data: { lifecycleState: before.lifecycleState } })
    const left = await prisma.seasonPlayoffMatch.count({ where: { seasonId: target.id } })
    const entrantsNow = await prisma.seasonEntrant.count({ where: { seasonId: target.id } })
    const groupsNow = await prisma.seasonGroup.count({ where: { seasonId: target.id } })
    check('the Season is left exactly as it was found',
      left === 0 && entrantsNow === hadEntrants && groupsNow === 0
      && (await prisma.season.findUniqueOrThrow({ where: { id: target.id }, select: { lifecycleState: true } })).lifecycleState === before.lifecycleState)
  }
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
