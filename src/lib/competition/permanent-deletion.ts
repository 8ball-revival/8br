import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { recordAudit, type Actor } from '@/lib/competition/audit'
import { rebuildRatingLedger } from '@/lib/stats/ledger'
import { LEDGER_TX_OPTIONS } from '@/lib/stats/ledger'

/**
 * Deleting a competition so completely that it never happened.
 *
 * ── Why this is not a soft delete ────────────────────────────────────────────────────────────────
 * A hidden record still contributes: its matches are in the ledger, its champion is in somebody's
 * title count, and its entrants show up in career totals. "Delete" that leaves any of that behind is
 * a lie the site keeps telling. So this removes the competition data outright and rebuilds the
 * ranking ledger from what remains, which is the only way to undo a path-dependent rating history.
 *
 * ── What survives, and why ───────────────────────────────────────────────────────────────────────
 * Player accounts, aliases and the parent Competition are NOT this record's to delete. A person who
 * played in a Season deleted by mistake still exists; a Competition outlives any one of its Seasons.
 * Deleting them would turn an over-reach into data loss nobody asked for.
 *
 * What does survive of the record itself is one audit row: former id, type, title, who, when. It is
 * private, counted by nothing, and exists so a deletion can be explained afterwards. A deletion with
 * no trace at all is indistinguishable from data that silently vanished.
 *
 * ── All of it, or none of it ─────────────────────────────────────────────────────────────────────
 * One transaction. A half-deleted competition — entrants gone, matches remaining — is worse than
 * either outcome, because nothing downstream can interpret it. The ledger rebuild happens inside
 * the same transaction, so a failure there takes the deletion with it.
 */

export type RecordKind = 'season' | 'tournament'

export interface DeletionImpact {
  kind: RecordKind
  id: number
  title: string
  /** Typed back by the operator, exactly, before anything is removed. */
  confirmTitle: string
  completed: boolean
  counts: {
    entrants: number
    teams: number
    rosterMembers: number
    groups: number
    standings: number
    groupMatches: number
    playoffMatches: number
    swissMatches: number
    rankingRows: number
  }
  champion: string | null
  runnerUp: string | null
  /** Titles that disappear with the record, by player name. */
  titlesRemoved: string[]
  /** Players whose rating will be recomputed because they played in it. */
  playersAffected: number
  publicUrl: string
}

