/**
 * Groups + Playoffs, driven end to end through the real services.
 *
 * The point of this suite is not that each service works in isolation — most of them predate it —
 * but that the WHOLE path holds together as one Tournament: create, register, group up, play the
 * groups, argue with the qualifiers, seat a bracket, review it, start, play, finish. And that at no
 * point does any of it become a Season.
 *
 * Two Tournaments are built: a singles one and a five-a-side team one. Both are deleted afterwards.
 *
 * Run:  npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-tournament-groups-playoffs.mts
 */
import { readFileSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createTournament } from '../src/lib/competition/tournament-create.ts'
import { transitionTournamentState } from '../src/lib/competition/tournament-lifecycle.ts'
import * as gsetup from '../src/lib/competition/group-setup.ts'
import * as gstage from '../src/lib/competition/group-stage.ts'
import { listQualifiers, setQualifierOverride, recommendedBracketSize } from '../src/lib/competition/qualifiers.ts'
import { recomputeStandings, recordPlayoffForfeit, verifyPlayoffMatch, rebuildManualPlayoff } from '../src/lib/competition/service.ts'
import * as teamSvc from '../src/lib/competition/teams.ts'

assertLocalDatabase('verify-tournament-groups-playoffs')

const TAG = 'zzverify-gp'
const ACTOR = { userId: 0, username: TAG }

let pass = 0, fail = 0
const check = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; console.log('  FAIL ' + n + (d ? ` — ${d}` : '')) }
}
const section = (s: string) => console.log(`\n${s}`)

async function cleanup() {
  const ts = await prisma.tournament.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } })
  const ids = ts.map((t) => t.id)
  if (ids.length) {
    await prisma.ratingLedger.deleteMany({ where: { tournamentId: { in: ids } } }).catch(() => {})
    await prisma.playoffMatch.deleteMany({ where: { tournamentId: { in: ids } } }).catch(() => {})
    await prisma.tournamentMatch.deleteMany({ where: { tournamentId: { in: ids } } }).catch(() => {})
    await prisma.standing.deleteMany({ where: { tournamentId: { in: ids } } }).catch(() => {})
    await prisma.groupPlayer.deleteMany({ where: { group: { tournamentId: { in: ids } } } }).catch(() => {})
    await prisma.tournamentGroup.deleteMany({ where: { tournamentId: { in: ids } } }).catch(() => {})
    await prisma.tournamentTeamMember.deleteMany({ where: { team: { tournamentId: { in: ids } } } }).catch(() => {})
    await prisma.tournamentTeam.deleteMany({ where: { tournamentId: { in: ids } } }).catch(() => {})
    await prisma.registration.deleteMany({ where: { tournamentId: { in: ids } } }).catch(() => {})
    await prisma.tournament.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
  }
  const ps = await prisma.player.findMany({ where: { primaryName: { startsWith: TAG } }, select: { id: true } })
  if (ps.length) {
    await prisma.playerAlias.deleteMany({ where: { playerId: { in: ps.map((p) => p.id) } } }).catch(() => {})
    await prisma.player.deleteMany({ where: { id: { in: ps.map((p) => p.id) } } }).catch(() => {})
  }
  await prisma.auditLog.deleteMany({ where: { actorUsername: TAG } }).catch(() => {})
}

