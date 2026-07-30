/**
 * Deterministic pseudo-random number generator. Group generation must be
 * reproducible: the same seed string always yields the same ordering, and the
 * seed is recorded so any generation can be replayed/audited. No Math.random.
 */

/** xmur3 string hash → 32-bit seed. */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return h >>> 0
  }
}

/** mulberry32 PRNG → floats in [0, 1). */
function mulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Build a deterministic float generator from any seed string. */
export function seededRandom(seed: string): () => number {
  const seedFn = xmur3(seed)
  return mulberry32(seedFn())
}

/** Deterministic in-place Fisher–Yates shuffle of a copy, driven by `seed`. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const rand = seededRandom(seed)
  const arr = items.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
