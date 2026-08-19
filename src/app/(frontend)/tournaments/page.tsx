import { redirect } from 'next/navigation'

/**
 * /tournaments → the Archives.
 *
 * Tournaments no longer have a listing of their own: a finished Tournament belongs in Archives and a
 * running one belongs in Live, and there is no third thing a combined list would show. The
 * per-Tournament URLs (/tournaments/<number>) are untouched, so every existing link still resolves — this is
 * only the index moving.
 *
 * Meaningful query parameters are carried across so a bookmarked filter keeps working. Nothing
 * redirects back here, so there is no loop.
 */
export const dynamic = 'force-dynamic'

export default async function TournamentsIndexRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const carried = new URLSearchParams()
  for (const key of ['comp', 'year', 'division', 'q', 'player', 'sort', 'page']) {
    const v = sp[key]
    const one = typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined
    if (one) carried.set(key, one)
  }
  redirect(`/archives/tournaments${carried.toString() ? `?${carried}` : ''}`)
}
