import type { Metadata } from 'next'

import { pageMetadata } from '@/lib/site'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { PlayerCard } from '@/components/player-card'
import { SearchBar } from '@/components/search-bar'
import { getPlayerIndex } from '@/lib/preview-players'

export const metadata: Metadata = pageMetadata({
  title: 'Players',
  description: 'The archive of CueVerse players and call-signs preserved in the 8 Ball Revival records.',
  path: '/players',
})

export default function PlayersPage() {
  const players = getPlayerIndex()
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Players' }]}
        title="Players"
        description="Canonical player identities. Preview profiles are drawn from the 8BRCAM archive and are pending 8 Ball Revival verification; aliases resolve to one canonical player."
        sample
        actions={<SearchBar className="w-56" />}
      />
      <Container className="py-12">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {players.map((player) => (
            <PlayerCard key={player.slug} player={player} />
          ))}
        </div>
      </Container>
    </>
  )
}