// ────────────────────────────────────────────────────────── the format is offered at creation
section('Groups + Playoffs is offered, and only its own settings appear with it')
{
  const create = readFileSync('src/lib/competition/tournament-create.ts', 'utf8')
  check('the service accepts the format', /SUPPORTED_FORMATS[^\n]*'GROUPS_PLAYOFFS'/.test(create))
  check('...alongside the three that already worked',
    ["'SINGLE_ELIM'", "'DOUBLE_ELIM'", "'SWISS'"].every((f) => new RegExp(`SUPPORTED_FORMATS[^\\n]*${f}`).test(create)))

  const form = readFileSync('src/components/tournaments/create-tournament-form.tsx', 'utf8')
  check('the form offers it as a choice', form.includes("setFormat('GROUPS_PLAYOFFS')"))
  check('...labelled Groups + Playoffs', form.includes("GROUPS_PLAYOFFS: 'Groups + Playoffs'"))
  check('...with a number of groups', form.includes('Number of groups'))
  check('...how many advance', form.includes('Advancing per group'))
  check('...the bracket type', form.includes('Playoff bracket'))
  check('...the seeding rule', form.includes('Playoff seeding'))
  check('...and a recommended bracket size', form.includes('Recommended bracket'))
  check('the group settings are sent ONLY for this format',
    form.includes("...(format === 'GROUPS_PLAYOFFS'"))

  /*
   * The archive tools belong to Seasons.
   *
   * A reconstructed Tournament is typed in by hand; there is no 8BRCAM manifest entry for it and no
   * template to match against. An Auto Assign button here would offer to fill a Tournament from
   * Season archive data, which is a different competition entirely.
   */
  const workspace = readFileSync('src/components/tournaments/tournament-workspace.tsx', 'utf8')
  check('no archive Auto Assign reaches the Tournament workspace',
    !/AutoAssignPanel|autoAssign(Availability|Action)|archiveTemplateKey/.test(workspace))
  const actions = readFileSync('src/lib/competition/tournament-actions.ts', 'utf8')
  check('...nor its actions', !/lib\/archive|autoEntrants|previewGroupAssign/.test(actions))
}

section('The recommended bracket is the next power of two')
{
  check('8 qualifiers → 8', recommendedBracketSize(8) === 8)
  check('5 → 8', recommendedBracketSize(5) === 8)
  check('9 → 16', recommendedBracketSize(9) === 16)
  check('2 → 2', recommendedBracketSize(2) === 2)
  check('1 → 2, because a bracket needs two sides', recommendedBracketSize(1) === 2)
  check('16 → 16', recommendedBracketSize(16) === 16)
}

