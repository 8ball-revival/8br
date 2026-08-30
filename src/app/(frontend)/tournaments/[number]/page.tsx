import { BuilderPage } from '@/components/site-builder/edit-mode'
import type { Metadata } from 'next'
import { getTournament, tournamentBracket } from '@/lib/tournaments/service'


/**
 * `/tournaments/[number]/page.tsx` -- governed by the `tournament` template.
 *
 * The body moved to `@/components/system/tournament-detail-body` and is placed by the template as a system
 * module, so one layout describes every Tournament page: an administrator can put an announcement above
 * every Season at once, or restyle the frame, without touching a single Season's data.
 *
 * `generateMetadata` stays here because Next only reads it from a route file.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }): Promise<Metadata> {
  const { number } = await params
  const cup = getTournament(Number(number))
  const title = cup ? `${cup.name} — Tournament ${cup.number}` : `Tournament ${number}`
  return { title, alternates: { canonical: `/tournaments/${number}` } }
}

export default async function Page({ params, searchParams }: {
  params: Promise<{ number: string }>
  searchParams: Promise<{ view?: string }>
}) {
  return (
    <BuilderPage
      pageKey="tournament"
      pageTitle="Tournament"
      routeParams={params as Promise<Record<string, string>>}
      searchParams={searchParams as Promise<Record<string, string | string[] | undefined>>}
      entityId={Number((await params).number) || undefined}
    />
  )
}
