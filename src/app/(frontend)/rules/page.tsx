import type { Metadata } from 'next'
import { FileText } from 'lucide-react'

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { SectionNav } from '@/components/section-nav'
import { pageMetadata } from '@/lib/site'

export const metadata: Metadata = pageMetadata({
  title: '8 Ball Revival Competition Rules',
  description:
    '8 Ball Revival competition rules and formats — general conduct, match format, group stage, playoffs, forfeits, and disputes.',
  path: '/rules',
})

// Intended rule sections only — NO rule text is invented here. Real, versioned
// rules will be authored in the CMS and published per competition type.
const SECTIONS = [
  {
    id: 'general-conduct',
    title: 'General Conduct',
    note: 'Eligibility, sportsmanship, and the code of conduct expected of every 8 Ball Revival competitor.',
  },
  {
    id: 'match-format',
    title: 'Match Format & Race Lengths',
    note: 'How matches are played, race lengths, and how individual rounds are scored.',
  },
  {
    id: 'group-stage',
    title: 'Group Stage',
    note: 'Group play, how standings are calculated, and the tiebreakers used to separate players.',
  },
  {
    id: 'playoffs-seeding',
    title: 'Playoffs & Seeding',
    note: 'Qualification from the group stage, the seeding method, and the bracket format.',
  },
  {
    id: 'forfeits',
    title: 'Forfeits, Walkovers & Byes',
    note: 'How non-played results are recorded and how they count toward standings.',
  },
  {
    id: 'disputes',
    title: 'Corrections & Disputes',
    note: 'Reporting issues, the correction process, and how disputes are resolved.',
  },
]

export default function RulesPage() {
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Rules' }]}
        title="8 Ball Revival Competition Rules"
        description="Competition rules are versioned and published per competition. This page sets out the structure of the ruleset — the full rule text is being finalized ahead of Season 2."
        actions={<Badge variant="muted">Content being finalized</Badge>}
      />

      {/* Mobile: horizontal anchor nav. Desktop: sticky TOC sidebar (below). */}
      <div className="lg:hidden">
        <SectionNav sections={SECTIONS.map((s) => ({ id: s.id, label: s.title }))} ariaLabel="Rules sections" />
      </div>

      <Container className="py-12">
        <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
          {/* Table of contents (desktop) */}
          <aside className="hidden lg:block">
            <nav aria-label="Table of contents" className="sticky top-24">
              <p className="eyebrow mb-3 text-muted-foreground">On this page</p>
              <ul className="space-y-1 border-l border-border">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="-ml-px block border-l-2 border-transparent py-1.5 pl-4 text-sm text-muted-foreground transition-colors hover:border-gold hover:text-foreground"
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          {/* Sections */}
          <div className="max-w-2xl space-y-px">
            {SECTIONS.map((s, i) => (
              <section
                key={s.id}
                id={s.id}
                className="scroll-mt-24 border-t border-border py-8 first:border-t-0 first:pt-0"
                aria-labelledby={`${s.id}-heading`}
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground tabular">
                    {i + 1}
                  </span>
                  <h2 id={`${s.id}-heading`} className="font-display text-xl font-bold tracking-tight sm:text-2xl">
                    {s.title}
                  </h2>
                </div>
                <p className="mt-3 text-muted-foreground">{s.note}</p>
                <p className="mt-4 inline-flex items-center gap-2 rounded-md border border-dashed border-border bg-card/40 px-3 py-2 text-sm text-muted-foreground">
                  <FileText className="size-4 shrink-0" aria-hidden />
                  Full rule text will be published here before Season 2 begins.
                </p>
              </section>
            ))}
          </div>
        </div>
      </Container>
    </>
  )
}
