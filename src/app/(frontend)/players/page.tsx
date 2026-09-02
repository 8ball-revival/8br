import type { Metadata } from 'next'

import { Wide } from '@/components/primitives'
import { PlayersDirectory } from '@/components/players/players-directory'
import { listActivePlayers } from '@/lib/players/directory'
import { resolveStaffAccess } from '@/lib/competition/staff-auth'
import { pageMetadata } from '@/lib/site'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = pageMetadata({
  title: 'Players',
  description: 'Every active player at the 8 Ball Registry.',
  path: '/players',
})

/**
 * `/players` — the directory.
 *
 * The nav used to point at Achievements here. Achievements is a page about awards, which is a fine
 * destination but a strange one to give a top-level tab when there was no way to browse the people
 * the whole site is about: profiles could be reached only by finding somebody in a table first. The
 * route still exists and is still linked from the homepage strip.
 *
 * ── The admin controls ──────────────────────────────────────────────────────────────────────────
 * `manage_players` decides whether the editing controls are DRAWN. It decides nothing about whether
 * an edit is permitted — the action re-establishes the same capability on the server every time,
 * because a server action is a public endpoint and an undrawn form stops nobody.
 */
export default async function PlayersPage() {
  const [players, access] = await Promise.all([listActivePlayers(), resolveStaffAccess()])
  const canEdit = access.status === 'ok' && access.actor.can('manage_players')

  return (
    <Wide className="py-8">
      <h1 className="font-display text-3xl font-bold uppercase tracking-tight">Players</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Every active player, by CueVerse ID. Archive figures have a profile and a record but no
        account.
        {canEdit && ' As an administrator you can correct a CueVerse ID or Preferred Name here — the correction travels to every Season, Tournament and ranking that copied the old spelling.'}
      </p>

      <div className="mt-6">
        <PlayersDirectory players={players} canEdit={canEdit} />
      </div>
    </Wide>
  )
}
