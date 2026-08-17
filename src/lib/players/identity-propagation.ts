import 'server-only'
import { prisma } from '@/lib/prisma'
import { cueverseLoginKey } from '@/lib/account/validation'

/**
 * Push a renamed identity out to every competition record that copied it.
 *
 * Seasons and tournaments denormalise a player's handle and display name onto entrants,
 * registrations, matches, standings, bracket slots, team rosters, champion fields and the rating
 * ledger. That is deliberate — a result should still read correctly if a profile is later deleted —
 * but it means a rename only reaches the profile page unless those copies are updated too, and the
 * same person then appears under two names depending on which page you are looking at.
 *
 * How rows are matched, in order of preference:
 *
 *   1. by `playerId`, where the row carries one. Exact, and the only safe way to touch a DISPLAY
 *      NAME, which is not unique — several people are called Chris.
 *   2. by the OLD HANDLE, for label columns with no player link. A CueVerse ID is unique
 *      case-insensitively, so this cannot catch the wrong person.
 *   3. paired columns (`aHandle`/`aName`) are matched on the handle and both are updated together.
 *
 * Two things are deliberately NOT rewritten:
 *
 *   · `comp_audit_log.actorUsername` — a record of who did what under the name they had at the time.
 *     Rewriting history is the opposite of what an audit log is for.
 *   · `PlayerAlias` — old handles are kept precisely so a rename stays searchable.
 */

export interface IdentityChange {
  playerId: string
  /** Previous CueVerse ID, or null when the profile had none. */
  oldCueverseId: string | null
  newCueverseId: string | null
  oldPreferredName: string | null
  newPreferredName: string | null
}

export interface PropagationReport {
  /** table -> rows updated. Only non-zero entries appear. */
  updated: Record<string, number>
  total: number
}

/** True when a rename actually moved something worth propagating. */
export function identityChanged(c: IdentityChange): boolean {
  const handleMoved = (c.oldCueverseId ?? '') !== (c.newCueverseId ?? '')
  const nameMoved = (c.oldPreferredName ?? '') !== (c.newPreferredName ?? '')
  return handleMoved || nameMoved
}