export async function deletionImpact(kind: RecordKind, id: number): Promise<DeletionImpact | { error: string }> {
  if (kind === 'season') {
    const s = await prisma.season.findUnique({
      where: { id },
      select: {
        id: true, number: true, subtitle: true, competitionYear: true, lifecycleState: true,
        championName: true, runnerUpName: true,
        competitionSeries: { select: { name: true } },
      },
    })
    if (!s) return { error: 'That Season no longer exists.' }

    const [entrants, groups, standings, groupMatches, playoffMatches, rankingRows, players] = await Promise.all([
      prisma.seasonEntrant.count({ where: { seasonId: id } }),
      prisma.seasonGroup.count({ where: { seasonId: id } }),
      prisma.seasonStanding.count({ where: { seasonId: id } }),
      prisma.seasonMatch.count({ where: { seasonId: id } }),
      prisma.seasonPlayoffMatch.count({ where: { seasonId: id } }),
      prisma.ratingLedger.count({ where: { seasonId: id } }),
      prisma.ratingLedger.findMany({ where: { seasonId: id }, select: { playerId: true }, distinct: ['playerId'] }),
    ])

    const title = `${s.competitionSeries?.name ?? 'Competition'} Season ${s.number} · ${s.competitionYear}`
    return {
      kind, id, title, confirmTitle: title,
      completed: String(s.lifecycleState) === 'COMPLETED',
      counts: {
        entrants, teams: 0, rosterMembers: 0, groups, standings,
        groupMatches, playoffMatches, swissMatches: 0, rankingRows,
      },
      champion: s.championName,
      runnerUp: s.runnerUpName,
      titlesRemoved: s.championName ? [s.championName] : [],
      playersAffected: players.length,
      publicUrl: `/seasons/${id}`,
    }
  }

  const t = await prisma.tournament.findUnique({
    where: { id },
    select: {
      id: true, number: true, name: true, competitionYear: true, lifecycleState: true,
      championName: true, runnerUpName: true, participantFormat: true,
      competitionSeries: { select: { name: true } },
    },
  })
  if (!t) return { error: 'That Tournament no longer exists.' }

  const [entrants, teams, rosterMembers, groups, groupMatches, playoffMatches, swissMatches, rankingRows, players] =
    await Promise.all([
      prisma.registration.count({ where: { tournamentId: id } }),
      prisma.tournamentTeam.count({ where: { tournamentId: id } }),
      prisma.tournamentTeamMember.count({ where: { team: { tournamentId: id } } }),
      prisma.tournamentGroup.count({ where: { tournamentId: id } }),
      prisma.tournamentMatch.count({ where: { tournamentId: id } }),
      prisma.playoffMatch.count({ where: { tournamentId: id } }),
      prisma.swissMatch.count({ where: { tournamentId: id } }),
      prisma.ratingLedger.count({ where: { tournamentId: id } }),
      prisma.ratingLedger.findMany({ where: { tournamentId: id }, select: { playerId: true }, distinct: ['playerId'] }),
    ])

  const title = [t.number != null ? `${t.number}. ${t.name}` : t.name, t.competitionSeries?.name, t.competitionYear]
    .filter(Boolean).join(' · ')

  /*
   * A team Tournament's title belongs to every member of the winning roster, so every one of them
   * loses it. Naming them individually is the point: "one championship removed" understates what a
   * 5v5 deletion actually does.
   */
  const titlesRemoved: string[] = []
  if (t.championName) {
    if (String(t.participantFormat) === 'TEAM') {
      const winners = await prisma.tournamentTeamMember.findMany({
        where: { team: { tournamentId: id, name: t.championName } },
        select: { name: true },
      })
      titlesRemoved.push(...(winners.length ? winners.map((w) => w.name) : [t.championName]))
    } else {
      titlesRemoved.push(t.championName)
    }
  }

  return {
    kind, id, title, confirmTitle: title,
    completed: String(t.lifecycleState) === 'COMPLETED',
    counts: {
      entrants, teams, rosterMembers, groups, standings: 0,
      groupMatches, playoffMatches, swissMatches, rankingRows,
    },
    champion: t.championName,
    runnerUp: t.runnerUpName,
    titlesRemoved,
    playersAffected: players.length,
    publicUrl: t.number != null ? `/tournaments/${t.number}` : '/tournaments',
  }
}

export interface DeleteOptions {
  /** Typed by the operator; must equal the impact's `confirmTitle` exactly. */
  typedTitle: string
  /** A completed record needs a second, separate acknowledgement. */
  confirmedCompleted?: boolean
  reason?: string
}

/**
 * The rollback seam.
 *
 * Rollback is the property that makes permanent deletion safe to offer at all, and the only honest
 * way to prove it is to make the transaction fail at the last possible moment and show the record is
 * still whole. That proof needs a way in — and the way in must not be something an application
 * caller can reach.
 *
 * A FUNCTION is what makes that true. Everything that crosses into this service from the outside
 * world crosses a serialisation boundary: a URL, a form field, a Server Action argument, a REST or
 * GraphQL body, an environment variable. None of them can carry a callback. A boolean flag on the
 * options object could travel every one of those paths — which is exactly what it used to be — so
 * the flag is gone and the seam is a parameter only a test, holding a real reference to this module,
 * can supply.
 *
 * It is deliberately not on `DeleteOptions`, and no code under `src/app` or `src/components`
 * imports the entry point that accepts it. verify-permanent-deletion asserts both.
 */