// ───────────────────────────────────────────────────────────────────── the whole lifecycle
async function main() {
  await cleanup()
  const comp = await prisma.competitionSeries.findFirst({ where: { active: true }, select: { id: true, name: true } })
  if (!comp) { check('a Competition exists', false); return }

  // ── Singles ────────────────────────────────────────────────────────────────────────────────
  section('Singles: create → groups → results → qualifiers → bracket → playoffs → champion')

  const made = await createTournament(ACTOR, {
    name: `${TAG} singles`, competitionSeriesId: comp.id, competitionYear: 2026,
    participantFormat: 'INDIVIDUAL', tournamentFormat: 'GROUPS_PLAYOFFS', raceLength: 7,
    groupCount: 2, qualifiersPerGroup: 2, playoffSeeding: 'standing', playoffDoubleElim: false,
  })
  check('a Groups + Playoffs Tournament is created', made.ok, made.error)
  if (!made.ok || made.id == null) return
  const tid = made.id

  const t0 = await prisma.tournament.findUniqueOrThrow({ where: { id: tid } })
  check('it is a Tournament record', t0.tournamentFormat === 'GROUPS_PLAYOFFS')
  check('...keeping its Competition', t0.competitionSeriesId === comp.id)
  check('...with the group settings stored', t0.groupCount === 2 && t0.qualifiersPerGroup === 2)
  check('...and a public number', t0.number != null)

  // NOTHING may have created a Season.
  const seasonsBefore = await prisma.season.count()
  check('no Season was created', seasonsBefore === SEASON_BASELINE, `${seasonsBefore} vs ${SEASON_BASELINE}`)

  // Four entrants, two groups of two — the smallest shape that still has a real bracket.
  const regs: { id: number; name: string }[] = []
  for (const n of ['ann', 'bob', 'cal', 'dee']) {
    const p = await prisma.player.create({
      data: { primaryName: `${TAG} ${n}`, cueverseId: `${TAG}-${n}`, cueverseIdNormalized: `${TAG}-${n}`, active: true },
      select: { id: true },
    })
    const r = await prisma.registration.create({
      data: { tournamentId: tid, playerId: p.id, username: `${TAG}-${n}`, displayName: `${TAG} ${n}`, status: 'APPROVED' },
      select: { id: true, username: true },
    })
    regs.push({ id: r.id, name: r.username })
  }
  await transitionTournamentState(ACTOR, tid, 'REGISTRATION_OPEN')
  await transitionTournamentState(ACTOR, tid, 'REGISTRATION_CLOSED')

  // ── Group setup: empty groups, then placed by hand ─────────────────────────────────────────
  const setup = await gsetup.enterGroupSetup(ACTOR, tid, 2)
  check('Group Setup creates the draft groups', setup.ok, setup.error)
  const groups = await prisma.tournamentGroup.findMany({ where: { tournamentId: tid }, orderBy: { ordinal: 'asc' } })
  check('...two of them', groups.length === 2, String(groups.length))
  check('...empty, so nobody is placed for you',
    (await prisma.groupPlayer.count({ where: { group: { tournamentId: tid } } })) === 0)
  check('...unpublished, so the draft is private', groups.every((g) => !g.published))
  check('the Tournament has NOT started playing', (await prisma.tournament.findUniqueOrThrow({ where: { id: tid }, select: { lifecycleState: true } })).lifecycleState === 'REGISTRATION_CLOSED')

  for (const [i, r] of regs.entries()) {
    const to = groups[i % 2].id
    const mv = await gsetup.moveEntrantToGroup(ACTOR, tid, r.id, to)
    if (!mv.ok) check(`placing ${r.name}`, false, mv.error)
  }
  check('every entrant is placed by hand',
    (await prisma.groupPlayer.count({ where: { group: { tournamentId: tid } } })) === 4)

  // Moving one and moving it back — assignments are editable before play begins.
  const moved = await gsetup.moveEntrantToGroup(ACTOR, tid, regs[0].id, groups[1].id)
  check('an assignment can be changed while the draft is open', moved.ok, moved.error)
  check('...and it actually moved',
    (await prisma.groupPlayer.findFirstOrThrow({ where: { registrationId: regs[0].id } })).groupId === groups[1].id)
  await gsetup.moveEntrantToGroup(ACTOR, tid, regs[0].id, groups[0].id)

  const published = await gsetup.publishGroupsAndStart(ACTOR, tid)
  check('publishing starts the group stage', published.ok, published.error)
  const afterPublish = await prisma.tournament.findUniqueOrThrow({ where: { id: tid }, select: { lifecycleState: true } })
  check('...moving to GROUPS_IN_PROGRESS', afterPublish.lifecycleState === 'GROUPS_IN_PROGRESS')
  const gMatches = await prisma.tournamentMatch.findMany({ where: { tournamentId: tid } })
  check('...and building the round-robin', gMatches.length === 2, `${gMatches.length} matches`)
  check('the assignments are locked once published',
    !(await gsetup.moveEntrantToGroup(ACTOR, tid, regs[0].id, groups[1].id)).ok)

  // ── Group results ──────────────────────────────────────────────────────────────────────────
  for (const m of gMatches) {
    const r = await gstage.recordGroupResult(ACTOR, m.id, 6, 4)
    if (!r.ok) check('recording a group result', false, r.error)
  }
  await recomputeStandings(tid)
  const standings = await prisma.standing.findMany({ where: { tournamentId: tid }, orderBy: { rank: 'asc' } })
  check('standings exist for everybody', standings.length === 4, String(standings.length))
  check('the winners have a win', standings.filter((s) => s.wins === 1).length === 2)
  check('...the losers a loss', standings.filter((s) => s.losses === 1).length === 2)
  check('the game difference is recorded', standings.some((s) => s.gameDiff === 2))
  check('the calculated qualifiers are marked', standings.filter((s) => s.qualified).length === 4,
    `${standings.filter((s) => s.qualified).length} qualified with top-2 of 2 per group`)

  const complete = await gstage.groupStageComplete(tid)
  check('the group stage reads as complete', complete.complete && complete.remaining === 0)
  check('closing the groups did NOT start the playoffs',
    (await prisma.playoffMatch.count({ where: { tournamentId: tid } })) === 0)
  check('...and did not move the lifecycle on',
    (await prisma.tournament.findUniqueOrThrow({ where: { id: tid }, select: { lifecycleState: true } })).lifecycleState === 'GROUPS_IN_PROGRESS')

  // ── Qualifier review and override ──────────────────────────────────────────────────────────
  section('The calculated qualifiers can be argued with')
  const q0 = await listQualifiers(tid)
  check('every entrant is listed for review', q0.length === 4)
  check('...preselected from the calculation', q0.every((q) => q.calculated === q.effective))
  check('...with nobody overridden yet', q0.every((q) => q.override === null))

  const loser = standings.find((s) => s.losses === 1)!
  const out = await setQualifierOverride(ACTOR, tid, loser.registrationId, false)
  check('an entrant can be forced OUT', out.ok, out.error)
  const q1 = await listQualifiers(tid)
  const row1 = q1.find((q) => q.registrationId === loser.registrationId)!
  check('...the override is recorded', row1.override === false)
  check('...it beats the calculation', row1.effective === false && row1.calculated === true)
  check('...and the standing agrees',
    (await prisma.standing.findFirstOrThrow({ where: { tournamentId: tid, registrationId: loser.registrationId } })).qualified === false)

  /*
   * The override has to survive a recompute — that is the whole reason it lives on the entrant. A
   * later score correction rebuilds every standings row, and an override stored there would go with
   * them.
   */
  await gstage.recordGroupResult(ACTOR, gMatches[0].id, 7, 3)
  await recomputeStandings(tid)
  check('an override survives a later result and recompute',
    (await prisma.standing.findFirstOrThrow({ where: { tournamentId: tid, registrationId: loser.registrationId } })).qualified === false)

  const back = await setQualifierOverride(ACTOR, tid, loser.registrationId, null)
  check('the override can be cleared', back.ok)
  const q2 = await listQualifiers(tid)
  check('...handing the decision back to the calculation',
    q2.find((q) => q.registrationId === loser.registrationId)!.effective === true)
  // Two decisions were taken here: forcing the entrant out, and handing it back. Both are recorded —
  // clearing an override is a decision too, and a log that only kept the first would be misleading.
  check('both override decisions are audited',
    (await prisma.auditLog.count({ where: { actorUsername: TAG, action: 'tournament.qualifier.override' } })) === 2)

  // ── Bracket ────────────────────────────────────────────────────────────────────────────────
  section('The bracket is seated for review, not started')
  const seeded = await gstage.confirmQualifiersAndSeed(ACTOR, tid)
  check('qualifiers seed a bracket', seeded.ok, seeded.error)
  const state1 = await prisma.tournament.findUniqueOrThrow({ where: { id: tid }, select: { lifecycleState: true } })
  check('...landing in BRACKET_GENERATED, a review step', state1.lifecycleState === 'BRACKET_GENERATED')
  const bracket = await prisma.playoffMatch.findMany({ where: { tournamentId: tid }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })
  check('a bracket exists', bracket.length > 0, String(bracket.length))
  check('...unpublished, so the public cannot see it', bracket.every((m) => !m.published))
  check('...with nobody advanced', bracket.every((m) => m.winnerRegistrationId == null))
  check('...and nothing completed', bracket.every((m) => m.status === 'SCHEDULED'))

  /*
   * Manual placement, before play.
   *
   * A Tournament bracket is adjusted by reseating the ordered field rather than by writing one slot
   * at a time — the same call the Bracket tab's seed builder makes. Reversing the order is the
   * bluntest possible proof that the administrator's order, not the group standings, decides.
   */
  const seedOrder = (await prisma.playoffMatch.findMany({
    where: { tournamentId: tid, round: 1 }, orderBy: { slot: 'asc' },
  })).flatMap((m) => [m.homeRegistrationId, m.awayRegistrationId]).filter((x): x is number => x != null)
  const reseated = await rebuildManualPlayoff(ACTOR, tid, [...seedOrder].reverse(), { doubleElim: false })
  check('the bracket can be reseated by hand before play', reseated.ok, reseated.error)
  const afterReseat = await prisma.playoffMatch.findMany({ where: { tournamentId: tid, round: 1 }, orderBy: { slot: 'asc' } })
  check('...and it is still a draft nobody has advanced in',
    afterReseat.every((m) => m.winnerRegistrationId == null && !m.published))
  check('...still in the review step',
    (await prisma.tournament.findUniqueOrThrow({ where: { id: tid }, select: { lifecycleState: true } })).lifecycleState === 'BRACKET_GENERATED')

  section('Playoffs start only when the administrator says so')
  const beforeStart = await prisma.playoffMatch.findMany({ where: { tournamentId: tid, round: 1 } })
  const byes = beforeStart.filter((m) => m.homeRegistrationId != null && m.awayRegistrationId == null)
  check('a bye has NOT advanced anybody yet', byes.every((m) => m.winnerRegistrationId == null),
    `${byes.length} bye(s)`)

  await transitionTournamentState(ACTOR, tid, 'IN_PROGRESS')
  const afterStart = await prisma.tournament.findUniqueOrThrow({ where: { id: tid }, select: { lifecycleState: true } })
  check('starting the playoffs moves the Tournament on', afterStart.lifecycleState === 'IN_PROGRESS')

  // ── FF still works in the playoffs ─────────────────────────────────────────────────────────
  section('FF still works here')
  const live1 = await prisma.playoffMatch.findFirst({
    where: { tournamentId: tid, round: 1, homeRegistrationId: { not: null }, awayRegistrationId: { not: null } },
  })
  if (live1) {
    const ff = await recordPlayoffForfeit(ACTOR, live1.id, 'home')
    check('a forfeit records', ff.ok, ff.error)
    await verifyPlayoffMatch(ACTOR, live1.id)
    const done = await prisma.playoffMatch.findUniqueOrThrow({ where: { id: live1.id } })
    check('...as a forfeit, not a score', done.status === 'FORFEIT' && done.homeGames === null && done.awayGames === null)
    check('...recording who forfeited', done.forfeitRegistrationId === live1.homeRegistrationId)
    check('...and advancing the opponent', done.winnerRegistrationId === live1.awayRegistrationId)
  } else {
    check('a playable round-1 match exists to forfeit', false)
  }

  // ── Separation from Seasons ────────────────────────────────────────────────────────────────
  section('It is a Tournament, all the way down')
  check('no Season was created at any point', (await prisma.season.count()) === SEASON_BASELINE)
  check('every group belongs to the Tournament',
    (await prisma.tournamentGroup.count({ where: { tournamentId: tid } })) === 2)
  check('...and the Season group count never moved',
    (await prisma.seasonGroup.count()) === SEASON_GROUP_BASELINE)
  check('the group matches are Tournament matches',
    (await prisma.tournamentMatch.count({ where: { tournamentId: tid } })) === 2)
  check('...with the Season match count untouched',
    (await prisma.seasonMatch.count()) === SEASON_MATCH_BASELINE)
  check('the standings are Tournament standings',
    (await prisma.standing.count({ where: { tournamentId: tid } })) === 4)
  check('no Season entrant was made',
    (await prisma.seasonEntrant.count({ where: { username: { startsWith: TAG } } })) === 0)
  check('...and the Season entrant count is unchanged',
    (await prisma.seasonEntrant.count()) === SEASON_ENTRANT_BASELINE)

  // ── Teams / 5v5 ────────────────────────────────────────────────────────────────────────────
  section('Teams: five-a-side, with the team as the entrant')
  const teamT = await createTournament(ACTOR, {
    name: `${TAG} teams`, competitionSeriesId: comp.id, competitionYear: 2026,
    participantFormat: 'TEAM', teamSize: 5, teamFormation: 'PICK',
    tournamentFormat: 'GROUPS_PLAYOFFS', raceLength: 7,
    groupCount: 2, qualifiersPerGroup: 1, playoffSeeding: 'standing',
  })
  check('a 5v5 Groups + Playoffs Tournament is created', teamT.ok, teamT.error)
  if (teamT.ok && teamT.id) {
    const tt = await prisma.tournament.findUniqueOrThrow({ where: { id: teamT.id } })
    check('...as a TEAM Tournament', tt.participantFormat === 'TEAM')
    check('...with five to a side', tt.teamSize === 5)
    check('...running groups', tt.tournamentFormat === 'GROUPS_PLAYOFFS')
    check('...and keeping its Competition', tt.competitionSeriesId === comp.id)

    await transitionTournamentState(ACTOR, teamT.id, 'REGISTRATION_OPEN')

    // A five-player roster through the EXISTING team service — not a second team system.
    const roster: { playerId: string; name: string; captain?: boolean }[] = []
    for (let i = 0; i < 6; i++) {
      const p = await prisma.player.create({
        data: {
          primaryName: `${TAG} m${i}`, cueverseId: `${TAG}-m${i}`,
          cueverseIdNormalized: `${TAG}-m${i}`, active: true,
        },
        select: { id: true },
      })
      roster.push({ playerId: p.id, name: `${TAG} m${i}`, captain: i === 0 })
    }

    const team = await teamSvc.createTeam(ACTOR, teamT.id, `${TAG} Five`)
    check('a team is created through the existing team service', team.ok, team.error)
    if (team.ok && team.teamId) {
      const setM = await teamSvc.setTeamMembers(ACTOR, team.teamId, roster.slice(0, 5))
      check('a five-player roster is accepted', setM.ok, setM.error)
      check('...and all five are stored',
        (await prisma.tournamentTeamMember.count({ where: { teamId: team.teamId } })) === 5)

      // The declared team size is a real limit, not decoration.
      const sixth = await teamSvc.setTeamMembers(ACTOR, team.teamId, roster)
      check('a sixth player is refused on a 5v5 roster', sixth.ok === false)
      check('...saying so plainly', /at most 5/.test(sixth.error ?? ''), sixth.error)
      check('...leaving the five in place',
        (await prisma.tournamentTeamMember.count({ where: { teamId: team.teamId } })) === 5)

      /*
       * The TEAM is the entrant.
       *
       * createTeam makes the Registration itself, which is what lets the group stage, the standings
       * and the bracket all work on teams without a second code path: everything downstream deals
       * in registrations and never needs to know whether one is a person or five.
       */
      const teamReg = await prisma.tournamentTeam.findUniqueOrThrow({
        where: { id: team.teamId }, select: { registrationId: true },
      })
      check('the TEAM is the Tournament entrant', teamReg.registrationId != null)
      check('...appearing as one approved registration',
        (await prisma.registration.count({ where: { tournamentId: teamT.id, status: 'APPROVED' } })) === 1)

      // And it groups up exactly like a singles entrant.
      await transitionTournamentState(ACTOR, teamT.id, 'REGISTRATION_CLOSED')
      const tsetup = await gsetup.enterGroupSetup(ACTOR, teamT.id, 2)
      check('a team Tournament enters Group Setup', tsetup.ok, tsetup.error)
      const tg = await prisma.tournamentGroup.findMany({ where: { tournamentId: teamT.id }, orderBy: { ordinal: 'asc' } })
      check('...with its groups', tg.length === 2)
      const placed = await gsetup.moveEntrantToGroup(ACTOR, teamT.id, teamReg.registrationId!, tg[0].id)
      check('...and the team drops into one', placed.ok, placed.error)
      check('...as a group player', (await prisma.groupPlayer.count({ where: { groupId: tg[0].id } })) === 1)
    }
  }
}

