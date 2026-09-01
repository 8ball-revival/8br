/**
 * The exact links CueVerse itself builds.
 *
 * ── Why these are copied rather than invented ───────────────────────────────────────────────────
 * CueVerse is the authority for everything in the CueVerse window, and that includes where a name
 * or a replay points. Its own profile page builds these links in `profile-main.ts`; the forms below
 * are the same ones, reproduced here so a reader can check them against the source:
 *
 *   opponent  /profile/?name=${encodeURIComponent(part)}&game=${game}
 *   replay    /replay/?id=${id}                      (pool only, and only when `replayable`)
 *
 * Made absolute against https://cueverse.gg, because ours is a different origin.
 *
 * Nothing here reads a database or a name of ours. A player's CueVerse ID is used verbatim — the
 * casing they registered — and never substituted with a display name or an alias, because the ID is
 * what CueVerse keys a profile by and a real name will simply 404.
 */

export const CUEVERSE_ORIGIN = 'https://cueverse.gg'

/** The game this integration reads. CueVerse also runs checkers and spades; we only show pool. */
export const CUEVERSE_GAME = 'pool'

/**
 * A player's CueVerse profile, from their stored CueVerse ID.
 *
 * Returns null rather than a broken link when there is no usable ID. Seven of the archive's players
 * have no handle at all, and a link to `?name=` is a link to an error page.
 */
export function cueverseProfileUrl(cueverseId: string | null | undefined): string | null {
  const id = (cueverseId ?? '').trim()
  if (!id) return null
  return `${CUEVERSE_ORIGIN}/profile/?name=${encodeURIComponent(id)}&game=${CUEVERSE_GAME}`
}

/** A replay, by the id CueVerse gave for that game. */
export function cueverseReplayUrl(replayId: number | string): string {
  return `${CUEVERSE_ORIGIN}/replay/?id=${encodeURIComponent(String(replayId))}`
}

/**
 * One piece of an opponent field: either a name to link, or the punctuation between names.
 *
 * A 2v2 game records its opponents as one string — "Alice & Bob", or "Alice (w/ Bob)" — so the cell
 * is several links and some literal text, not one link. `?` appears where CueVerse did not record a
 * name and must stay unlinked.
 */
export interface OpponentPart {
  text: string
  /** Absent for separators, blanks and "?" — the parts that are not a player. */
  href?: string
}

/*
  CueVerse's own separator pattern, capturing so the separators survive the split.

  Copied exactly: ` & `, `(w/ ` and `)`. Splitting differently would either link the punctuation or
  lose it, and either one changes what the cell says.
*/
const OPPONENT_SEPARATORS = /( & |\(w\/ |\))/

/** Split an opponent field into linkable names and literal separators, as CueVerse does. */
export function opponentParts(opponent: string | null | undefined): OpponentPart[] {
  const raw = (opponent ?? '').trim()
  if (!raw) return [{ text: '—' }]

  return raw
    .split(OPPONENT_SEPARATORS)
    .filter((piece) => piece !== '')
    .map((piece) => {
      const name = piece.trim()
      const isSeparator = piece === ' & ' || piece === '(w/ ' || piece === ')'
      if (!name || name === '?' || isSeparator) return { text: piece }
      return { text: piece, href: `${CUEVERSE_ORIGIN}/profile/?name=${encodeURIComponent(name)}&game=${CUEVERSE_GAME}` }
    })
}

/**
 * A streak as the brief asks for it: `W10`, `L2`, or `—`.
 *
 * CueVerse stores one signed number. Its own page renders that as `+10`, which is fine beside a
 * label reading STREAK and meaningless in a column that also carries ratings.
 */
export function formatStreak(streak: number | null | undefined): string {
  if (streak == null || !Number.isFinite(streak) || streak === 0) return '—'
  return streak > 0 ? `W${streak}` : `L${Math.abs(streak)}`
}

/**
 * The result cell, exactly as CueVerse decides it.
 *
 * A tournament game shows a placing rather than a result — "3rd of 8" — and only when the field is
 * at least two, because "1st of 1" is not a placing.
 */
export function resultLabel(game: {
  result: string
  place?: number | null
  field?: number | null
}): string {
  if (game.place != null && game.field != null && game.field >= 2) {
    return `${ordinal(game.place)} of ${game.field}`
  }
  if (game.result === 'won') return 'Won'
  if (game.result === 'lost') return 'Lost'
  return 'Draw'
}

/** 1st, 2nd, 3rd, 4th … including the teens, which do not follow the last-digit rule. */
export function ordinal(n: number): string {
  const abs = Math.abs(n)
  const teen = abs % 100
  if (teen >= 11 && teen <= 13) return `${n}th`
  switch (abs % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}
