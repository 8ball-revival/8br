import type { Metadata } from 'next'
import { SearchX, Search as SearchIcon } from 'lucide-react'

import { pageMetadata } from '@/lib/site'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { SectionHeader } from '@/components/section-header'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchBar } from '@/components/search-bar'
import { SearchResultCard } from '@/components/search/search-result-card'
import { searchAll, type SearchResult } from '@/lib/search'

export const metadata: Metadata = pageMetadata({
  title: 'Search',
  description: 'Search 8 Ball Revival players, aliases, seasons, and competitions.',
  path: '/search',
  index: false,
})

type Params = { searchParams: Promise<{ q?: string }> }

function Group({ title, results }: { title: string; results: SearchResult[] }) {
  if (results.length === 0) return null
  return (
    <div className="mb-10">
      <SectionHeader title={`${title} (${results.length})`} />
      <div className="grid gap-3">
        {results.map((r, i) => (
          <SearchResultCard key={`${r.href}-${i}`} result={r} />
        ))}
      </div>
    </div>
  )
}

export default async function SearchPage({ searchParams }: Params) {
  const { q = '' } = await searchParams
  const results = searchAll(q)
  const hasQuery = results.query.length > 0

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Search' }]}
        title="Search"
        description="Search players, aliases, seasons, and historical archive competitions."
      />
      <Container className="py-10">
        <div className="mb-10 max-w-xl">
          <SearchBar defaultValue={results.query} />
        </div>

        {!hasQuery ? (
          <EmptyState
            icon={SearchIcon}
            title="Enter a player, alias, season, or competition"
            description="Results are grouped by type. Alias searches return the canonical player."
          />
        ) : results.total === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No matching records found"
            description={`Nothing matched “${results.query}”. Try a different name, alias, or season.`}
          />
        ) : (
          <>
            <p className="mb-8 text-sm text-muted-foreground">
              {results.total} result{results.total === 1 ? '' : 's'} for{' '}
              <span className="font-medium text-foreground">“{results.query}”</span>
            </p>
            <Group title="Players" results={results.players} />
            <Group title="Competitions" results={results.competitions} />
            <Group title="Seasons" results={results.seasons} />
            <Group title="News" results={results.news} />
          </>
        )}
      </Container>
    </>
  )
}
