import 'server-only'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from './audit'
import { syncLiveCupToSnapshot } from './cup-sync'

/**
 * One-time migration: convert a LEGACY single-elimination cup (stored read-only in
 * `CupBracketMatch`, from before the editable workspace existed) into the editable
 * workspace (Registration entrants + PlayoffMatch), preserving EVERYTHING exactly —
 * entrants, bracket positions, scores, winners, advances, byes, notes, completed rounds.
 * Only unfinished matches remain editable. Idempotent-safe: refuses if already converted
 * (a PlayoffMatch bracket exists). Not a duplicate, no re-entry of results.
 *
 * Scope (safest assumption): single-elim individual cups only (MAIN bracket, no
 * winners/losers/grand-final, no team ties). Double-elim / team-tie legacy cups are not
 * convertible by the current editable engine and are left as read-only archive.
 */
export async function convertLegacyCup(actor: Actor, seasonId: number): Promise<{ ok: boolean; error?: string }> {
  const season = await prisma.season.findUnique({ where: { id: seasonId } })
  if (!season || season.competitionType !== 'CUP') return { ok: false, error: 'Cup not found.' }
  if (season.locked) return { ok: false, error: 'This cup is a locked historical competition. Unlock it first if it truly must be edited.' }

  const existingPlayoff = await prisma.playoffMatch.count({ where: { seasonId } })
  if (existingPlayoff > 0) return { ok: false, error: 'This cup is already editable (it has a workspace bracket).' }

  const rows = await prisma.cupBracketMatch.findMany({ where: { competitionId: seasonId }, orderBy: [{ roundOrder: 'asc' }, { matchOrder: 'asc' }] })
  if (rows.length === 0) return { ok: false, error: 'This cup has no bracket to convert.' }
  if (rows.some((r) => r.bracketKind !== 'MAIN')) return { ok: false, error: 'Double-elimination cups cannot be converted yet (the editable engine is single-elimination).' }
  const teamTies = await prisma.cupTeamTie.count({ where: { competitionId: seasonId } })
  if (teamTies > 0) return { ok: false, error: 'Team-format cups cannot be converted yet.' }

  // Re-index rounds (roundOrder → 1..N) and slots (0-based, in bracket order per round).
  const roundOrders = [...new Set(rows.map((r) => r.roundOrder))].sort((a, b) => a - b)
  const roundIndex = new Map(roundOrders.map((ro, i) => [ro, i + 1]))
  const byRound = new Map<number, typeof rows>()
  for (const r of rows) {
    const ri = roundIndex.get(r.roundOrder)!
    if (!byRound.has(ri)) byRound.set(ri, [])
    byRound.get(ri)!.push(r)
  }
  for (const list of byRound.values()) list.sort((a, b) => a.matchOrder - b.matchOrder)
  const totalRounds = roundOrders.length

  // One entrant per distinct competitor (by name+handle). The same person appears across
  // rounds as they advance — dedupe so advancement links to a single registration.
  const key = (name: string | null, handle: string | null) => `${(name ?? '').toLowerCase().trim()}|${(handle ?? '').toLowerCase().trim()}`
  type Comp = { name: string; handle: string | null; seed: number | null }
  const comps = new Map<string, Comp>()
  const consider = (present: boolean, name: string | null, handle: string | null, seed: number | null) => {
    if (!present || !name) return
    const k = key(name, handle)
    const existing = comps.get(k)
    if (!existing) comps.set(k, { name, handle, seed })
    else if (existing.seed == null && seed != null) existing.seed = seed
  }
  for (const r of rows) {
    consider(r.aPresent, r.aName, r.aHandle, r.aSeed)
    consider(r.bPresent, r.bName, r.bHandle, r.bSeed)
  }

  try {
    await prisma.$transaction(async (tx) => {
      // 1) Entrants
      const regIdByKey = new Map<string, number>()
      for (const [k, c] of comps) {
        const reg = await tx.registration.create({
          data: {
            seasonId,
            username: c.name,
            displayName: c.name,
            cueverseId: c.handle,
            seed: c.seed ?? null,
            status: 'APPROVED',
            addedByAdmin: true,
            approvedAt: new Date(),
          },
        })
        regIdByKey.set(k, reg.id)
      }
      const regOf = (present: boolean, name: string | null, handle: string | null) =>
        present && name ? regIdByKey.get(key(name, handle)) ?? null : null

      // 2) Bracket matches (mirror positions/scores/winners/notes exactly)
      const idByRoundSlot = new Map<string, number>()
      for (const ri of [...byRound.keys()].sort((a, b) => a - b)) {
        const list = byRound.get(ri)!
        for (let slot = 0; slot < list.length; slot++) {
          const r = list[slot]
          const homeReg = regOf(r.aPresent, r.aName, r.aHandle)
          const awayReg = regOf(r.bPresent, r.bName, r.bHandle)
          const winnerReg = r.winner === 'a' ? homeReg : r.winner === 'b' ? awayReg : null
          const decided = r.winner === 'a' || r.winner === 'b'
          const created = await tx.playoffMatch.create({
            data: {
              seasonId,
              round: ri,
              slot,
              label: r.roundName,
              homeRegistrationId: homeReg,
              awayRegistrationId: awayReg,
              homeUsername: r.aPresent ? r.aName : null,
              awayUsername: r.bPresent ? r.bName : null,
              homeSeed: r.aSeed,
              awaySeed: r.bSeed,
              homeGames: r.aScore,
              awayGames: r.bScore,
              winnerRegistrationId: winnerReg,
              status: decided ? 'COMPLETED' : 'SCHEDULED',
              verification: decided ? 'VERIFIED' : 'UNVERIFIED',
              completedAt: decided ? new Date() : null,
              note: r.note,
              published: true,
            },
          })
          idByRoundSlot.set(`${ri}:${slot}`, created.id)
        }
      }

      // 3) Wire advancement (standard single-elim: match s in round r feeds floor(s/2)
      //    slot s%2 in round r+1) so future edits advance winners correctly.
      for (const ri of [...byRound.keys()].sort((a, b) => a - b)) {
        if (ri >= totalRounds) continue
        const list = byRound.get(ri)!
        for (let slot = 0; slot < list.length; slot++) {
          const id = idByRoundSlot.get(`${ri}:${slot}`)!
          const feedsId = idByRoundSlot.get(`${ri + 1}:${Math.floor(slot / 2)}`)
          if (feedsId != null) await tx.playoffMatch.update({ where: { id }, data: { feedsMatchId: feedsId, feedsSlot: slot % 2 } })
        }
      }

      // 4) Mark converted → now behaves like a natively-created editable cup.
      await tx.season.update({
        where: { id: seasonId },
        data: { importedFromFixture: false, convertedAt: new Date(), playoffsStatus: 'PUBLISHED' },
      })
      await recordAudit(actor, {
        action: 'cup.convertLegacy', entity: 'Season', entityId: seasonId,
        newValue: { entrants: comps.size, matches: rows.length, rounds: totalRounds },
      }, tx)
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Conversion failed.' }
  }

  // Re-materialise the snapshot from the new editable bracket (faithful mirror → rankings
  // stay identical) so PlayoffMatch is the single source going forward.
  await syncLiveCupToSnapshot(seasonId)
  return { ok: true }
}
