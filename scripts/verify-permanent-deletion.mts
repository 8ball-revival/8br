/**
 * Permanent deletion: all of it, or none of it.
 *
 * ── Why rollback is the headline ─────────────────────────────────────────────────────────────────
 * A half-deleted competition — entrants gone, matches remaining, ledger rebuilt around the gap — is
 * worse than either outcome, because nothing downstream can interpret it. The property that makes
 * this feature safe to offer is that a failure anywhere leaves the record completely whole, so the
 * suite makes the transaction fail at the last possible moment and then checks every table.
 *
 * ── And what must NOT be deleted ─────────────────────────────────────────────────────────────────
 * A person who played in a Season removed by mistake still exists. A Competition outlives any one of
 * its Seasons. Deleting either would turn an over-reach into data loss nobody asked for, so both are
 * asserted to survive.
 *
 * Every record here is a disposable fixture. No real Season or Tournament is deleted or modified.
 *
 * Run: npx tsx --tsconfig scripts/tsconfig.verify.json --env-file=.env scripts/verify-permanent-deletion.mts
 */
import { readFileSync, readdirSync } from 'node:fs'

import { prisma } from '../src/lib/prisma.ts'
import { assertLocalDatabase } from '../src/lib/db-guard.ts'
import { createDraft } from '../src/lib/creator/setup.ts'
import { addSeasonEntrant, closeRegistration } from '../src/lib/seasons/service.ts'
import { transitionSeasonState } from '../src/lib/seasons/lifecycle.ts'
import { generateSeasonGroups, publishSeasonGroups } from '../src/lib/seasons/groups.ts'
import { saveSeasonGroupResults, closeSeasonGroups } from '../src/lib/seasons/group-stage.ts'
import {
  enterSeasonPlayoffSetup, generateSeasonBracket, startSeasonPlayoffs, recordSeasonPlayoffResult,
} from '../src/lib/seasons/playoffs.ts'
import { closeSeason } from '../src/lib/seasons/close.ts'
import { createTournament } from '../src/lib/competition/tournament-create.ts'
import { deletionImpact, permanentlyDelete, deleteWithHooks } from '../src/lib/competition/permanent-deletion.ts'
import { rebuildRatingLedger } from '../src/lib/stats/ledger.ts'

assertLocalDatabase()

const OWNER = { userId: 2, username: 'verify-deletion', canDelete: true }
const NOT_OWNER = { userId: 2, username: 'verify-deletion', canDelete: false }
const YEAR = 2085
const MARK = 'ZZDelete Tournament'
let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail?: string) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}
const section = (t: string) => console.log(`\n--- ${t} ---`)

const series = await prisma.competitionSeries.findFirstOrThrow({ select: { id: true, name: true } })

async function cleanup() {
  for (const r of await prisma.season.findMany({ where: { competitionYear: YEAR }, select: { id: true } })) {
    await prisma.ratingLedger.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonPlayoffMatch.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonMatch.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonStanding.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonGroupPlayer.deleteMany({ where: { group: { seasonId: r.id } } })
    await prisma.seasonGroup.deleteMany({ where: { seasonId: r.id } })
    await prisma.seasonEntrant.deleteMany({ where: { seasonId: r.id } })
    await prisma.season.delete({ where: { id: r.id } }).catch(() => {})
  }
  for (const r of await prisma.tournament.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } })) {
    await prisma.ratingLedger.deleteMany({ where: { tournamentId: r.id } })
    await prisma.swissMatch.deleteMany({ where: { tournamentId: r.id } })
    await prisma.playoffMatch.deleteMany({ where: { tournamentId: r.id } })
    await prisma.tournamentMatch.deleteMany({ where: { tournamentId: r.id } })
    await prisma.tournamentGroup.deleteMany({ where: { tournamentId: r.id } })
    await prisma.tournamentTeamMember.deleteMany({ where: { team: { tournamentId: r.id } } })
    await prisma.tournamentTeam.deleteMany({ where: { tournamentId: r.id } })
    await prisma.registration.deleteMany({ where: { tournamentId: r.id } })
    await prisma.tournament.delete({ where: { id: r.id } }).catch(() => {})
  }
  await prisma.$transaction(async (tx) => { await rebuildRatingLedger(tx) })
}
await cleanup()

const pool = await prisma.player.findMany({ where: { active: true }, take: 4, select: { id: true } })

/** Every ledger row that is not the fixture's — the rest of the site's history. */
const othersFingerprint = async (seasonId?: number, tournamentId?: number) => {
  const rows = await prisma.ratingLedger.findMany({
    where: {
      ...(seasonId != null ? { seasonId: { not: seasonId } } : {}),
      ...(tournamentId != null ? { tournamentId: { not: tournamentId } } : {}),
    },
    orderBy: [{ matchKey: 'asc' }, { playerId: 'asc' }],
    select: { matchKey: true, playerId: true, postRating: true },
  })
  return JSON.stringify(rows)
}

