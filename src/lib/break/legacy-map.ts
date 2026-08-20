import 'server-only'

/**
 * Where an existing article lands in The Break's categories.
 *
 * ── Why this is a table and not a guess ──────────────────────────────────────────────────────────
 * Every article has to end up under exactly one category, and the decision has to be reproducible:
 * the migration is verified by re-running it against a report, so a rule that could answer
 * differently on a second run would make the verification meaningless.
 *
 * The first rule that matches wins, and the order is deliberate — the legacy category is the
 * author's own filing and beats anything inferred from the words.
 */

/** The legacy editorial categories, mapped onto the new ones. */
export const LEGACY_CATEGORY_MAP: Record<string, string> = {
  'official-news': 'news',
  'predictions': 'prediction',
  'analysis': 'discussion',
  'history': 'history',
  'community': 'discussion',
}

/**
 * Titles are classified only when the signal is unambiguous.
 *
 * Most of the existing articles were never filed under a category at all, so without this they would
 * all land in Discussion — technically correct by the "unknown" rule and obviously wrong for a match
 * preview or a piece about the Yahoo era. These patterns are narrow on purpose: a term has to mean
 * one thing in this context to be listed. Anything else falls through to Discussion, which is what
 * "we do not know" should look like.
 */
export const TITLE_RULES: { category: string; pattern: RegExp; why: string }[] = [
  { category: 'prediction', pattern: /\b(prediction|preview|vs\.?|versus|who wins|pick(s)?)\b/i,
    why: 'a match-up or a call on a result' },
  { category: 'history', pattern: /\b(tribute|history|historic|retro|legacy|throwback|remember(ing)?|era|archive)\b/i,
    why: 'about the past rather than the present' },
  { category: 'announcement', pattern: /\b(announcement|announcing|introducing|now open|launch(ing|ed)?)\b/i,
    why: 'the site telling people something' },
  { category: 'news', pattern: /\b(news|results?|recap|report|winner|champion)\b/i,
    why: 'what happened' },
]

export interface CategoryDecision {
  slug: string
  /** Which rule decided it, recorded in the migration report so the choice can be reviewed. */
  reason: string
}

/** Decide one article's category. Deterministic: same input, same answer, every run. */
export function decideCategory(legacySlug: string | null, title: string): CategoryDecision {
  if (legacySlug && LEGACY_CATEGORY_MAP[legacySlug]) {
    return { slug: LEGACY_CATEGORY_MAP[legacySlug], reason: `filed under "${legacySlug}"` }
  }
  for (const rule of TITLE_RULES) {
    if (rule.pattern.test(title)) return { slug: rule.category, reason: `title reads as ${rule.why}` }
  }
  return { slug: 'discussion', reason: 'no category and nothing decisive in the title' }
}
