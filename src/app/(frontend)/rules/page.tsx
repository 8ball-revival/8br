import type { Metadata } from 'next'

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { SectionNav } from '@/components/section-nav'
import { HandbookBody, sectionAnchor } from '@/components/rules/handbook-view'
import { HANDBOOK, HANDBOOK_PREAMBLE } from '@/lib/rules/handbook'
import { pageMetadata } from '@/lib/site'

export const metadata: Metadata = pageMetadata({
  title: 'Official Competition Handbook',
  description:
    '8 Ball Revival Official Competition Handbook — conduct, eligibility, match format, group stage, playoffs, scheduling, gameplay, recording, and disputes.',
  path: '/rules',
})

// Table of contents entries derived from the handbook data (single source of truth).
const TOC = HANDBOOK.map((s) => ({ id: sectionAnchor(s.number), number: s.number, title: s.title }))

export default function RulesPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Rules' }]}
        title="Official Competition Handbook"
        description="This Handbook governs all official 8 Ball Revival competitions."
      />

      {/* Mobile: horizontal anchor nav. Desktop: sticky TOC sidebar (below). */}
      <div className="lg:hidden">
        <SectionNav
          sections={TOC.map((s) => ({ id: s.id, label: `${s.number}. ${s.title}` }))}
          ariaLabel="Handbook sections"
        />
      </div>

      <Container className="py-12">
        <div className="grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)]">
          {/* Table of contents (desktop) */}
          <aside className="hidden lg:block">
            <nav aria-label="Table of contents" className="sticky top-24">
              <p className="eyebrow mb-3 text-muted-foreground">On this page</p>
              <ul className="space-y-1 border-l border-border">
                {TOC.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="-ml-px flex gap-2 border-l-2 border-transparent py-1.5 pl-4 text-sm text-muted-foreground transition-colors hover:border-gold hover:text-foreground"
                    >
                      <span className="tabular text-muted-foreground/60">{s.number}</span>
                      <span>{s.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          {/* Handbook body */}
          <div className="min-w-0 max-w-3xl">
            <p className="mb-12 border-l-2 border-gold/50 pl-4 text-[0.95rem] italic leading-relaxed text-muted-foreground">
              {HANDBOOK_PREAMBLE}
            </p>
            <HandbookBody />
          </div>
        </div>
      </Container>
    </>
  )
}
