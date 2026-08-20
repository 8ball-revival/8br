/**
 * Applying Auto Add Entrants and Build Playoff Bracket, for real, against a throwaway Season.
 *
 * The companion suite proves the manifest and the refusals. This one proves the WRITES: that the
 * fixture accounts it invents get entered, that rerunning adds only what is new, that no Player,
 * account or alias is ever created, that groups are left alone, and that building a bracket stops
 * dead at PLAYOFF_SETUP without entering a score, naming a champion or touching a rating.
 *
 * Every row it creates is tagged and deleted again, before AND after. No real Season is touched.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-archive-entrants-playoffs-apply.mts
 */
import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { loadManifest } from '../src/lib/archive/manifest.ts'
import {
  previewAutoEntrants, applyAutoEntrants, autoEntrantsAvailability,
} from '../src/lib/archive/auto-entrants.ts'
import {
  previewPlayoffBracket, applyPlayoffBracket, playoffBracketAvailability,
} from '../src/lib/archive/auto-playoffs.ts'
import { isBlocked } from '../src/lib/archive/auto-assign.ts'

assertLocalDatabase('verify-archive-entrants-playoffs-apply')

const TAG = 'zzverify-aap'
const ACTOR = { userId: 0, username: TAG }

/**
 * The template key this run borrowed, and the shell it borrowed it from.
 *
 * `archiveTemplateKey` is unique — one shell per archived Season, which is the right constraint and
 * means a fixture cannot simply claim a key that a real shell already holds. So the fixture borrows
 * one: the key is lifted off a PRISTINE shell (no entrants, no groups, no matches, still in
 * registration), the whole test runs against a Season of its own, and the key goes back in `finally`.
 * The lender is never read or written by the services under test — one nullable field moves and
 * returns.
 */
let borrowedFrom: { seasonId: number; templateKey: string } | null = null

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

async function cleanup() {
  const seasons = await prisma.season.findMany({ where: { slug: { startsWith: TAG } }, select: { id: true } })
  const sids = seasons.map((s) => s.id)
  if (sids.length > 0) {
    await prisma.ratingLedger.deleteMany({ where: { seasonId: { in: sids } } }).catch(() => {})
    await prisma.seasonPlayoffMatch.deleteMany({ where: { seasonId: { in: sids } } }).catch(() => {})
    await prisma.seasonMatch.deleteMany({ where: { seasonId: { in: sids } } }).catch(() => {})
    await prisma.seasonStanding.deleteMany({ where: { seasonId: { in: sids } } }).catch(() => {})
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: { in: sids } } }).catch(() => {})
    await prisma.seasonGroup.deleteMany({ where: { seasonId: { in: sids } } }).catch(() => {})
    await prisma.season.deleteMany({ where: { id: { in: sids } } }).catch(() => {})
  }
  const players = await prisma.player.findMany({
    where: { primaryName: { startsWith: TAG } }, select: { id: true },
  })
  const pids = players.map((p) => p.id)
  if (pids.length > 0) {
    await prisma.playerAlias.deleteMany({ where: { playerId: { in: pids } } }).catch(() => {})
    await prisma.player.deleteMany({ where: { id: { in: pids } } }).catch(() => {})
  }
  await prisma.auditLog.deleteMany({ where: { actorUsername: TAG } }).catch(() => {})

  // Hand the key back. Runs after the fixture Season is gone, so the unique index is free.
  if (borrowedFrom) {
    await prisma.season.update({
      where: { id: borrowedFrom.seasonId },
      data: { archiveTemplateKey: borrowedFrom.templateKey },
    })
  }
}

/** A fixture account. `primaryName` carries the tag so cleanup can always find it. */
async function makePlayer(suffix: string, cueverseId: string, aliases: string[] = []) {
  const p = await prisma.player.create({
    data: {
      primaryName: `${TAG} ${suffix}`,
      cueverseId,
      cueverseIdNormalized: cueverseId.toLowerCase(),
      active: true,
      aliases: { create: aliases.map((alias) => ({ alias, aliasType: 'HANDLE' as const })) },
    },
    select: { id: true },
  })
  return p.id
}

