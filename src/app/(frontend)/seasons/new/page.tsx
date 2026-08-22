import { redirect } from 'next/navigation'

/**
 * Creating a Season now happens in Creator.
 *
 * A redirect rather than a 404: this URL was the way to make a Season for a long time, so it is
 * likely bookmarked and certainly linked from older notes. Sending somebody to the page that does
 * the job is more useful than telling them the one they remembered is gone.
 *
 * 308, so the move is permanent and the method is preserved.
 */
export default function LegacyNewSeasonPage(): never {
  redirect('/creator/seasons/new')
}