/*
 * Recorded before anything is created, so "no Season appeared" is measured against a real number
 * rather than against a filter that could quietly match nothing and pass for the wrong reason.
 */
const SEASON_BASELINE = await prisma.season.count()
const SEASON_GROUP_BASELINE = await prisma.seasonGroup.count()
const SEASON_MATCH_BASELINE = await prisma.seasonMatch.count()
const SEASON_ENTRANT_BASELINE = await prisma.seasonEntrant.count()

main()
  .catch((e) => { fail++; console.log('  FAIL threw: ' + (e instanceof Error ? e.stack ?? e.message : String(e))) })
  .finally(async () => {
    await cleanup()
    await prisma.$executeRawUnsafe(`DELETE FROM payload.users WHERE username LIKE '${TAG}%'`).catch(() => {})

    section('Nothing canonical moved')
    const s = await prisma.season.findUnique({
      where: { id: 3732 },
      select: { championName: true, lifecycleState: true, _count: { select: { entrants: true, matches: true, playoffMatches: true, ratingLedger: true } } },
    })
    check('Season 3732 still has its champion', s?.championName === 'Adnan')
    check('...49 entrants', s?._count.entrants === 49)
    check('...147 matches', s?._count.matches === 147)
    check('...and 31 playoff matches', s?._count.playoffMatches === 31)
    check('the Season count is unchanged', (await prisma.season.count()) === SEASON_BASELINE)
    check('all 88 archive shells are present',
      (await prisma.season.count({ where: { archiveTemplateKey: { not: null } } })) === 88)
    check('every fixture was removed',
      (await prisma.tournament.count({ where: { name: { startsWith: TAG } } })) === 0 &&
      (await prisma.player.count({ where: { primaryName: { startsWith: TAG } } })) === 0)

    console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
    await prisma.$disconnect()
    process.exit(fail === 0 ? 0 : 1)
  })
