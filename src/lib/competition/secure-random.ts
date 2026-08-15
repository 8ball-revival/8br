import 'server-only'
import { randomInt } from 'node:crypto'

/**
 * Cryptographically-secure, UNBIASED shuffle (Fisher–Yates using node:crypto `randomInt`).
 *
 * This is used ONLY by the RANDOM-draw team generator, where the spec mandates secure server-side
 * randomness with no bias and NO `Math.random()`. It is intentionally NON-reproducible — a redraw
 * must never be predictable. (The rest of the app keeps its deterministic seeded PRNG in `prng.ts`
 * for groups/Swiss, which is a separate concern and unchanged.)
 */
export function secureShuffle<T>(items: readonly T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    // randomInt(0, i + 1) is uniform over [0, i] with rejection sampling — unbiased.
    const j = randomInt(0, i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Unbiased integer in [0, maxExclusive). Thin wrapper so callers don't import node:crypto directly. */
export function secureRandomIndex(maxExclusive: number): number {
  if (maxExclusive <= 0) throw new Error('secureRandomIndex requires a positive bound')
  return randomInt(0, maxExclusive)
}