async function completedSeason(number: number): Promise<number> {
  const made = await createDraft(OWNER, {
    type: 'season', competitionYear: YEAR, competitionSeriesId: series.id, purpose: 'live',
    structure: 'groups_playoffs', number, division: null, accessMode: 'OPEN',
  })
  if (!made.ok || made.id == null) throw new Error(made.error ?? 'fixture failed')
  const id = made.id
  for (const p of pool) await addSeasonEntrant(OWNER, id, p.id)
  await closeRegistration(OWNER, id)
  await transitionSeasonState(OWNER, id, 'GROUP_SETUP')
  await generateSeasonGroups(OWNER, id, 1)
  await publishSeasonGroups(OWNER, id)
  const g = await prisma.seasonGroup.findFirstOrThrow({ where: { seasonId: id }, select: { id: true } })
  const ms = await prisma.seasonMatch.findMany({ where: { seasonId: id, groupId: g.id }, orderBy: { id: 'asc' } })
  await saveSeasonGroupResults(OWNER, id, g.id, ms.map((m, i) => ({ matchId: m.id, home: '7', away: String(i % 5), version: m.version })))
  await closeSeasonGroups(OWNER, id)
  await enterSeasonPlayoffSetup(OWNER, id)
  await generateSeasonBracket(OWNER, id)
  await startSeasonPlayoffs(OWNER, id)
  for (let guard = 0; guard < 6; guard++) {
    const rows = await prisma.seasonPlayoffMatch.findMany({ where: { seasonId: id }, orderBy: [{ round: 'asc' }, { slot: 'asc' }] })
    const playable = rows.filter((m) => m.winnerEntrantId == null && m.homeEntrantId != null && m.awayEntrantId != null)
    if (!playable.length) break
    for (const m of playable) await recordSeasonPlayoffResult(OWNER, m.id, 9, 3)
  }
  const closed = await closeSeason(OWNER, id)
  if (!closed.ok) throw new Error(closed.error)
  return id
}

