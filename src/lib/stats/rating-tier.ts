/**
 * Rating tiers — the colour bands on the primary Rating value in the Rankings table.
 *
 * Pure and dependency-free, so the boundaries can be tested directly rather than inferred from a
 * rendered page. That matters here more than the code size suggests: the whole feature IS its
 * boundaries, and an off-by-one at 1200 or 1600 is invisible in a screenshot but wrong on every row
 * that sits on the line.
 *
 * The bands are closed at the bottom and open at the top: 1200 is Green, 1199 is Grey. A rating is
 * never rounded to reach a band — the number shown and the band it is in always agree.
 *
 * This is presentation only. It changes no ranking, no ordering and no tie-break, and no other
 * rating display on the site uses it — see the note on RatingCell.
 */

export type RatingTier = 'gold' | 'red' | 'purple' | 'blue' | 'green' | 'grey'

/**
 * Ordered high to low. The first band whose floor the rating reaches is the one it belongs to.
 *
 * The colour order is the owner's, not a spectrum: gold, purple, blue, green, red, grey descending.
 * Red sits LOW rather than high — an earlier revision had 1500–1599 red, which is gone. Anyone
 * reading a red rating as "elite" is reading the previous scheme.
 */
const BANDS: { tier: RatingTier; floor: number; label: string }[] = [
  { tier: 'gold', floor: 1600, label: 'Gold' },
  { tier: 'purple', floor: 1500, label: 'Purple' },
  { tier: 'blue', floor: 1400, label: 'Blue' },
  { tier: 'green', floor: 1300, label: 'Green' },
  { tier: 'red', floor: 1200, label: 'Red' },
  { tier: 'grey', floor: Number.NEGATIVE_INFINITY, label: 'Grey' },
]

/**
 * The tier a rating belongs to, or null where there is no rating.
 *
 * Null is not a tier and must not be given one: an unrated player has no standing to colour, and
 * painting them grey would make "no rating recorded" indistinguishable from "rated below 1200".
 */
export function ratingTier(rating: number | null | undefined): RatingTier | null {
  if (rating == null || !Number.isFinite(rating)) return null
  return BANDS.find((b) => rating >= b.floor)!.tier
}

/** The tier's name, for the accessible label. */
export function ratingTierLabel(tier: RatingTier): string {
  return BANDS.find((b) => b.tier === tier)!.label
}

/**
 * What a screen reader hears for a rated player: "1651 rating, Gold tier".
 *
 * Colour cannot be the only thing carrying the tier, and the tier is not written on the row — so it
 * is written here instead. An unrated player gets no label at all, because the dash already says
 * everything there is to say.
 */
export function ratingAriaLabel(rating: number | null | undefined): string | undefined {
  const tier = ratingTier(rating)
  if (tier == null) return undefined
  return `${rating} rating, ${ratingTierLabel(tier)} tier`
}