export interface DeletionHooks {
  /** Runs inside the transaction, after every delete and the rebuild, before commit. */
  afterWrites?: (tx: Prisma.TransactionClient) => Promise<void> | void
}

export async function permanentlyDelete(
  actor: Actor & { canDelete: boolean },
  kind: RecordKind,
  id: number,
  opts: DeleteOptions,
): Promise<{ ok: boolean; error?: string; removed?: DeletionImpact['counts'] }> {
  // The application path cannot pass hooks: there is no parameter for them here.
  return deleteWithHooks(actor, kind, id, opts, {})
}

/**
 * The same deletion, with the rollback seam exposed.
 *
 * Only a test calls this. It is separate from `permanentlyDelete` so that the function every real
 * caller uses has no parameter capable of altering what the transaction does.
 */
export async function deleteWithHooks(
  actor: Actor & { canDelete: boolean },
  kind: RecordKind,
  id: number,
  opts: DeleteOptions,
  hooks: DeletionHooks,
): Promise<{ ok: boolean; error?: string; removed?: DeletionImpact['counts'] }> {
  if (!actor.canDelete) {
    return { ok: false, error: 'Only the Owner or Head Administrator can permanently delete a competition.' }
  }

  const impact = await deletionImpact(kind, id)
  if ('error' in impact) return { ok: false, error: impact.error }

  if (opts.typedTitle.trim() !== impact.confirmTitle) {
    return { ok: false, error: 'The title does not match. Type it exactly as shown to confirm.' }
  }
  if (impact.completed && !opts.confirmedCompleted) {
    return {
      ok: false,
      error: 'This record is completed. Confirm again that its results, champion and ranking contribution should be removed.',
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (kind === 'season') {
        await tx.ratingLedger.deleteMany({ where: { seasonId: id } })
        await tx.seasonPlayoffMatch.deleteMany({ where: { seasonId: id } })
        await tx.seasonMatch.deleteMany({ where: { seasonId: id } })
        await tx.seasonStanding.deleteMany({ where: { seasonId: id } })
        await tx.seasonGroupPlayer.deleteMany({ where: { group: { seasonId: id } } })
        await tx.seasonGroup.deleteMany({ where: { seasonId: id } })
        await tx.seasonEntrant.deleteMany({ where: { seasonId: id } })
        await tx.season.delete({ where: { id } })
      } else {
        await tx.ratingLedger.deleteMany({ where: { tournamentId: id } })
        await tx.swissMatch.deleteMany({ where: { tournamentId: id } })
        await tx.playoffMatch.deleteMany({ where: { tournamentId: id } })
        await tx.tournamentMatch.deleteMany({ where: { tournamentId: id } })
        await tx.tournamentGroup.deleteMany({ where: { tournamentId: id } })
        await tx.tournamentTeamMember.deleteMany({ where: { team: { tournamentId: id } } })
        await tx.tournamentTeam.deleteMany({ where: { tournamentId: id } })
        await tx.registration.deleteMany({ where: { tournamentId: id } })
        await tx.tournament.delete({ where: { id } })
      }

      /*
       * The tombstone, written before the rebuild so it shares the transaction's fate.
       *
       * Deliberately minimal: what it was, who removed it, when. No results, no participants, no
       * counts that any public total could pick up — a deletion must not leave a shadow that shows
       * up in somebody's statistics.
       */
      await recordAudit(actor, {
        action: kind === 'season' ? 'season.permanent_delete' : 'tournament.permanent_delete',
        entity: kind === 'season' ? 'Season' : 'Tournament',
        entityId: id,
        oldValue: { formerId: id, kind, title: impact.title },
        reason: opts.reason?.trim() || undefined,
      }, tx)

      // Rebuilt from what remains: the only way to undo a path-dependent rating history.
      await rebuildRatingLedger(tx)

      await hooks.afterWrites?.(tx)
    }, LEDGER_TX_OPTIONS)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'The deletion failed.'
    return { ok: false, error: `${msg} Nothing was removed.` }
  }

  return { ok: true, removed: impact.counts }
}