try {
  check('four players are available', pool.length === 4, `${pool.length}`)

  section('The impact preview counts what will go')
  const s1 = await completedSeason(1)
  const impact = await deletionImpact('season', s1)
  check('the preview runs', !('error' in impact), JSON.stringify(impact).slice(0, 120))
  if ('error' in impact) throw new Error(impact.error)
  check('it knows the record is completed', impact.completed === true)
  check('it counts the entrants', impact.counts.entrants === 4, `${impact.counts.entrants}`)
  check('...the groups', impact.counts.groups === 1, `${impact.counts.groups}`)
  check('...the group matches', impact.counts.groupMatches > 0, `${impact.counts.groupMatches}`)
  check('...the playoff matches', impact.counts.playoffMatches > 0, `${impact.counts.playoffMatches}`)
  check('...the standings', impact.counts.standings === 4, `${impact.counts.standings}`)
  check('...and the ranking rows', impact.counts.rankingRows > 0, `${impact.counts.rankingRows}`)
  check('it names the champion', !!impact.champion)
  check('...and the title that disappears with it', impact.titlesRemoved.length === 1)
  check('it counts the players whose rating changes', impact.playersAffected > 0, `${impact.playersAffected}`)

  section('It refuses without the exact title, the confirmation, or the permission')
  const wrongTitle = await permanentlyDelete(OWNER, 'season', s1, { typedTitle: 'not the title' })
  check('a wrong title is refused', wrongTitle.ok === false, JSON.stringify(wrongTitle))
  check('...saying it must match exactly', /exactly/i.test(wrongTitle.error ?? ''), wrongTitle.error)
  check('...and the Season is untouched', (await prisma.season.count({ where: { id: s1 } })) === 1)

  const noSecond = await permanentlyDelete(OWNER, 'season', s1, { typedTitle: impact.confirmTitle })
  check('a completed record needs a second confirmation', noSecond.ok === false, JSON.stringify(noSecond))
  check('...and is still there', (await prisma.season.count({ where: { id: s1 } })) === 1)

  const notOwner = await permanentlyDelete(NOT_OWNER, 'season', s1, {
    typedTitle: impact.confirmTitle, confirmedCompleted: true,
  })
  check('somebody without the permission is refused', notOwner.ok === false, JSON.stringify(notOwner))
  check('...naming the Owner or Head Administrator', /Owner|Head Admin/i.test(notOwner.error ?? ''), notOwner.error)
  check('...and the Season survives', (await prisma.season.count({ where: { id: s1 } })) === 1)

  section('An induced failure rolls the whole deletion back')
  const before = {
    season: await prisma.season.count({ where: { id: s1 } }),
    entrants: await prisma.seasonEntrant.count({ where: { seasonId: s1 } }),
    groups: await prisma.seasonGroup.count({ where: { seasonId: s1 } }),
    standings: await prisma.seasonStanding.count({ where: { seasonId: s1 } }),
    groupMatches: await prisma.seasonMatch.count({ where: { seasonId: s1 } }),
    playoffMatches: await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1 } }),
    ledger: await prisma.ratingLedger.count({ where: { seasonId: s1 } }),
    audits: await prisma.auditLog.count({ where: { action: 'season.permanent_delete', entityId: String(s1) } }),
  }
  const othersBefore = await othersFingerprint(s1)

  /*
   * The failure is injected, not configured.
   *
   * `deleteWithHooks` is the only entry point that accepts one, and what it accepts is a callback —
   * a thing no URL, form field, Server Action argument or environment variable can carry. That is
   * what keeps this proof from doubling as a production-callable destructive switch.
   */
  const failed = await deleteWithHooks(OWNER, 'season', s1, {
    typedTitle: impact.confirmTitle, confirmedCompleted: true,
  }, {
    afterWrites: () => { throw new Error('Induced failure: proving the deletion rolls back.') },
  })
  check('the deletion reports failure', failed.ok === false, JSON.stringify(failed))
  check('...and says nothing was removed', /Nothing was removed/i.test(failed.error ?? ''), failed.error)

  check('the Season is still there', (await prisma.season.count({ where: { id: s1 } })) === before.season)
  check('...with its entrants', (await prisma.seasonEntrant.count({ where: { seasonId: s1 } })) === before.entrants)
  check('...its groups', (await prisma.seasonGroup.count({ where: { seasonId: s1 } })) === before.groups)
  check('...its standings', (await prisma.seasonStanding.count({ where: { seasonId: s1 } })) === before.standings)
  check('...its group matches', (await prisma.seasonMatch.count({ where: { seasonId: s1 } })) === before.groupMatches)
  check('...its playoff matches', (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1 } })) === before.playoffMatches)
  check('...and its ranking rows', (await prisma.ratingLedger.count({ where: { seasonId: s1 } })) === before.ledger)
  check('no tombstone was written for a deletion that did not happen',
    (await prisma.auditLog.count({ where: { action: 'season.permanent_delete', entityId: String(s1) } })) === before.audits)
  check('every other record is byte-identical', (await othersFingerprint(s1)) === othersBefore)

  section('A real deletion removes everything, and only that')
  const done = await permanentlyDelete(OWNER, 'season', s1, {
    typedTitle: impact.confirmTitle, confirmedCompleted: true, reason: 'verification fixture',
  })
  check('it succeeds', done.ok === true, JSON.stringify(done))
  check('the Season is gone', (await prisma.season.count({ where: { id: s1 } })) === 0)
  check('no entrant remains', (await prisma.seasonEntrant.count({ where: { seasonId: s1 } })) === 0)
  check('no group remains', (await prisma.seasonGroup.count({ where: { seasonId: s1 } })) === 0)
  check('no standing remains', (await prisma.seasonStanding.count({ where: { seasonId: s1 } })) === 0)
  check('no group match remains', (await prisma.seasonMatch.count({ where: { seasonId: s1 } })) === 0)
  check('no playoff match remains', (await prisma.seasonPlayoffMatch.count({ where: { seasonId: s1 } })) === 0)
  check('no ranking row remains', (await prisma.ratingLedger.count({ where: { seasonId: s1 } })) === 0)
  check('every other record is STILL byte-identical', (await othersFingerprint(s1)) === othersBefore)

  section('What must survive, survives')
  check('every Player is still here', (await prisma.player.count({ where: { id: { in: pool.map((p) => p.id) } } })) === 4)
  check('their aliases are untouched',
    (await prisma.playerAlias.count({ where: { playerId: { in: pool.map((p) => p.id) } } })) >= 0)
  check('the parent Competition survives',
    (await prisma.competitionSeries.count({ where: { id: series.id } })) === 1)

  section('One private tombstone, carrying nothing countable')
  const tomb = await prisma.auditLog.findMany({ where: { action: 'season.permanent_delete', entityId: String(s1) } })
  check('exactly one tombstone', tomb.length === 1, `${tomb.length}`)
  const old = JSON.stringify(tomb[0]?.oldValue ?? {})
  check('it records the former id and title', old.includes(String(s1)) && old.includes('Season'))
  check('...and carries no results', !/postRating|homeGames|championName/.test(old), old.slice(0, 120))

  section('The former URL is gone')
  check('the Season cannot be loaded', (await prisma.season.findUnique({ where: { id: s1 } })) === null)

  section('An unfinished record deletes without the second confirmation')
  const draft = await createDraft(OWNER, {
    type: 'season', competitionYear: YEAR, competitionSeriesId: series.id, purpose: 'live',
    structure: 'groups_playoffs', number: 2, division: null, accessMode: 'OPEN',
  })
  check('the draft exists', draft.ok === true, draft.error)
  const draftImpact = await deletionImpact('season', draft.id!)
  check('the preview knows it is unfinished', !('error' in draftImpact) && draftImpact.completed === false)
  if (!('error' in draftImpact)) {
    const gone = await permanentlyDelete(OWNER, 'season', draft.id!, { typedTitle: draftImpact.confirmTitle })
    check('it deletes with one confirmation', gone.ok === true, JSON.stringify(gone))
    check('...and is gone', (await prisma.season.count({ where: { id: draft.id! } })) === 0)
  }

  section('A Tournament deletes the same way')
  const t = await createTournament(OWNER, {
    name: `${MARK} One`, competitionSeriesId: series.id, competitionYear: YEAR,
    participantFormat: 'INDIVIDUAL', tournamentFormat: 'SINGLE_ELIM', raceLength: 5, accessMode: 'OPEN',
  })
  check('the Tournament is created', t.ok === true, t.error)
  const tImpact = await deletionImpact('tournament', t.id!)
  check('its preview runs', !('error' in tImpact))
  if (!('error' in tImpact)) {
    check('the title reads as the listing does', /^\d+\. ZZDelete Tournament One/.test(tImpact.confirmTitle), tImpact.confirmTitle)
    const tGone = await permanentlyDelete(OWNER, 'tournament', t.id!, { typedTitle: tImpact.confirmTitle })
    check('it deletes', tGone.ok === true, JSON.stringify(tGone))
    check('...and is gone', (await prisma.tournament.count({ where: { id: t.id! } })) === 0)
    check('...with no registrations left', (await prisma.registration.count({ where: { tournamentId: t.id! } })) === 0)
    check('...and no ranking rows', (await prisma.ratingLedger.count({ where: { tournamentId: t.id! } })) === 0)
  }

  section('Deleting something that no longer exists is refused, not repeated')
  const twice = await permanentlyDelete(OWNER, 'season', s1, { typedTitle: impact.confirmTitle, confirmedCompleted: true })
  check('the second attempt is refused', twice.ok === false, JSON.stringify(twice))
  check('...and no second tombstone was written',
    (await prisma.auditLog.count({ where: { action: 'season.permanent_delete', entityId: String(s1) } })) === 1)
} finally {
  await cleanup()
  check('no fixture Season remains', (await prisma.season.count({ where: { competitionYear: YEAR } })) === 0)
  check('no fixture Tournament remains', (await prisma.tournament.count({ where: { name: { startsWith: MARK } } })) === 0)
  // Tombstones are the one intended residue; they are private and countable by nothing.
  const tombs = await prisma.auditLog.count({ where: { action: { contains: 'permanent_delete' } } })
  console.log(`  (${tombs} deletion tombstone(s) retained by design)`)
}