async function main() {
  await cleanup()

  const series = await prisma.competitionSeries.findFirst({ where: { active: true }, select: { id: true } })
  if (!series) { check('a Competition exists to attach a fixture Season to', false); return }

  /*
   * Find a template with EXACT playoff placement — so the bracket half of this suite has real seeds
   * and a real topology to reproduce — whose shell is still completely untouched.
   */
  const candidates = loadManifest().entries.filter(
    (e) => e.playoff.placement === 'exact' && !e.sharedGroupStageSourceKey && e.playoff.participants.length >= 8,
  )
  let entry: (typeof candidates)[number] | null = null
  let lender: number | null = null
  for (const c of candidates) {
    const shell = await prisma.season.findFirst({
      where: {
        archiveTemplateKey: c.templateKey,
        lifecycleState: 'REGISTRATION_OPEN',
        entrants: { none: {} }, groups: { none: {} }, matches: { none: {} },
        playoffMatches: { none: {} }, standings: { none: {} }, ratingLedger: { none: {} },
      },
      select: { id: true },
    })
    if (shell) { entry = c; lender = shell.id; break }
  }
  if (!entry || lender == null) {
    check('a pristine exact-placement shell exists to borrow a template key from', false)
    return
  }
  borrowedFrom = { seasonId: lender, templateKey: entry.templateKey }
  await prisma.season.update({ where: { id: lender }, data: { archiveTemplateKey: null } })
  console.log(`  (borrowing ${entry.templateKey} from the untouched shell #${lender}: ${entry.playoff.participants.length} playoff players, bracket ${entry.playoff.bracketSize})`)

  const lastN = await prisma.season.findFirst({ orderBy: { number: 'desc' }, select: { number: true } })
  const num = (lastN?.number ?? 0) + 1
  const season = await prisma.season.create({
    data: {
      number: num, competitionYear: 2026, competitionSeriesId: series.id,
      slug: `${TAG}-season-${num}`,
      archiveTemplateKey: entry.templateKey,
      lifecycleState: 'REGISTRATION_OPEN',
    },
    select: { id: true },
  })

  // ───────────────────────────────────────────────────────────── the accounts to match
  section('Auto Add Entrants finds accounts the database already has')

  /*
   * The fixture handles are chosen from what the FIRST preview reports as missing.
   *
   * That keeps the assertions deterministic without assuming anything about who happens to exist in
   * this database: a handle nobody matches today will match exactly the account invented for it, and
   * one candidate means one match rather than an ambiguity nobody intended.
   */
  const first = await previewAutoEntrants(season.id)
  if (isBlocked(first)) { check('the fixture Season previews', false, first.reason); return }
  const spare = first.missing.map((m) => m.rawHandle)
  const playoffHandles = new Set(entry.playoff.participants.map((p) => p.rawHandle))
  const missingPlayoff = spare.filter((h) => playoffHandles.has(h))
  if (missingPlayoff.length < 5) {
    check('enough unmatched archived playoff handles to build fixtures from', false, String(missingPlayoff.length))
    return
  }

  const [hId, hAlias, hPunct, hAmbig, hLater] = missingPlayoff
  const punctVariant = hPunct.replace(/[_.-]/g, '') || `${hPunct}x`

  const idPlayer = await makePlayer('exact-id', hId)
  const aliasPlayer = await makePlayer('alias', `${TAG}-alias-id`, [hAlias])
  const punctPlayer = await makePlayer('punct', punctVariant)
  // Two accounts that both collapse to the same handle: an ambiguity, not a coin toss.
  const ambigA = await makePlayer('ambig-a', `${hAmbig.replace(/[_.-]/g, '')}`)
  const ambigB = await makePlayer('ambig-b', `${hAmbig.replace(/[_.-]/g, '')}_`)
  // Somebody who is in the archived field but gets NO account until later in this run.
  void hLater

  const plan = await previewAutoEntrants(season.id)
  if (isBlocked(plan)) { check('the preview runs with fixtures in place', false, plan.reason); return }

  const added = (h: string) => plan.toAdd.find((a) => a.rawHandle === h)
  check('an exact CueVerse ID is matched', added(hId)?.playerId === idPlayer, added(hId)?.reasonLabel)
  check('...and says so', /CueVerse ID matches exactly/i.test(added(hId)?.reasonLabel ?? ''))
  check('an exact alias is matched', added(hAlias)?.playerId === aliasPlayer, added(hAlias)?.reasonLabel)
  check('...and says so', /alias/i.test(added(hAlias)?.reasonLabel ?? ''))
  check('punctuation is safely normalized', added(hPunct)?.playerId === punctPlayer, added(hPunct)?.reasonLabel)

  const amb = plan.ambiguous.find((a) => a.rawHandle === hAmbig)
  check('two candidates becomes an ambiguity', amb != null)
  check('...offering both, choosing neither', amb?.candidates.length === 2)
  check('...and neither is queued to add',
    !plan.toAdd.some((a) => a.playerId === ambigA || a.playerId === ambigB))
  check('a handle with no account stays missing', plan.missing.some((m) => m.rawHandle === hLater))
  check('...listed by its exact archived spelling',
    plan.missing.find((m) => m.rawHandle === hLater)?.rawHandle === hLater)
  check('an ambiguity does not block the confident matches', plan.toAdd.length >= 3, String(plan.toAdd.length))
  check('the whole archived field was searched', plan.sourceParticipants >= entry.playoff.participants.length)

  // ─────────────────────────────────────────────────────────────────────── the write
  section('Applying adds entrants and nothing else')
  const playersBefore = await prisma.player.count()
  const aliasesBefore = await prisma.playerAlias.count()
  const usersBefore = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM payload.users`
  const expected = plan.toAdd.length

  const r1 = await applyAutoEntrants(ACTOR, season.id)
  check('the apply succeeds', r1.ok, r1.error)
  check('it adds exactly what the preview promised', r1.added === expected, `${r1.added} vs ${expected}`)
  check('it reports the ambiguities it skipped', r1.ambiguous === plan.ambiguous.length)
  check('it reports the handles it could not find', r1.missing === plan.missing.length)

  check('no Player was created', await prisma.player.count() === playersBefore)
  check('no alias was created', await prisma.playerAlias.count() === aliasesBefore)
  const usersAfter = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM payload.users`
  check('no account was created', usersAfter[0].n === usersBefore[0].n)

  const entrants1 = await prisma.seasonEntrant.count({ where: { seasonId: season.id } })
  check('the entrants are there', entrants1 === expected, String(entrants1))
  check('the fixture accounts are among them',
    (await prisma.seasonEntrant.count({ where: { seasonId: season.id, playerId: { in: [idPlayer, aliasPlayer, punctPlayer] } } })) === 3)
  check('neither ambiguous account was entered',
    (await prisma.seasonEntrant.count({ where: { seasonId: season.id, playerId: { in: [ambigA, ambigB] } } })) === 0)

  check('no group was created', (await prisma.seasonGroup.count({ where: { seasonId: season.id } })) === 0)
  check('nobody was assigned to a group',
    (await prisma.seasonGroupPlayer.count({ where: { entrant: { seasonId: season.id } } })) === 0)
  check('no match was created', (await prisma.seasonMatch.count({ where: { seasonId: season.id } })) === 0)
  check('the Season stayed in registration',
    (await prisma.season.findUnique({ where: { id: season.id }, select: { lifecycleState: true } }))?.lifecycleState === 'REGISTRATION_OPEN')
  check('the run was audited',
    (await prisma.auditLog.count({ where: { actorUsername: TAG, action: 'season.archive.autoentrants' } })) === 1)

  section('Rerunning adds only what is genuinely new')
  const r2 = await applyAutoEntrants(ACTOR, season.id)
  check('a second run adds nobody', r2.ok && r2.added === 0, String(r2.added))
  check('...and reports them as already entered', r2.alreadyEntered === expected, `${r2.alreadyEntered} vs ${expected}`)
  check('...leaving the entrant list exactly as it was',
    (await prisma.seasonEntrant.count({ where: { seasonId: season.id } })) === entrants1)

  // The owner creates the missing account, then runs it again — the whole point of the report.
  const laterPlayer = await makePlayer('created-later', hLater)
  const r3 = await applyAutoEntrants(ACTOR, season.id)
  check('once the missing account exists, a rerun adds just that one', r3.ok && r3.added === 1, String(r3.added))
  check('...and it is the right person',
    (await prisma.seasonEntrant.count({ where: { seasonId: season.id, playerId: laterPlayer } })) === 1)

  // ────────────────────────────────────────────────────────────────── the bracket
  section('Build Playoff Bracket: the field, the guards, and where the button belongs')

  // Somebody the owner entered who never played in these playoffs. They must be unchecked, not removed.
  const outsider = await makePlayer('outsider', `${TAG}-outsider`)
  await prisma.seasonEntrant.create({
    data: {
      seasonId: season.id, playerId: outsider, username: `${TAG}-outsider`,
      displayName: `${TAG} outsider`, status: 'APPROVED', addedByAdmin: true, playoffIncluded: true,
    },
  })

  check('the bracket button is still hidden during registration',
    (await playoffBracketAvailability(season.id)).show === false)
  check('...and the entrant button is shown', (await autoEntrantsAvailability(season.id)).show === true)

  /*
   * The rest of the archived playoff field gets accounts too.
   *
   * A bracket is sized to the players in it, so the archived slot numbers only line up when everyone
   * who played is here. Reconstructing a Season for real means creating the missing accounts and
   * rerunning Auto Add Entrants — which is exactly what this does, and it doubles as the proof that
   * a rerun keeps adding only what is new.
   */
  /*
   * First, with the field still half-populated: the archived positions must NOT be used.
   *
   * A bracket is sized to the players in it, so a 25-player draw rebuilt from four entrants is four
   * places wide and the archive's "first-round match 10" points at a match that does not exist.
   * The right people are still selected; the seats wait.
   */
  section('An incomplete field selects the right people and refuses to guess their seats')
  await prisma.season.update({ where: { id: season.id }, data: { lifecycleState: 'PLAYOFF_SETUP' } })
  const partial = await previewPlayoffBracket(season.id)
  if (isBlocked(partial)) {
    check('the half-populated Season still previews', false, partial.reason)
  } else {
    check('the source is still recognised as exact', partial.placement === 'exact')
    check('...but its positions cannot be reproduced here', partial.canPlaceExactly === false)
    check('...and it says exactly why',
      partial.unresolved.some((u) => /not entrants here yet/i.test(u)), partial.unresolved.join(' | '))
    check('the archived players with no entrant are named', partial.missing.length > 0, String(partial.missing.length))
    check('...by their exact archived handle', partial.missing.every((m) => playoffHandles.has(m.rawHandle)))
    check('the people who ARE here are still selected', partial.include.length > 0)
  }
  await prisma.season.update({ where: { id: season.id }, data: { lifecycleState: 'REGISTRATION_OPEN' } })

  section('Completing the field lets the archived positions be reproduced')
  // Removing one of the two look-alike accounts settles the ambiguity, exactly as the owner would.
  await prisma.playerAlias.deleteMany({ where: { playerId: ambigB } })
  await prisma.player.delete({ where: { id: ambigB } })

  const stillMissing = (await (async () => {
    const pv = await previewAutoEntrants(season.id)
    return isBlocked(pv) ? [] : pv.missing.map((m) => m.rawHandle)
  })()).filter((h) => playoffHandles.has(h))
  for (const [i, h] of stillMissing.entries()) await makePlayer(`field-${i}`, h)
  const filled = await applyAutoEntrants(ACTOR, season.id)
  const expectedFill = stillMissing.length + 1 // the missing accounts, plus the settled ambiguity
  check('the rest of the archived field is added on a rerun', filled.ok && filled.added === expectedFill,
    `${filled.added} vs ${expectedFill}`)

  /*
   * A group stage, because that is how a Season reaches playoff setup.
   *
   * `generateSeasonBracket` derives its seeding from the standings, so a Season with no group stage
   * has nothing to generate from. Reconstructing an archived Season runs Assign Groups and Fill
   * Group Scores first, which is exactly what these rows stand in for.
   */
  const grp = await prisma.seasonGroup.create({
    data: { seasonId: season.id, code: 'A', ordinal: 0, published: true }, select: { id: true },
  })
  const allEntrants = await prisma.seasonEntrant.findMany({ where: { seasonId: season.id }, select: { id: true, username: true } })
  for (const [i, e] of allEntrants.entries()) {
    await prisma.seasonGroupPlayer.create({ data: { groupId: grp.id, entrantId: e.id, seed: i + 1 } })
    await prisma.seasonStanding.create({
      data: {
        seasonId: season.id, groupId: grp.id, entrantId: e.id, username: e.username, rank: i + 1,
        played: 1, wins: 1, losses: 0, draws: 0, points: 3, gamesWon: 7, gamesLost: 3,
      },
    })
  }

  await prisma.season.update({ where: { id: season.id }, data: { lifecycleState: 'PLAYOFF_SETUP' } })
  check('in playoff setup the bracket button appears', (await playoffBracketAvailability(season.id)).show === true)
  check('...and the entrant button is gone', (await autoEntrantsAvailability(season.id)).show === false)

  const po = await previewPlayoffBracket(season.id)
  if (isBlocked(po)) { check('the bracket previews in playoff setup', false, po.reason); return }
  check('it carries the archive placement through', po.placement === 'exact')
  check('...with the archived bracket size', po.bracketSize === entry.playoff.bracketSize)
  check('the fixture playoff players are selected',
    [hId, hAlias, hPunct, hLater].every((h) => po.include.some((i) => i.rawHandle === h)))
  check('the outsider is unchecked, not deleted',
    po.exclude.some((e) => e.cueverseId === `${TAG}-outsider` || e.displayName === `${TAG} outsider`))
  check('with the whole field present, nobody is missing', po.missing.length === 0, String(po.missing.length))
  check('...so the archived positions can be reproduced', po.canPlaceExactly === true)
  check('every selected player carries their archived seed',
    po.include.every((i) => i.seed != null))
  check('...and their exact first-round slot',
    po.include.every((i) => i.firstRound > 1 || (i.matchNo != null && i.side != null)))
  check('nothing is refused yet', po.refusal === null, po.refusal ?? '')
  check('there is no draft to replace', po.existingDraft === false || po.draftPlacements === 0)

  const applied = await applyPlayoffBracket(ACTOR, season.id)
  check('the bracket applies', applied.ok, applied.error)
  check('it selects the archived field', applied.selected === po.include.length)
  check('it unchecks everyone else', applied.excluded === po.exclude.length)
  const seatable = po.include.filter((i) => i.firstRound === 1 && i.matchNo != null && i.side != null)
  check('everyone the archive gave a seat to was seated', applied.placed === seatable.length, `${applied.placed} vs ${seatable.length}`)
  check('with exact placement, no slot is left unresolved', applied.unresolvedSlots === 0, String(applied.unresolvedSlots))

  // The point of the whole exercise: the seats are the ones the archive recorded.
  const round1 = await prisma.seasonPlayoffMatch.findMany({
    where: { seasonId: season.id, round: 1 },
    select: { slot: true, homeEntrantId: true, awayEntrantId: true, homeUsername: true, awayUsername: true, homeSeed: true, awaySeed: true },
  })
  const bySlot = new Map(round1.map((m) => [m.slot + 1, m]))
  const seatedRight = seatable.filter((i) => {
    const m = bySlot.get(i.matchNo!)
    return m && (i.side === 'a' ? m.homeEntrantId : m.awayEntrantId) === i.entrantId
  })
  check('every seated player is in their exact archived slot', seatedRight.length === seatable.length,
    `${seatedRight.length} of ${seatable.length}`)
  check('...wearing their archived seed', seatable.every((i) => {
    const m = bySlot.get(i.matchNo!)
    return m && (i.side === 'a' ? m.homeSeed : m.awaySeed) === i.seed
  }))
  const archivedByes = seatable.filter((i) => i.bye)
  check('an archived bye reads as a bye, not an empty slot', archivedByes.every((i) => {
    const m = bySlot.get(i.matchNo!)
    return m && (i.side === 'a' ? m.awayUsername : m.homeUsername) === 'Bye'
  }), String(archivedByes.length))

  const includedNow = await prisma.seasonEntrant.count({ where: { seasonId: season.id, playoffIncluded: true } })
  check('the included count matches the plan', includedNow === po.include.length, String(includedNow))
  check('the outsider is now excluded',
    (await prisma.seasonEntrant.findFirst({ where: { seasonId: season.id, playerId: outsider }, select: { playoffIncluded: true } }))?.playoffIncluded === false)
  check('the outsider is still an entrant',
    (await prisma.seasonEntrant.count({ where: { seasonId: season.id, playerId: outsider } })) === 1)
  check('seeds were written from the archive',
    (await prisma.seasonEntrant.count({ where: { seasonId: season.id, playoffSeed: { not: null } } })) === po.include.length)
  check('the bracket is the archived size',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: season.id, round: 1 } })) === (entry.playoff.bracketSize ?? 0) / 2)

  section('And it stops: no score, no champion, no rating, no lifecycle move')
  const after = await prisma.season.findUnique({
    where: { id: season.id },
    select: { lifecycleState: true, championPlayerId: true, championName: true, completedAt: true },
  })
  check('the Season is still in PLAYOFF_SETUP', after?.lifecycleState === 'PLAYOFF_SETUP', after?.lifecycleState)
  check('no champion was named', after?.championPlayerId == null && after?.championName == null)
  check('the Season was not completed', after?.completedAt == null)
  check('no playoff score was entered',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: season.id, OR: [{ homeGames: { not: null } }, { awayGames: { not: null } }, { winnerEntrantId: { not: null } }] } })) === 0)
  check('no playoff match was completed',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: season.id, status: 'COMPLETED' } })) === 0)
  check('no bracket was published',
    (await prisma.seasonPlayoffMatch.count({ where: { seasonId: season.id, published: true } })) === 0)
  check('no rating was written',
    (await prisma.ratingLedger.count({ where: { seasonId: season.id } })) === 0)
  check('the run was audited',
    (await prisma.auditLog.count({ where: { actorUsername: TAG, action: 'season.archive.autoplayoffs' } })) === 1)

  section('A second build will not quietly replace a draft')
  const po2 = await previewPlayoffBracket(season.id)
  if (!isBlocked(po2)) {
    check('the preview now sees a draft', po2.existingDraft && po2.draftPlacements > 0, String(po2.draftPlacements))
  }
  const refused = await applyPlayoffBracket(ACTOR, season.id)
  check('rebuilding without confirmation is refused', refused.ok === false)
  check('...and says why', /confirm replacement/i.test(refused.error ?? ''), refused.error ?? '')
  check('...changing nothing',
    (await prisma.seasonEntrant.count({ where: { seasonId: season.id, playoffIncluded: true } })) === includedNow)

  const confirmed = await applyPlayoffBracket(ACTOR, season.id, { replaceDraft: true })
  check('with confirmation it rebuilds', confirmed.ok, confirmed.error)
  check('...to the same bracket, being the same archive', confirmed.selected === applied.selected && confirmed.placed === applied.placed)
  check('...still in PLAYOFF_SETUP',
    (await prisma.season.findUnique({ where: { id: season.id }, select: { lifecycleState: true } }))?.lifecycleState === 'PLAYOFF_SETUP')

  section('A bracket holding a result is never overwritten')
  const anyMatch = await prisma.seasonPlayoffMatch.findFirst({
    where: { seasonId: season.id, round: 1, homeEntrantId: { not: null }, awayEntrantId: { not: null } },
    select: { id: true, homeEntrantId: true },
  })
  if (anyMatch) {
    await prisma.seasonPlayoffMatch.update({
      where: { id: anyMatch.id },
      data: { homeGames: 7, awayGames: 3, winnerEntrantId: anyMatch.homeEntrantId, status: 'COMPLETED' },
    })
    const withResult = await previewPlayoffBracket(season.id)
    check('the preview refuses once a result exists', !isBlocked(withResult) && withResult.refusal != null,
      isBlocked(withResult) ? withResult.reason : (withResult.refusal ?? 'no refusal'))
    const blockedApply = await applyPlayoffBracket(ACTOR, season.id, { replaceDraft: true })
    check('...and so does the apply', blockedApply.ok === false)
    check('...leaving the played match alone',
      (await prisma.seasonPlayoffMatch.findUnique({ where: { id: anyMatch.id }, select: { homeGames: true } }))?.homeGames === 7)
    await prisma.seasonPlayoffMatch.update({
      where: { id: anyMatch.id },
      data: { homeGames: null, awayGames: null, winnerEntrantId: null, status: 'SCHEDULED' },
    })
  } else {
    check('a round-1 match with two players exists to test the result refusal', false)
  }

  section('Once the playoffs are live, the archive can no longer rearrange them')
  await prisma.season.update({ where: { id: season.id }, data: { lifecycleState: 'PLAYOFFS_LIVE' } })
  const live = await previewPlayoffBracket(season.id)
  check('a live Season is refused', isBlocked(live))
  check('...saying the playoffs already started',
    isBlocked(live) && /already started/i.test(live.reason), isBlocked(live) ? live.reason : '')
  check('...and the button is hidden', (await playoffBracketAvailability(season.id)).show === false)
  const liveApply = await applyPlayoffBracket(ACTOR, season.id, { replaceDraft: true })
  check('...and the apply refuses too', liveApply.ok === false)
  check('adding entrants is refused too', isBlocked(await previewAutoEntrants(season.id)))
  const liveAdd = await applyAutoEntrants(ACTOR, season.id)
  check('...including the apply', liveAdd.ok === false)

  // A Season whose template was cleared mid-flight: the guard, not a crash.
  await prisma.season.update({ where: { id: season.id }, data: { archiveTemplateKey: null, lifecycleState: 'PLAYOFF_SETUP' } })
  check('a Season with no template is refused', isBlocked(await previewPlayoffBracket(season.id)))
  check('...for entrants too', isBlocked(await previewAutoEntrants(season.id)))
}

main()
  .catch((e) => { fail++; console.log('  FAIL threw: ' + (e instanceof Error ? e.message : String(e))) })
  .finally(async () => {
    await cleanup()
    const leftPlayers = await prisma.player.count({ where: { primaryName: { startsWith: TAG } } })
    const leftSeasons = await prisma.season.count({ where: { slug: { startsWith: TAG } } })
    check('every fixture was removed', leftPlayers === 0 && leftSeasons === 0, `${leftPlayers} players, ${leftSeasons} seasons`)
    if (borrowedFrom) {
      const back = await prisma.season.findUnique({
        where: { id: borrowedFrom.seasonId },
        select: { archiveTemplateKey: true, lifecycleState: true, _count: { select: { entrants: true, playoffMatches: true } } },
      })
      check('the borrowed template key went back', back?.archiveTemplateKey === borrowedFrom.templateKey, String(back?.archiveTemplateKey))
      check('...to a shell still untouched',
        back?.lifecycleState === 'REGISTRATION_OPEN' && back?._count.entrants === 0 && back?._count.playoffMatches === 0)
    }
    console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
