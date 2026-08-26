import 'server-only'
import { unstable_cache } from 'next/cache'

import { prisma } from '@/lib/prisma'
import type { CompetitionPlatform } from '@prisma/client'
import { LADDER_EXPLORER_TAG } from '@/lib/stats/ladder-explorer'

/**
 * Season championship results for the homepage.
 *
 * ── Why this is not `getRecentResults` ───────────────────────────────────────────────────────────
 * The homepage already had a Recent Results panel, and it answers a different question: which
 * individual matches were played most recently. This panel is about TITLES — who won each Season and
 * who they beat — which is the thing an archive is actually for and the thing somebody landing on
 * the homepage wants to see.
 *
 * They are separate queries because merging them would mean one list that is sometimes about matches
 * and sometimes about seasons, and neither reading would be reliable.
 *
 * ── Every field is stored, none is derived here ──────────────────────────────────────────────────
 * Champion, runner-up and the final score are recorded on the Season when it closes. This reads them
 * back; it does not recompute a champion from a bracket, which would be a second opinion about a
 * question the record already answers.
 */

export interface SeasonResultRow {
  seasonId: number
  /** "2005 · Season 1" — the year leads, because that is how the archive is browsed. */
  label: string
  year: number
  number: number
  /** The competition this Season belonged to, for the Event column. */
  event: string
  /** Identity halves, kept separate so the row can lead with the handle like everywhere else. */
  winnerHandle: string | null
  winnerName: string | null
  runnerUpHandle: string | null
  runnerUpName: string | null
  /** As recorded. Null for a forfeited final, which must never be shown as a numeric score. */
  finalScore: string | null
  /** True when the title was decided by a forfeit, so the row can say so instead of inventing one. */
  finalsForfeit: boolean
  href: string
}

async function readSeasonResults(platform: CompetitionPlatform): Promise<SeasonResultRow[]> {
  const rows = await prisma.season.findMany({
    where: {
      /*
       * Scoped to one platform, like every other ranked surface on the site.
       *
       * A CueVerse Season and a Yahoo Season are separate competitive universes — the profiles and
       * the ladders keep them apart because a rating cannot span both. A single list of champions
       * mixing the two would read as one continuous history that never happened, so the homepage
       * shows the era its leaderboard resolved to and the panels agree with each other.
       */
      platform,
      lifecycleState: 'COMPLETED',
      /*
       * No `publiclyVisible` filter, deliberately.
       *
       * The first version had one, and it cut the list from forty-eight seasons to two: the flag is
       * true on almost no archive Season, yet every one of them renders publicly at /seasons/<id>.
       * It is not the gate it looks like. The canonical Seasons browser filters on platform,
       * competition and division and nothing else, so this matches that rather than inventing a
       * stricter rule that silently hides the archive.
       */
      // A Season with no recorded champion has no result to report yet.
      OR: [{ championHandle: { not: null } }, { championName: { not: null } }],
    },
    /*
     * Oldest first, and no limit.
     *
     * An archive reads from the beginning, and the panel scrolls rather than truncating, so there is
     * no reason to cut it to five and every reason not to: the whole record is the point of the site.
     */
    orderBy: [{ competitionYear: 'asc' }, { number: 'asc' }],
    select: {
      id: true, number: true, competitionYear: true,
      championHandle: true, championName: true,
      runnerUpHandle: true, runnerUpName: true,
      finalScore: true, finalsForfeit: true,
      competitionSeries: { select: { name: true, shortName: true } },
    },
  })

  return rows.map((s) => ({
    seasonId: s.id,
    label: `${s.competitionYear} · Season ${s.number}`,
    year: s.competitionYear,
    number: s.number,
    // The full name reads better in a table cell than the terse short name ("8BRCAM" over "8br").
    event: s.competitionSeries?.name ?? s.competitionSeries?.shortName ?? 'Season',
    winnerHandle: s.championHandle,
    winnerName: s.championName,
    runnerUpHandle: s.runnerUpHandle,
    runnerUpName: s.runnerUpName,
    /*
     * A forfeited final carries no score, and the stored value is suppressed rather than printed.
     * Showing "9-0" for a match nobody played is the specific fabrication the whole result system
     * is built to avoid.
     */
    finalScore: s.finalsForfeit ? null : s.finalScore,
    finalsForfeit: s.finalsForfeit,
    href: `/seasons/${s.id}`,
  }))
}

/**
 * Tagged with the ladder's invalidation tag: closing a Season is what changes this list, and it is
 * the same event that invalidates the standings.
 */
export const getSeasonResults = unstable_cache(
  async (platform: CompetitionPlatform = 'CUEVERSE') => readSeasonResults(platform),
  /*
   * v2: the key moved when the query did.
   *
   * The first version filtered on `publiclyVisible` and returned two rows. Correcting the query is
   * not enough on its own — a cache entry keyed on the old name keeps serving the old answer until
   * it expires, which is exactly what happened and looked like the fix not working. A key is part of
   * the query's identity, so it changes when the query changes.
   */
  ['home-season-results-v5'],
  { revalidate: 300, tags: [LADDER_EXPLORER_TAG] },
)