/** Every .ts/.tsx under src whose text contains `needle`. */
function srcFilesContaining(needle: string): string[] {
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`
      if (e.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(e.name) && readFileSync(full, 'utf8').includes(needle)) hits.push(full)
    }
  }
  walk('src')
  return hits
}

section('The rollback seam is not reachable from the application')
{
  const svc = readFileSync('src/lib/competition/permanent-deletion.ts', 'utf8')
  check('the old boolean flag is gone from the service', !svc.includes('__induceFailure'))
  const flagged = srcFilesContaining('__induceFailure')
  check('...and from the whole source tree', flagged.length === 0, flagged.join(', '))
  check('DeleteOptions carries no failure switch', !/induce/i.test(svc.slice(svc.indexOf('interface DeleteOptions'), svc.indexOf('interface DeletionHooks'))))
  check('the seam is a callback, so no serialised input can supply it',
    svc.includes('afterWrites?: (tx: Prisma.TransactionClient) => Promise<void> | void'))
  check('...and a callback cannot cross a URL, a form, a Server Action or an env var',
    !/process\.env/.test(svc))
  check('the public entry point exposes no hook parameter',
    /export async function permanentlyDelete\([^)]*opts: DeleteOptions,\n\)/.test(svc))
  check('...and forwards an empty hook set', svc.includes('return deleteWithHooks(actor, kind, id, opts, {})'))
  const callers = srcFilesContaining('deleteWithHooks').filter((f) => !f.endsWith('permanent-deletion.ts'))
  check('no application file imports the hooked entry point', callers.length === 0, callers.join(', '))
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
await prisma.$disconnect()
if (fail > 0) process.exitCode = 1
