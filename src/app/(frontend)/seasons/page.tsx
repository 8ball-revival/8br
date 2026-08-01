import type { Metadata } from 'next'

import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/page-header'
import { YearSlider } from '@/components/seasons/year-slider'
import { SeasonRow } from '@/components/seasons/season-row'
import { getArchiveYears, getSeasonsByYear } from '@/lib/seasons/archive'
import { pageMetadata } from '@/lib/site'

export const metadata: Metadata = pageMetadata({
  title: 'Seasons',
  description:
    'The complete archive of 8 Ball Revival seasons — every year from 2005 to today, with group standings and playoff brackets.',
  path: '/seasons',
})

type Params = { searchParams: Promise<{ year?: string }> }

export default async function SeasonsPage({ searchParams }: Params) {
  const { year } = await searchParams
  const years = getArchiveYears()
  const selected = year && years.includes(Number(year)) ? Number(year) : years[0]
  const seasons = getSeasonsByYear(selected)

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Seasons' }]}
        title="Seasons"
        description="Every season, one archive. Pick a year, then open a season's Groups or Playoffs. The current season's live group & playoff action lives on the Groups and Playoffs tabs."
        sample
      />
      <YearSlider years={years} selected={selected} />
      <Container className="py-8">
        <div className="space-y-4">
          {seasons.map((s) => (
            <SeasonRow key={s.seasonId} season={s} />
          ))}
        </div>
      </Container>
    </>
  )
}
