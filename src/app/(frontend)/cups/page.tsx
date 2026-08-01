import type { Metadata } from 'next'

import { Container } from '@/components/ui/container'
import { SectionHeader } from '@/components/section-header'
import { CupCard } from '@/components/cups/cup-card'
import { getCups } from '@/lib/cups/fixtures'

export const metadata: Metadata = {
  title: 'Cups',
  description: 'Variety competitions — prize tournaments, doubles, and special formats, separate from league Seasons.',
  alternates: { canonical: '/cups' },
}

export default function CupsPage() {
  const cups = getCups()
  const live = cups.filter((c) => c.status === 'live').sort((a, b) => a.number - b.number)
  const completed = cups.filter((c) => c.status === 'completed').sort((a, b) => a.number - b.number)

  return (
    <Container className="py-10">
      <SectionHeader
        eyebrow="Competitions"
        title="Cups"
        description="Variety competitions — prize events, 2v2, and special formats — kept separate from league Seasons."
      />

      {live.length > 0 && (
        <section className="mb-10">
          <h2 className="eyebrow mb-4 text-gold">Active Cups</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((c) => (
              <CupCard key={c.number} cup={c} />
            ))}
          </div>
        </section>
      )}

      <h2 className="eyebrow mb-4 text-muted-foreground">
        Completed Cups {completed.length > 0 && `· ${completed.length}`}
      </h2>
      {completed.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {completed.map((c) => (
            <CupCard key={c.number} cup={c} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No completed cups on record yet.</p>
      )}
    </Container>
  )
}
