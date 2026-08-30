/**
 * Whether a photograph of a champion still belongs beside the champion's name.
 *
 * ── The problem this exists to prevent ──────────────────────────────────────────────────────────
 * The hero shows a photograph of a specific person and, beside it, whoever the database currently
 * reports as first. Those are two facts that happen to agree today. The day the title changes hands
 * they stop agreeing, and the failure mode is not a missing picture — it is one player's face under
 * another player's name, on the front page, with nobody having done anything wrong.
 *
 * So the photograph declares who it is OF, and this compares that to who is currently first. When
 * they part company the photograph is dropped and the hero falls back to a branded ground. Nobody
 * has to remember anything on the day.
 *
 * ── Why a separate, pure function ───────────────────────────────────────────────────────────────
 * It is the one piece of logic on this page whose failure is invisible until it is embarrassing, and
 * it cannot be exercised through the interface without changing who the champion is. Pulled out
 * here, it can be tested directly against every case that matters.
 */
export interface ChampionImageDecision {
  /** True when the configured photograph may be shown. */
  use: boolean
  /** Why, for tests and for the inspector's benefit. */
  reason: 'no-image' | 'unclaimed' | 'matches' | 'different-champion' | 'no-champion'
}

export function championImageDecision({
  declaredHandle, championHandle, hasImage,
}: {
  /** The CueVerse ID the configured photograph is of. Empty means "of nobody in particular". */
  declaredHandle: string
  /** The CueVerse ID of whoever the database currently ranks first, if anybody. */
  championHandle: string | null
  /** Whether both crops are configured at all. */
  hasImage: boolean
}): ChampionImageDecision {
  if (!hasImage) return { use: false, reason: 'no-image' }

  /*
    An unclaimed photograph is always shown.

    A crowd shot, an empty arena, a table under lights — pictures with no identifiable subject are a
    perfectly reasonable thing to put here, and they have no reason to disappear when a title changes
    hands. Leaving the field empty is how an Owner says so.
  */
  const declared = declaredHandle.trim().toLowerCase()
  if (declared === '') return { use: true, reason: 'unclaimed' }

  const actual = (championHandle ?? '').trim().toLowerCase()
  if (actual === '') return { use: false, reason: 'no-champion' }

  /*
    Compared on the CueVerse ID rather than the display name.

    Six players on this site are called Chris. A display name does not identify anybody, and a
    photograph that matched on one would be one duplicate name away from the exact failure this
    function exists to prevent.
  */
  return declared === actual
    ? { use: true, reason: 'matches' }
    : { use: false, reason: 'different-champion' }
}
