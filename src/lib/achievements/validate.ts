import { statistic, validateFormat } from './statistics'

/**
 * Whether a definition may be saved.
 *
 * ── Why validation is its own module ─────────────────────────────────────────────────────────────
 * The same rules have to hold in three places: the admin form (so the message appears next to the
 * field), the server action (so a crafted request cannot bypass the form), and the tests. Writing
 * them once and importing them everywhere is what stops the form and the server disagreeing about
 * what is publishable.
 *
 * ── What it is actually protecting ───────────────────────────────────────────────────────────────
 * A rule that cannot produce a sensible holder. The expensive mistake is not a crash — it is an
 * achievement that quietly publishes something misleading, like a 100% win rate belonging to
 * somebody who played one match. That is why a percentage without a minimum is refused outright
 * rather than warned about.
 */

export interface DefinitionInput {
  key?: string
  title: string
  flavorText?: string | null
  description?: string | null
  awardType: 'AUTOMATIC' | 'MANUAL'
  status?: 'ACTIVE' | 'ARCHIVED'
  displayFormat: string
  statistic?: string | null
  scope?: string
  competitionId?: number | null
  seasonId?: number | null
  tournamentId?: number | null
  stage?: string
  winner?: string
  minMatches?: number | null
  minSeasons?: number | null
  minFinals?: number | null
  minPlayoffMatches?: number | null
  tiePolicy?: string
  tieBreakStat?: string | null
  manualPlayerId?: string | null
  manualValue?: string | null
}

/** Field name → message. Empty means publishable. */
export type ValidationErrors = Record<string, string>

export function validateDefinition(input: DefinitionInput): ValidationErrors {
  const errors: ValidationErrors = {}

  if (!input.title?.trim()) errors.title = 'A name is required.'
  else if (input.title.trim().length > 80) errors.title = 'Keep the name under 80 characters.'

  if (input.flavorText && input.flavorText.length > 120) {
    errors.flavorText = 'Keep the flavour text under 120 characters — it has to fit on a card.'
  }

  const fmt = validateFormat(input.displayFormat ?? '')
  if (!fmt.ok) errors.displayFormat = fmt.error

  if (input.awardType === 'MANUAL') {
    /*
     * A manual award needs a value, but NOT necessarily a player: a site-wide fact ("nobody has ever
     * done it") is a legitimate manual achievement with no holder. Demanding a player would make
     * that impossible to express.
     */
    if (!input.manualValue?.trim()) {
      errors.manualValue = 'A manual award needs a value to display.'
    }
    return errors
  }

  // ── Automatic ────────────────────────────────────────────────────────────────────────────────
  const def = statistic(input.statistic)
  if (!def) {
    errors.statistic = 'Choose a statistic.'
    return errors
  }

  if (!input.winner) errors.winner = 'Choose whether the highest or lowest value wins.'

  /*
   * A rate without a floor is the classic bad leaderboard, so the minimum is required rather than
   * suggested. Ten is arbitrary but deliberate: it is low enough not to obstruct, high enough that
   * a single lucky match cannot top the table.
   */
  if (def.needsMinimum) {
    const min = input.minMatches ?? 0
    if (!min || min < 10) {
      errors.minMatches = `${def.label} needs a minimum of at least 10 matches, or one lucky result wins it.`
    }
  }

  if (input.scope === 'SPECIFIC_COMPETITION' && !input.competitionId) {
    errors.competitionId = 'Choose a competition.'
  }
  if (input.scope === 'SPECIFIC_SEASON' && !input.seasonId) {
    errors.seasonId = 'Choose a Season.'
  }
  if (input.scope === 'SPECIFIC_TOURNAMENT' && !input.tournamentId) {
    errors.tournamentId = 'Choose a Tournament.'
  }

  /*
   * The Finals stage only means something for a finals statistic. Any other statistic under it
   * would silently read the overall aggregate, so the card would say "in finals" over a number that
   * counted every match — wrong in a way nobody would spot.
   */
  if (input.stage === 'FINALS' && def.source !== 'finals') {
    errors.stage = `${def.label} is not a finals statistic. Choose a Finals statistic, or a different stage.`
  }
  if (input.stage && input.stage !== 'ALL_MATCHES' && def.stageAware === false) {
    errors.stage = `${def.label} is a career figure and cannot be filtered by stage.`
  }

  if (input.tiePolicy === 'SECONDARY_STAT') {
    if (!input.tieBreakStat) errors.tieBreakStat = 'Choose a statistic to break ties with.'
    else if (!statistic(input.tieBreakStat)) errors.tieBreakStat = 'That tie-break statistic no longer exists.'
    else if (input.tieBreakStat === input.statistic) {
      errors.tieBreakStat = 'The tie-break must be a different statistic — the main one is already level.'
    }
  }

  for (const [field, value] of [
    ['minMatches', input.minMatches], ['minSeasons', input.minSeasons],
    ['minFinals', input.minFinals], ['minPlayoffMatches', input.minPlayoffMatches],
  ] as const) {
    if (value != null && (!Number.isInteger(value) || value < 0)) {
      errors[field] = 'Must be a whole number of zero or more.'
    }
  }

  return errors
}

export const isValid = (errors: ValidationErrors): boolean => Object.keys(errors).length === 0

/** A URL-safe key derived from the title, for a new definition. */
export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'achievement'
}
