'use server'

import { updateTag, revalidatePath } from 'next/cache'
import { requireCapability } from '@/lib/competition/staff-auth'
import { refreshCueVerseLeaderboard, CUEVERSE_TAG } from './service'

/**
 * Manual refresh of the CueVerse leaderboard, for an administrator who does not want to wait for
 * tomorrow's scheduled run.
 *
 * Gated on the same capability the rest of the admin console uses. The check runs here rather than
 * in the UI because a server action is a public HTTP endpoint whatever the page around it looks
 * like — hiding the button would stop nobody.
 */
export interface RefreshActionResult {
  ok?: boolean
  error?: string
  message?: string
}

export async function refreshCueVerseAction(): Promise<RefreshActionResult> {
  try {
    await requireCapability('manage_competitions')
  } catch {
    return { error: 'Only an administrator can refresh the CueVerse leaderboard.' }
  }

  const result = await refreshCueVerseLeaderboard()
  if (!result.ok) return { error: result.error ?? 'The refresh did not succeed.' }

  // updateTag rather than revalidateTag: this runs in a Server Action, and the administrator
  // should see the result of their own refresh on the very next render.
  updateTag(CUEVERSE_TAG)
  revalidatePath('/')
  revalidatePath('/staff/news')

  return {
    ok: true,
    message: result.unchanged
      ? 'Checked — CueVerse has not changed since the last snapshot.'
      : `Updated with ${result.entries} players.`,
  }
}
