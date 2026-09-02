import 'server-only'

import { prisma } from '@/lib/prisma'
import { profileSlug } from '@/lib/identity/public-identity'

/**
 * The Players directory — everybody who currently counts as a player.
 *
 * ── What "active" leaves out, and why ───────────────────────────────────────────────────────────
 * `active` is the staff flag for hiding a profile outright, so an inactive one has been deliberately
 * withdrawn and does not belong in a public list.
 *
 * `managementOnly` is a separate thing: a real login for running the site rather than a competitor.
 * The schema already says it is "kept out of the member list and out of every entrant/free-agent
 * selector", and a directory of players is exactly that kind of list, so it is excluded here too.
 * Including it would put the site's own admin account in a list of competitors.
 */
export interface DirectoryPlayer {
  id: string
  cueverseId: string | null
  preferredName: string
  /** Where their profile lives, or null when there is nothing to link to. */
  slug: string | null
  /** Whether a login is attached — an archive figure has a profile but no account. */
  hasAccount: boolean
  /** Recorded matches, so a directory of 500 names says who actually played. */
  matches: number
}

export async function listActivePlayers(): Promise<DirectoryPlayer[]> {
  const players = await prisma.player.findMany({
    where: { active: true, managementOnly: false },
    select: { id: true, cueverseId: true, primaryName: true, linkedUserId: true },
  })

  /*
    Match counts in one grouped query rather than one per player.

    Five hundred profiles is five hundred round trips if this is done per row, and the figure is
    only there to tell a name with a career apart from a name without one.
  */
  const counts = await prisma.ratingLedger.groupBy({
    by: ['playerId'],
    _count: { _all: true },
  })
  const byPlayer = new Map(counts.map((c) => [c.playerId, c._count._all]))

  /*
    Sorted here rather than by the database.

    This database's collation is `C` — raw byte order — so `ORDER BY cueverseId` puts every capital
    before every lowercase letter: DJBlaster ahead of DeadPoolPrime, GODZERO ahead of Gr4vity,
    ImThatGood ahead of Im_Not_That_Bad. Every one of those is correct by byte value and none of
    them is what a reader scanning an alphabetical list expects.

    Postgres cannot be asked for a case-insensitive order through Prisma's `orderBy` without a
    `lower()` or a COLLATE clause, and five hundred rows are already being read and mapped, so the
    comparison happens here where it can simply be the right one.

    `Intl.Collator` with `sensitivity: 'base'` folds case and accents together — "ArsH_" sits with
    the A's, "José" with the J's — and `numeric` orders digits the way they are read, so player2
    comes before player10 rather than after it.
  */
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  players.sort((a, b) =>
    collator.compare(a.cueverseId ?? a.primaryName, b.cueverseId ?? b.primaryName)
    || collator.compare(a.primaryName, b.primaryName))

  return players.map((p) => ({
    id: p.id,
    cueverseId: p.cueverseId,
    preferredName: p.primaryName,
    slug: profileSlug(p.cueverseId, p.id),
    hasAccount: p.linkedUserId != null,
    matches: byPlayer.get(p.id) ?? 0,
  }))
}
