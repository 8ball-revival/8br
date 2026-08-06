import type { Metadata } from 'next'

import { PageHeader } from '@/components/page-header'
import { YearSlider } from '@/components/seasons/year-slider'
import { SeasonYear } from '@/components/seasons/season-year'
import { getCurrentEraSeasonYears, getCurrentEraSeasonsByYear } from '@/lib/seasons/archive'
import { cupStore, loadCupContext } from '@/lib/cups/prime'
import { pageMetadata } from '@/lib/site'

export const metadata: Metadata = pageMetadata({
  title: 'Seasons',
  description:
    'The complete archive of 8 Ball Revival seasons — every year from 2005 to today, with group standings and playoff brackets.',
  path: '/seasons',
})

type Params = { searchParams: Promise<{ year?: string }> }

export default async function SeasonsPage({ searchParams }: Params) {
  cupStore.enterWith(await loadCupContext()) // season-year panels render cup data — resolve the live revision
  const { year } = await searchParams
  // Forward-looking surface: current-era seasons only (2026 S1 today; live DB seasons
  // in Phase 2). The older 2005–2014 archive stays out of the main Seasons page — it
  // remains available through Rankings, Hall of Fame, and player careers.
  const years = getCurrentEraSeasonYears()
  const selected = year && years.includes(Number(year)) ? Number(year) : years[0]
  const seasons = getCurrentEraSeasonsByYear(selected)

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Seasons' }]}
        title="Seasons"
        description="Every season, one archive. Pick a year, then open a season's Groups or Playoffs. The current season's live group & playoff action lives on the Groups and Playoffs tabs."
      />
      <YearSlider years={years} selected={selected} />
      {/* Wider responsive canvas for the season dashboard (header/selector stay
          in the narrow container above). key=year resets season selection per year. */}
      <section className="py-8">
        <div className="mx-auto w-full max-w-[120rem] px-4 sm:px-6 lg:px-8">
          <SeasonYear key={selected} seasons={seasons} />
        </div>
      </section>
    </>
  )
}
