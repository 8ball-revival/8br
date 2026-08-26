/**
 * The Achievements: eighteen facts about the archive, each computed from canonical data.
 *
 * ── The rule that shapes everything here ─────────────────────────────────────────────────────────
 * Every claim must be provable from the database. Not "supportable", not "probably true" —
 * reconstructible from Seasons, Entrants, Matches and the Rating Ledger by somebody who wants to
 * check. The mock these came from showed hard-coded names and dates; hard-coding them would make
 * the most quotable part of the homepage the least trustworthy, and it would be wrong the first time
 * a Season closed.
 *
 * So nothing is stored, nothing is seeded, and no award has a winner written down anywhere. They are
 * all derived on read, which also means they update themselves.
 *
 * ── What the data cannot prove, and is therefore never claimed ───────────────────────────────────
 * Seeds, ages, match dates, in-match comebacks, margins in matches that were forfeited, and any
 * notion of "form". Several obvious-sounding awards were not written because the data underneath
 * them does not exist.
 */

/** A player as an award names them. The handle leads, per the site-wide identity rule. */
export interface AchievementPlayer {
  playerId: string
  cueverseId: string | null
  preferredName: string
  /**
   * The profile path, or null when the player has no handle to key one by.
   *
   * /players/[cueverse] is keyed by the CueVerse ID itself, so seven of the 516 archive players have
   * no profile page to point at. Those render as plain text rather than a link to a 404.
   */
  href: string | null
}

export interface Achievement {
  /** Stable key. Used for React keys and deep links; never shown. */
  id: string
  /** The award's name, as written. */
  title: string
  /**
   * The joke. Short, human, and never a claim of its own — every factual assertion lives in
   * `stat` and `detail`, which are computed.
   */
  caption: string
  /**
   * Who won it. Empty when the archive cannot currently support the award — a new database with no
   * completed Seasons has no Choker — and more than one when the lead is genuinely tied.
   */
  winners: AchievementPlayer[]
  /** The headline figure, pre-formatted. */
  stat: string
  /** One line of supporting arithmetic, so the number can be checked rather than believed. */
  detail: string
  /**
   * True when this award describes the site rather than a person, so the card can drop the identity
   * line instead of rendering an empty one.
   */
  siteWide?: boolean
}