export async function propagateIdentityChange(change: IdentityChange): Promise<PropagationReport> {
  const { playerId } = change
  const oldHandle = (change.oldCueverseId ?? '').trim()
  const newHandle = (change.newCueverseId ?? '').trim()
  const oldName = (change.oldPreferredName ?? '').trim()
  const newName = (change.newPreferredName ?? '').trim()

  const handleMoved = oldHandle !== newHandle && oldHandle.length > 0 && newHandle.length > 0
  const nameMoved = oldName !== newName && newName.length > 0

  const updated: Record<string, number> = {}
  const note = (table: string, n: number) => {
    if (n > 0) updated[table] = (updated[table] ?? 0) + n
  }

  // Label columns hold whatever was shown at the time — sometimes the handle, sometimes the display
  // name — so both old values are treated as things that may need replacing.
  const oldLabels = [oldHandle, oldName].filter((v) => v.length > 0)
  /** The value a label should become, given what it currently holds. */
  const labelFor = (current: string): string | null => {
    if (handleMoved && current === oldHandle) return newHandle
    if (nameMoved && current === oldName) return newName
    return null
  }

  await prisma.$transaction(async (tx) => {
    // ---- 1. rows that know the player directly -------------------------------------------------

    // Season entrants: the canonical per-season copy of an identity.
    const entrants = await tx.seasonEntrant.findMany({
      where: { playerId },
      select: { id: true, username: true, displayName: true },
    })
    for (const e of entrants) {
      const data: { username?: string; displayName?: string; cueverseId?: string } = {}
      const u = labelFor(e.username)
      if (u) data.username = u
      if (nameMoved && (e.displayName ?? '') === oldName) data.displayName = newName
      if (handleMoved) data.cueverseId = newHandle
      if (Object.keys(data).length) {
        await tx.seasonEntrant.update({ where: { id: e.id }, data })
        note('season_entrant', 1)
      }
    }

    // Tournament registrations.
    const regs = await tx.registration.findMany({
      where: { playerId },
      select: { id: true, username: true, displayName: true },
    })
    for (const r of regs) {
      const data: { username?: string; displayName?: string } = {}
      const u = labelFor(r.username)
      if (u) data.username = u
      if (nameMoved && (r.displayName ?? '') === oldName) data.displayName = newName
      if (Object.keys(data).length) {
        await tx.registration.update({ where: { id: r.id }, data })
        note('comp_registration', 1)
      }
    }

    // Rating ledger: this player's own rows, plus the opposite row of each of their matches, which
    // names them as the opponent.
    if (nameMoved) {
      const mine = await tx.ratingLedger.updateMany({
        where: { playerId, playerName: oldName },
        data: { playerName: newName },
      })
      note('rating_ledger.playerName', mine.count)

      const keys = (await tx.ratingLedger.findMany({ where: { playerId }, select: { matchKey: true } }))
        .map((r) => r.matchKey)
      if (keys.length) {
        const theirs = await tx.ratingLedger.updateMany({
          where: { matchKey: { in: keys }, playerId: { not: playerId }, opponentName: oldName },
          data: { opponentName: newName },
        })
        note('rating_ledger.opponentName', theirs.count)
      }
    }

    // Team rosters keep BOTH a display name and a handle, and the free-agent pool keeps the handle.
    // Both carry a playerId, so the display name is safe to move here.
    const roster: { handle?: string; name?: string } = {}
    if (handleMoved) roster.handle = newHandle
    if (nameMoved) roster.name = newName
    if (Object.keys(roster).length) {
      note('comp_tournament_team_member',
        (await tx.tournamentTeamMember.updateMany({ where: { playerId }, data: roster })).count)
    }
    if (handleMoved) {
      note('comp_tournament_free_agent',
        (await tx.tournamentFreeAgent.updateMany({ where: { playerId, handle: oldHandle }, data: { handle: newHandle } })).count)
      // Legacy archive-shaped tables also record a raw handle.
      note('Seed',
        (await tx.seed.updateMany({ where: { handle: oldHandle }, data: { handle: newHandle } })).count)
      note('Championship',
        (await tx.championship.updateMany({ where: { championHandle: oldHandle }, data: { championHandle: newHandle } })).count)
    }

    // ---- 2. label columns matched on the old value ---------------------------------------------
    // Handles are unique, so matching on the old handle cannot hit another person. Display names are
    // not, so a name is only replaced where the row also carries the matching handle (below) or a
    // player link (above).

    if (oldLabels.length) {
      for (const table of ['seasonMatch', 'seasonPlayoffMatch', 'tournamentMatch', 'playoffMatch'] as const) {
        for (const side of ['homeUsername', 'awayUsername'] as const) {
          for (const from of oldLabels) {
            const to = labelFor(from)
            if (!to) continue
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const res = await (tx[table] as any).updateMany({ where: { [side]: from }, data: { [side]: to } })
            note(`${table}.${side}`, res.count)
          }
        }
      }
      for (const from of oldLabels) {
        const to = labelFor(from)
        if (!to) continue
        note('season_standing',
          (await tx.seasonStanding.updateMany({ where: { username: from }, data: { username: to } })).count)
        note('comp_standing',
          (await tx.standing.updateMany({ where: { username: from }, data: { username: to } })).count)
      }
    }

    // Swiss boards store display names only, so they are matched on the old name.
    if (nameMoved) {
      note('comp_swiss_match.homeName',
        (await tx.swissMatch.updateMany({ where: { homeName: oldName }, data: { homeName: newName } })).count)
      note('comp_swiss_match.awayName',
        (await tx.swissMatch.updateMany({ where: { awayName: oldName }, data: { awayName: newName } })).count)
    }

    // ---- 3. paired handle/name columns ---------------------------------------------------------
    // Bracket slots keep both. Matching on the handle lets the display name move safely too.
    if (handleMoved || nameMoved) {
      for (const [h, n] of [['aHandle', 'aName'], ['bHandle', 'bName']] as const) {
        const rows = await tx.tournamentBracketMatch.findMany({
          where: { [h]: oldHandle || undefined },
          select: { id: true, [n]: true } as never,
        })
        for (const row of rows as unknown as Array<Record<string, unknown>>) {
          const data: Record<string, string> = {}
          if (handleMoved) data[h] = newHandle
          if (nameMoved && String(row[n] ?? '') === oldName) data[n] = newName
          if (Object.keys(data).length) {
            await tx.tournamentBracketMatch.update({ where: { id: row.id as number }, data })
            note('comp_tournament_bracket_match', 1)
          }
        }
      }
    }

    // ---- 4. champion and runner-up fields ------------------------------------------------------
    // Seasons record the champion's player id, so that side is exact; the runner-up is matched on
    // its handle. Tournaments only keep the pair, so both sides are matched on the handle.
    const champData: Record<string, string> = {}
    if (handleMoved) champData.championHandle = newHandle
    if (nameMoved) champData.championName = newName
    if (Object.keys(champData).length) {
      note('season.champion',
        (await tx.season.updateMany({ where: { championPlayerId: playerId }, data: champData })).count)
    }
    if (handleMoved || nameMoved) {
      for (const [hCol, nCol, label] of [
        ['championHandle', 'championName', 'champion'],
        ['runnerUpHandle', 'runnerUpName', 'runnerUp'],
      ] as const) {
        const data: Record<string, string> = {}
        if (handleMoved) data[hCol] = newHandle
        if (nameMoved) data[nCol] = newName
        if (!oldHandle) continue
        note(`season.${label}`,
          (await tx.season.updateMany({ where: { [hCol]: oldHandle }, data })).count)
        note(`comp_tournament.${label}`,
          (await tx.tournament.updateMany({ where: { [hCol]: oldHandle }, data })).count)
      }
    }
  }, { timeout: 120_000 })

  // A handle change also moves the login key, which some rows store lower-cased.
  if (handleMoved && cueverseLoginKey(oldHandle) !== oldHandle) {
    const lower = await prisma.seasonEntrant.updateMany({
      where: { playerId, username: cueverseLoginKey(oldHandle) },
      data: { username: newHandle },
    })
    note('season_entrant', lower.count)
  }

  const total = Object.values(updated).reduce((s, n) => s + n, 0)
  return { updated, total }
}
