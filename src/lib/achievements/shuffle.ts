import type { Achievement } from './types'

/**
 * A fresh order for the homepage strip on every request.
 *
 * ── Why it is not inside the cached service ──────────────────────────────────────────────────────
 * `getPublicAchievements` is cached for five minutes, so a shuffle applied in there would be frozen
 * for five minutes with it — every visitor would see the same "random" five. Shuffling at render
 * time, over the cached list, keeps the expensive part cached and the cheap part fresh.
 *
 * ── Why Fisher-Yates and not sort(() => Math.random() - 0.5) ─────────────────────────────────────
 * The sort trick is the common one and it is not a shuffle: comparison sorts assume a consistent
 * comparator, and a random one produces a distribution that visibly favours the original order.
 * Fisher-Yates gives every permutation equal probability in one pass, which is what "a different
 * five each time" actually requires.
 *
 * ── No repeats within a cycle ────────────────────────────────────────────────────────────────────
 * Nothing here needs to track what was shown: the carousel pages through this whole permutation
 * before it wraps, so every achievement appears exactly once per cycle by construction.
 */
export function shuffleAchievements(list: Achievement[]): Achievement[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * The same shuffle from a caller-supplied random source.
 *
 * Exported so a test can pass a deterministic generator and assert the permutation, which is the
 * only way to check a shuffle without asserting on luck.
 */
export function shuffleWith<T>(list: T[], random: () => number): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
